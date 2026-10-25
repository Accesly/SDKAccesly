/**
 * Paso 5 — la política rechaza on-chain lo que se sale de los topes.
 *
 * Para cada regla se manda a la red un `transfer` firmado por la session key
 * que la política tiene que rechazar. La tx entra al ledger y falla dentro de
 * `__check_auth` (el footprint se toma prestado de una simulación válida, así
 * la tx llega a ejecutarse en vez de morir en el preflight):
 *
 *   per-request  $0.06 al comercio con tope de $0.05/pago   → #10007
 *   allowlist    $0.01 a una cuenta fuera de la allowlist    → #10008
 *   monthly      el owner baja el tope mensual (MPC + OTP)
 *                y el siguiente $0.01 lo excede               → #10009
 *
 * Además corre el mismo pago por el flujo x402 normal: el cliente lo detecta
 * en la simulación y no firma nada (X402PolicyRejectedError).
 */

import { Keypair } from '@stellar/stellar-sdk';
import {
  AcceslyExactStellarScheme,
  X402PolicyRejectedError,
  mpcX402Signer,
  sessionKeyX402Signer,
} from '@accesly/core/payments';
import { cfg, loadJson, state, usd } from '../lib/config.mjs';
import {
  footprintOf,
  invoke,
  prepareInvoke,
  read,
  scv,
  submitExpectingRejection,
} from '../lib/stellar.mjs';
import { otpLogin, reconstructOwnerSeed, unb64 } from '../lib/wallet.mjs';

const accounts = loadJson('.secrets', 'accounts');
const device = loadJson('.secrets', 'device');
const session = loadJson('.secrets', 'session');
const s = state.get();
const funder = Keypair.fromSecret(accounts.funder.secret);
const SA = device.smartAccount;
const merchant = accounts.merchant.publicKey;
const outsider = accounts.outsider.publicKey;

const sessionSigner = sessionKeyX402Signer({
  smartAccount: SA,
  sessionPubkey: unb64(session.pubkey),
  sessionSeed: unb64(session.seed),
  ed25519VerifierAddress: cfg.ed25519Verifier,
  contextRuleId: session.ruleId,
});

const transfer = (to, amount, saSigner) => ({
  source: funder,
  contractId: cfg.usdc,
  method: 'transfer',
  args: [scv.address(SA), scv.address(to), scv.i128(amount)],
  saSigner,
});

/** Código que da la simulación enforcing (lo que vería cualquier cliente). */
async function simulatedCode(params) {
  try {
    await prepareInvoke(params);
    return undefined;
  } catch (err) {
    return err.code;
  }
}

async function reject(label, expectedCode, params, footprints) {
  const code = await simulatedCode(params);
  const res = await submitExpectingRejection({ ...params, footprints });
  state.logTx({
    kind: 'rejection',
    label,
    hash: res.hash,
    status: res.status,
    expectedCode,
    simulatedCode: code,
    onChainCode: res.contractErrorCode,
  });
  console.log(
    `${label}: on-chain ${res.status} ${res.hash} (simulation → #${code}, expected #${expectedCode})`,
  );
  return res;
}

const validFootprint = await footprintOf(transfer(merchant, usd(0.01), sessionSigner));

// 1. Tope por pago.
await reject(
  'REJECTED on-chain: $0.06 payment over the $0.05 per-request cap',
  10007,
  transfer(merchant, usd(0.06), sessionSigner),
  [validFootprint],
);

// 2. Allowlist (el footprint del destinatario sale de la simulación recording).
await reject(
  'REJECTED on-chain: $0.01 payment to a recipient outside the allowlist',
  10008,
  transfer(outsider, usd(0.01), sessionSigner),
  [validFootprint],
);

// 3. Tope mensual: el owner (MPC 2-de-3 tras OTP) baja el tope a lo ya gastado.
const token = await otpLogin(device.email);
const owner = mpcX402Signer({
  smartAccount: SA,
  ownerPubkey: unb64(device.ownerPubkey),
  ed25519VerifierAddress: cfg.ed25519Verifier,
  contextRuleId: s.rules.adminCfg,
  reconstructSeed: () => reconstructOwnerSeed(token),
});
const data = await read({
  contractId: cfg.x402Policy,
  method: 'get_data',
  args: [scv.u32(session.ruleId), scv.address(SA)],
  source: funder.publicKey(),
});
const spent = BigInt(data.window_spent);
const footprintBefore = await footprintOf(transfer(merchant, usd(0.01), sessionSigner));
const lowerCap = spent + usd(0.005);
const capTx = await invoke({
  source: funder,
  contractId: cfg.x402Policy,
  method: 'set_caps',
  // Tope por pago = $0.01 (el pago pasa esa regla); el mensual es el que corta.
  args: [scv.u32(session.ruleId), scv.address(SA), scv.i128(usd(0.01)), scv.i128(lowerCap)],
  saSigner: owner,
});
state.logTx({
  kind: 'policy',
  label: `owner lowers monthly cap to $${Number(lowerCap) / 1e7} (already spent $${Number(spent) / 1e7}); signed under MPC 2-of-3 after email OTP`,
  hash: capTx.hash,
  status: capTx.status,
});
console.log(`set_caps ${capTx.status} ${capTx.hash}`);

await reject(
  'REJECTED on-chain: $0.01 payment over the monthly cap',
  10009,
  transfer(merchant, usd(0.01), sessionSigner),
  [footprintBefore],
);

// 4. Mismo pago por el flujo x402: el cliente lo detecta antes de firmar.
try {
  await new AcceslyExactStellarScheme(sessionSigner).createPaymentPayload(2, {
    scheme: 'exact',
    network: cfg.network,
    asset: cfg.usdc,
    payTo: merchant,
    amount: usd(0.01).toString(),
    maxTimeoutSeconds: 60,
    extra: { areFeesSponsored: true },
  });
  console.log('x402 client: unexpectedly built a payload');
} catch (err) {
  const ok = err instanceof X402PolicyRejectedError;
  state.merge({
    clientPreflightRejection: { reason: err.reason, code: err.code, message: err.message },
  });
  console.log(`x402 client preflight: ${ok ? `rejected (${err.reason})` : err.message}`);
}

// 5. Restaura los topes para seguir cobrando.
const restore = await invoke({
  source: funder,
  contractId: cfg.x402Policy,
  method: 'set_caps',
  args: [
    scv.u32(session.ruleId),
    scv.address(SA),
    scv.i128(BigInt(s.session.maxPerRequest)),
    scv.i128(BigInt(s.session.monthlyCap)),
  ],
  saSigner: owner,
});
state.logTx({
  kind: 'policy',
  label: 'owner restores caps ($0.05/payment, $5/month)',
  hash: restore.hash,
  status: restore.status,
});
console.log(`restore caps ${restore.status} ${restore.hash}`);
