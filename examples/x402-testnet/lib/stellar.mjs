/**
 * Helpers de Soroban para los scripts: invocar contratos con auth del Smart
 * Account, mandar txs y, para la evidencia de rechazo, mandar una tx a la red
 * aunque la política la vaya a rechazar.
 */

import {
  Account,
  Address,
  Contract,
  Keypair,
  Operation,
  SorobanDataBuilder,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { authorizeSmartAccountEntry, parseContractErrorCode } from '@accesly/core/payments';
import { cfg } from './config.mjs';

export const server = new rpc.Server(cfg.rpcUrl);
const BASE_FEE = '1000000';

export async function friendbot(publicKey) {
  const res = await fetch(`https://friendbot.stellar.org?addr=${publicKey}`);
  if (!res.ok && res.status !== 400) throw new Error(`friendbot ${res.status}`);
}

async function freshAccount(publicKey) {
  const acc = await server.getAccount(publicKey);
  return new Account(acc.accountId(), acc.sequenceNumber());
}

function buildTx(account, op) {
  return new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: cfg.passphrase })
    .addOperation(op)
    .setTimeout(300)
    .build();
}

/** Firma con el Smart Account las auth entries que le tocan. */
async function signSmartAccountAuth(auth, saSigner, validUntil) {
  const out = [];
  for (const entry of auth) {
    const creds = entry.credentials();
    const isSa =
      creds.switch().name === 'sorobanCredentialsAddress' &&
      Address.fromScAddress(creds.address().address()).toString() === saSigner.smartAccount;
    out.push(
      isSa ? await authorizeSmartAccountEntry(saSigner, entry, validUntil, cfg.passphrase) : entry,
    );
  }
  return out;
}

function simulationError(sim) {
  const detail = String(sim.error);
  const code = parseContractErrorCode(detail);
  const err = new Error(
    `simulation failed${code ? ` (Contract #${code})` : ''}: ${detail.split('\n')[0]}`,
  );
  err.code = code;
  err.detail = detail;
  return err;
}

/**
 * Prepara una invocación: simula en modo recording, firma auth del Smart
 * Account (si hay `saSigner`) y vuelve a simular en modo enforcing, que es
 * donde corren `__check_auth` y las políticas.
 */
export async function prepareInvoke({ source, contractId, method, args, saSigner }) {
  const op = new Contract(contractId).call(method, ...args);
  let tx = buildTx(await freshAccount(source.publicKey()), op);
  let sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw simulationError(sim);

  if (saSigner) {
    const latest = await server.getLatestLedger();
    const auth = await signSmartAccountAuth(sim.result?.auth ?? [], saSigner, latest.sequence + 60);
    const func = tx.operations[0].func;
    tx = buildTx(
      await freshAccount(source.publicKey()),
      Operation.invokeHostFunction({ func, auth }),
    );
    sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw simulationError(sim);
  }
  return { tx, sim };
}

/** Invoca, firma con `source` y espera el resultado. */
export async function invoke(params) {
  const { tx, sim } = await prepareInvoke(params);
  return submit(assembleAndSign(tx, sim, params.source));
}

const UINT32_MAX = 4294967295n;

/**
 * Ensambla con el resultado de la simulación y firma. Si el resource fee pasa
 * del tope uint32 del campo `fee` (pasa en testnet cuando la invocación
 * restaura entradas archivadas), la tx va envuelta en un fee-bump: el
 * `resourceFee` de Soroban es int64.
 */
export function assembleAndSign(tx, sim, signer) {
  const resourceFee = BigInt(sim.minResourceFee ?? '0');
  if (resourceFee + BigInt(BASE_FEE) <= UINT32_MAX) {
    const prepared = rpc.assembleTransaction(tx, sim).build();
    prepared.sign(signer);
    return prepared;
  }
  const fee = (resourceFee * 11n) / 10n;
  // assembleTransaction suma el resourceFee del sorobanData al fee: se arma con
  // 1 stroop y luego se escribe el valor real directo en el XDR.
  sim.transactionData.setResourceFee('1');
  const env = rpc.assembleTransaction(tx, sim).build().toEnvelope();
  env.v1().tx().ext().sorobanData().resourceFee(new xdr.Int64(fee));
  env.v1().tx().fee(Number(UINT32_MAX));
  const inner = new Transaction(env, cfg.passphrase);
  inner.sign(signer);
  const bump = TransactionBuilder.buildFeeBumpTransaction(
    signer,
    (fee + 100_000n).toString(),
    inner,
    cfg.passphrase,
  );
  bump.sign(signer);
  return bump;
}

/** Simulación de solo lectura. */
export async function read({ contractId, method, args, source }) {
  const tx = buildTx(await freshAccount(source), new Contract(contractId).call(method, ...args));
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw simulationError(sim);
  return scValToNative(sim.result.retval);
}

export async function submit(tx) {
  const sent = await server.sendTransaction(tx);
  if (sent.status === 'ERROR') {
    throw new Error(`send failed: ${sent.errorResult?.result().switch().name ?? 'unknown'}`);
  }
  for (let i = 0; i < 60; i += 1) {
    const got = await server.getTransaction(sent.hash);
    if (got.status !== 'NOT_FOUND') {
      return {
        hash: sent.hash,
        status: got.status,
        ledger: got.ledger,
        returnValue: got.returnValue ? scValToNative(got.returnValue) : undefined,
        contractErrorCode: got.status === 'FAILED' ? failureCode(got) : undefined,
        raw: got,
      };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`tx ${sent.hash} not confirmed after 60s`);
}

/**
 * Código del contrato que hizo fallar la tx, leído de los eventos de
 * diagnóstico (topic `error` con un ScError de tipo contract). Devuelve el
 * primero que aparece, que es el que lanzó la política.
 */
export function failureCode(got) {
  for (const e of got.diagnosticEventsXdr ?? []) {
    const topics = e.event().body().v0().topics();
    if (topics.length < 2 || topics[0].switch().name !== 'scvSymbol') continue;
    if (topics[0].sym().toString() !== 'error' || topics[1].switch().name !== 'scvError') continue;
    const err = topics[1].error();
    if (err.switch().name === 'sceContract') return err.contractCode();
  }
  return undefined;
}

/**
 * Manda a la red una invocación firmada por el Smart Account SIN que la
 * simulación enforcing pase, usando un footprint prestado de una simulación
 * válida. Sirve para dejar evidencia on-chain de un rechazo de la política:
 * la tx entra al ledger y falla dentro de `__check_auth`.
 */
export async function submitExpectingRejection({
  source,
  contractId,
  method,
  args,
  saSigner,
  footprints: borrowed,
}) {
  let footprints = borrowed;
  const op = new Contract(contractId).call(method, ...args);
  const latest = await server.getLatestLedger();
  // La simulación recording de la misma op da la auth (con su nonce) y el
  // footprint de lo que toca el transfer; el resto (reglas, política,
  // verifier) sale de las simulaciones válidas prestadas.
  const recorded = await recordingSim({ source, op });
  const auth = await signSmartAccountAuth(
    recorded.result?.auth ?? [],
    saSigner,
    latest.sequence + 60,
  );
  footprints = [recorded.transactionData.build(), ...footprints];

  const readOnly = new Map();
  const readWrite = new Map();
  let instructions = 0;
  let diskRead = 0;
  let write = 0;
  let resourceFee = 0n;
  for (const data of footprints) {
    const fp = data.resources().footprint();
    for (const k of fp.readOnly()) readOnly.set(k.toXDR('base64'), k);
    for (const k of fp.readWrite()) readWrite.set(k.toXDR('base64'), k);
    // Los footprints se suman: cada uno lee entradas distintas.
    instructions = Math.max(instructions, data.resources().instructions());
    diskRead += data.resources().diskReadBytes();
    write += data.resources().writeBytes();
    resourceFee =
      resourceFee > BigInt(data.resourceFee().toString())
        ? resourceFee
        : BigInt(data.resourceFee().toString());
  }
  for (const k of readWrite.keys()) readOnly.delete(k);

  const sorobanData = new SorobanDataBuilder()
    .setFootprint([...readOnly.values()], [...readWrite.values()])
    .setResources(Math.ceil(instructions * 1.5), Math.ceil(diskRead * 1.5), Math.ceil(write * 1.5))
    .setResourceFee((resourceFee * 3n).toString())
    .build();

  const account = await freshAccount(source.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: (BigInt(BASE_FEE) + resourceFee * 3n).toString(),
    networkPassphrase: cfg.passphrase,
  })
    .addOperation(
      Operation.invokeHostFunction({ func: op.body().invokeHostFunctionOp().hostFunction(), auth }),
    )
    .setSorobanData(sorobanData)
    .setTimeout(300)
    .build();
  tx.sign(source);
  return submit(tx);
}

/** Simulación en modo recording de una op (auth + footprint sin `__check_auth`). */
async function recordingSim({ source, op }) {
  const tx = buildTx(await freshAccount(source.publicKey()), op);
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw simulationError(sim);
  return sim;
}

/** `SorobanTransactionData` de una simulación válida (para prestar footprint). */
export async function footprintOf(params) {
  const { sim } = await prepareInvoke(params);
  return sim.transactionData.build();
}

// ── Codificadores de los tipos de OZ stellar-accounts ────────────────────────

export const scv = {
  address: (a) => nativeToScVal(a, { type: 'address' }),
  i128: (n) => nativeToScVal(BigInt(n), { type: 'i128' }),
  u32: (n) => xdr.ScVal.scvU32(n),
  bytes: (b) => nativeToScVal(Buffer.from(b), { type: 'bytes' }),
  string: (s) => nativeToScVal(s, { type: 'string' }),
  symbol: (s) => xdr.ScVal.scvSymbol(s),
  vec: (items) => xdr.ScVal.scvVec(items),
  /** Struct de Soroban: ScMap con keys Symbol en orden alfabético. */
  struct: (fields) =>
    xdr.ScVal.scvMap(
      Object.keys(fields)
        .sort()
        .map((k) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: fields[k] })),
    ),
  /** Enum con payload: Vec[Symbol(variant), ...payload]. */
  variant: (name, ...payload) => xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name), ...payload]),
  none: () => xdr.ScVal.scvVoid(),
  /** Map<Address, Val> ordenado por la key serializada. */
  addressMap: (entries) =>
    xdr.ScVal.scvMap(
      entries
        .map(([addr, val]) => ({ key: nativeToScVal(addr, { type: 'address' }), val }))
        .sort((a, b) => Buffer.compare(a.key.toXDR(), b.key.toXDR()))
        .map((e) => new xdr.ScMapEntry(e)),
    ),
  ed25519Signer: (verifier, pubkey) =>
    xdr.ScVal.scvVec([
      xdr.ScVal.scvSymbol('External'),
      nativeToScVal(verifier, { type: 'address' }),
      nativeToScVal(Buffer.from(pubkey), { type: 'bytes' }),
    ]),
};

export const keypairFromSecret = (s) => Keypair.fromSecret(s);
export const txLink = (hash) => `${cfg.explorer}/tx/${hash}`;
export const contractLink = (id) => `${cfg.explorer}/contract/${id}`;

/**
 * Si el código de un contrato está archivado, lo restaura. La renta de un
 * WASM grande en testnet pasa del tope uint32 del fee de una tx normal, así
 * que va envuelta en un fee-bump (el resource fee de Soroban es int64).
 */
export async function restoreCodeIfArchived(payer, wasmHashHex) {
  const key = xdr.LedgerKey.contractCode(
    new xdr.LedgerKeyContractCode({ hash: Buffer.from(wasmHashHex, 'hex') }),
  );
  const probe = buildTx(await freshAccount(payer.publicKey()), Operation.restoreFootprint({}));
  const withKey = TransactionBuilder.cloneFrom(probe, {
    fee: probe.fee,
    sorobanData: new SorobanDataBuilder().setReadWrite([key]).build(),
  }).build();
  const sim = await server.simulateTransaction(withKey);
  if (rpc.Api.isSimulationError(sim)) throw simulationError(sim);
  const resourceFee = BigInt(sim.minResourceFee ?? '0');
  // Una entrada viva no necesita restore: la simulación sale casi gratis.
  if (resourceFee < 10_000_000n) return null;

  const fee = (resourceFee * 11n) / 10n;
  const t = TransactionBuilder.cloneFrom(withKey, {
    fee: '100',
    sorobanData: sim.transactionData.setResourceFee('1').build(),
  }).build();
  const env = t.toEnvelope();
  env.v1().tx().ext().sorobanData().resourceFee(new xdr.Int64(fee));
  env.v1().tx().fee(4294967295);
  const inner = new Transaction(env, cfg.passphrase);
  inner.sign(payer);
  const bump = TransactionBuilder.buildFeeBumpTransaction(
    payer,
    (fee + 100_000n).toString(),
    inner,
    cfg.passphrase,
  );
  bump.sign(payer);
  return submit(bump);
}
