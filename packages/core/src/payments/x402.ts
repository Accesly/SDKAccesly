/**
 * x402 payments — cliente "exact" de Stellar para Smart Accounts de Accesly.
 *
 * Cuando un endpoint responde 402, este scheme arma un `transfer(from, to,
 * amount)` del token SEP-41 que pide el servidor (USDC por default), con
 * `from = Smart Account`, y firma la `SorobanAuthorizationEntry` resultante
 * con el `AuthPayload` que espera `__check_auth` del Smart Account:
 *
 *   AuthPayload {
 *     signers: { Signer::External(ed25519_verifier, pubkey): sig },
 *     context_rule_ids: [rule_id],
 *   }
 *
 * El facilitador x402 (spec "exact" de Stellar) re-arma la tx con su propia
 * cuenta como source, paga el fee y la manda. El cliente nunca gasta un
 * sequence number ni paga fees.
 *
 * NON-CUSTODY
 * Este módulo NO reconstruye llaves. Recibe un `loadSeed()` del caller:
 *   - Modo MPC: el caller reconstruye la seed 2-de-3 (F1 device + F2 server
 *     liberado tras OTP) con `@accesly/core/mpc` y la devuelve.
 *   - Modo session key: el caller devuelve una COPIA de la seed de la session
 *     key (la regla de la session key tiene la política x402 on-chain).
 * La seed que devuelve `loadSeed()` se zero-iza en cuanto se produce la firma
 * (ver `signSorobanAuthEntry`).
 *
 * Los límites reales (tope por pago, tope mensual, allowlist) los impone el
 * contrato `x402-spending-policy` on-chain. El `maxAmountPerPayment` de abajo
 * es solo una defensa extra del lado cliente.
 */

import type {
  PaymentPayloadResult,
  PaymentRequirements,
  SchemeNetworkClient,
} from '@x402/core/types';
import { sha256 } from '@noble/hashes/sha2';
import { loadStellarSdk } from '../stellar/loadSdk.js';
import { signSorobanAuthEntry } from '../stellar/sorobanAuth.js';

/** CAIP-2 de las redes Stellar que acepta x402. */
export const STELLAR_TESTNET_CAIP2 = 'stellar:testnet';
export const STELLAR_PUBNET_CAIP2 = 'stellar:pubnet';

const NETWORK_PASSPHRASES: Record<string, string> = {
  [STELLAR_TESTNET_CAIP2]: 'Test SDF Network ; September 2015',
  [STELLAR_PUBNET_CAIP2]: 'Public Global Stellar Network ; September 2015',
};

const DEFAULT_RPC_URLS: Record<string, string> = {
  [STELLAR_TESTNET_CAIP2]: 'https://soroban-testnet.stellar.org',
};

/** USDC (SAC de Circle) por red; los mismos que usa `@x402/stellar`. */
export const USDC_BY_NETWORK: Readonly<Record<string, string>> = {
  [STELLAR_TESTNET_CAIP2]: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
  [STELLAR_PUBNET_CAIP2]: 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
};

/** Segundos aproximados por ledger, para convertir `maxTimeoutSeconds`. */
const LEDGER_SECONDS = 5;

/**
 * Códigos de error del contrato `x402-spending-policy`. Aparecen en el
 * resultado de la simulación como `Error(Contract, #<code>)`.
 */
export const X402_POLICY_ERRORS: Readonly<Record<number, string>> = {
  10000: 'NotInstalled',
  10001: 'AlreadyInstalled',
  10002: 'InvalidParams',
  10003: 'FunctionNotAllowed',
  10004: 'WrongToken',
  10005: 'InvalidTransfer',
  10006: 'InvalidAmount',
  10007: 'PerRequestCapExceeded',
  10008: 'RecipientNotAllowed',
  10009: 'MonthlyCapExceeded',
  10010: 'AllowlistFull',
};

/**
 * Quién firma el pago: un Smart Account de Accesly y la llave ed25519 que
 * está registrada como `Signer::External` en la context rule indicada.
 */
export interface AcceslyX402Signer {
  /** C-address del Smart Account que paga. */
  readonly smartAccount: string;
  /** Pubkey ed25519 raw (32 bytes) registrada en la context rule. */
  readonly signerPubkey: Uint8Array;
  /** Address del `ed25519-verifier` de la red. */
  readonly ed25519VerifierAddress: string;
  /** IDs de context rule que autorizan el `transfer` (uno por auth context). */
  readonly contextRuleIds: readonly number[];
  /**
   * Devuelve una seed ed25519 de 32 bytes, fresca en cada llamada. Se
   * zero-iza en cuanto se produce la firma; el caller NO debe reusarla.
   */
  readonly loadSeed: () => Promise<Uint8Array>;
}

export interface AcceslyX402SchemeOptions {
  /** RPC de Soroban. Obligatorio para `stellar:pubnet`. */
  readonly rpcUrl?: string;
  /**
   * Tope del lado cliente en unidades del token (7 decimales para USDC).
   * Si el 402 pide más, se rechaza antes de firmar.
   */
  readonly maxAmountPerPayment?: bigint;
  /**
   * Re-simula con las auth entries firmadas antes de devolver el payload
   * (default `true`). Es donde corre `__check_auth` y la política on-chain;
   * si la política rechaza, se lanza `X402PolicyRejectedError` sin mandar nada.
   */
  readonly preflight?: boolean;
}

/** El pago no se pudo construir o firmar. */
export class X402PaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'X402PaymentError';
  }
}

/** La política on-chain rechazó el pago en la simulación. */
export class X402PolicyRejectedError extends X402PaymentError {
  readonly code: number | undefined;
  readonly reason: string;

  constructor(code: number | undefined, detail: string) {
    const reason =
      code !== undefined ? (X402_POLICY_ERRORS[code] ?? `Contract#${code}`) : 'Unknown';
    super(`x402 payment rejected by on-chain policy: ${reason}. ${detail}`);
    this.name = 'X402PolicyRejectedError';
    this.code = code;
    this.reason = reason;
  }
}

/**
 * Extrae el código de `Error(Contract, #NNNN)` de un error de simulación.
 * Devuelve el primero que sea de la política x402, o el primero que haya.
 */
export function parseContractErrorCode(message: string): number | undefined {
  const codes = [...message.matchAll(/Error\(Contract, #(\d+)\)/g)].map((m) => Number(m[1]));
  return codes.find((c) => c in X402_POLICY_ERRORS) ?? codes[0];
}

/**
 * Client scheme "exact" de x402 para Smart Accounts de Accesly. Se registra
 * en un `x402Client` igual que el `ExactStellarScheme` oficial:
 *
 * ```ts
 * const client = new x402Client().register('stellar:*', new AcceslyExactStellarScheme(signer));
 * const paidFetch = wrapFetchWithPayment(fetch, client);
 * ```
 */
export class AcceslyExactStellarScheme implements SchemeNetworkClient {
  readonly scheme = 'exact';

  /**
   * USDC es el asset default en Stellar. Lo usa `x402Client` para sus spend
   * controls (topes en USD del lado cliente).
   */
  readonly findDefaultAsset = (asset: string, network: string) =>
    USDC_BY_NETWORK[network] === asset ? { asset, decimals: 7, symbol: 'USDC' } : undefined;

  constructor(
    private readonly signer: AcceslyX402Signer,
    private readonly options: AcceslyX402SchemeOptions = {},
  ) {}

  async createPaymentPayload(
    x402Version: number,
    requirements: PaymentRequirements,
  ): Promise<PaymentPayloadResult> {
    const { network, payTo, asset, amount, maxTimeoutSeconds, extra } = requirements;
    this.validate(requirements);

    const networkPassphrase = NETWORK_PASSPHRASES[network];
    if (!networkPassphrase) throw new X402PaymentError(`unsupported network: ${network}`);
    const rpcUrl = this.options.rpcUrl ?? DEFAULT_RPC_URLS[network];
    if (!rpcUrl) {
      throw new X402PaymentError(`rpcUrl is required for network ${network}`);
    }
    if (!extra?.['areFeesSponsored']) {
      throw new X402PaymentError('exact scheme on Stellar requires areFeesSponsored = true');
    }

    const { contract, nativeToScVal, rpc } = await loadStellarSdk();
    const server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });
    const latest = await server.getLatestLedger();
    const maxLedger = latest.sequence + Math.ceil(maxTimeoutSeconds / LEDGER_SECONDS);

    const tx = await contract.AssembledTransaction.build({
      contractId: asset,
      method: 'transfer',
      args: [
        nativeToScVal(this.signer.smartAccount, { type: 'address' }),
        nativeToScVal(payTo, { type: 'address' }),
        nativeToScVal(amount, { type: 'i128' }),
      ],
      networkPassphrase,
      rpcUrl,
      allowHttp: rpcUrl.startsWith('http://'),
      parseResultXdr: (result) => result,
    });
    throwOnSimulationError(tx.simulation, rpc);

    const missing = tx.needsNonInvokerSigningBy();
    if (missing.length !== 1 || missing[0] !== this.signer.smartAccount) {
      throw new X402PaymentError(
        `expected to sign only for ${this.signer.smartAccount}, got [${missing.join(', ')}]`,
      );
    }

    await tx.signAuthEntries({
      address: this.signer.smartAccount,
      expiration: maxLedger,
      authorizeEntry: (entry, _signer, validUntilLedgerSeq, passphrase) =>
        authorizeSmartAccountEntry(
          this.signer,
          entry,
          validUntilLedgerSeq,
          passphrase ?? networkPassphrase,
        ),
    });

    if (this.options.preflight !== false) {
      await tx.simulate();
      throwOnSimulationError(tx.simulation, rpc);
    }

    if (!tx.built) throw new X402PaymentError('transaction was not assembled');
    return { x402Version, payload: { transaction: tx.built.toXDR() } };
  }

  private validate(req: PaymentRequirements): void {
    if (req.scheme !== 'exact') {
      throw new X402PaymentError(`unsupported scheme: ${req.scheme}`);
    }
    if (!(req.network in NETWORK_PASSPHRASES)) {
      throw new X402PaymentError(`unsupported network: ${req.network}`);
    }
    if (!/^\d+$/.test(req.amount) || BigInt(req.amount) <= 0n) {
      throw new X402PaymentError(`invalid amount: ${req.amount}`);
    }
    const cap = this.options.maxAmountPerPayment;
    if (cap !== undefined && BigInt(req.amount) > cap) {
      throw new X402PaymentError(`amount ${req.amount} exceeds client cap ${cap}`);
    }
  }
}

/**
 * `authorizeEntry` para `AssembledTransaction.signAuthEntries`: fija la
 * expiración, calcula el `signature_payload` de Soroban y firma con el
 * `AuthPayload` del Smart Account.
 */
export async function authorizeSmartAccountEntry(
  signer: AcceslyX402Signer,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entry: any,
  validUntilLedgerSeq: number,
  networkPassphrase: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const { xdr } = await loadStellarSdk();
  const clone = xdr.SorobanAuthorizationEntry.fromXDR(entry.toXDR());
  const credentials = clone.credentials();
  if (credentials.switch().name !== 'sorobanCredentialsAddress') {
    return clone;
  }
  credentials.address().signatureExpirationLedger(validUntilLedgerSeq);

  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: Buffer.from(sha256(new TextEncoder().encode(networkPassphrase))),
      nonce: credentials.address().nonce(),
      signatureExpirationLedger: validUntilLedgerSeq,
      invocation: clone.rootInvocation(),
    }),
  );
  const signaturePayload = sha256(new Uint8Array(preimage.toXDR()));

  const { signedAuthEntryXdr } = await signSorobanAuthEntry({
    signaturePayloadHashBase64: bytesToBase64(signaturePayload),
    contextRuleIds: signer.contextRuleIds,
    placeholderAuthEntryXdr: clone.toXDR('base64'),
    ed25519Seed: await signer.loadSeed(),
    ed25519VerifierAddress: signer.ed25519VerifierAddress,
    ownerPubkey: signer.signerPubkey,
  });
  return xdr.SorobanAuthorizationEntry.fromXDR(signedAuthEntryXdr, 'base64');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function throwOnSimulationError(simulation: any, rpc: any): void {
  if (simulation && rpc.Api.isSimulationError(simulation)) {
    const detail = String(simulation.error);
    const code = parseContractErrorCode(detail);
    if (code !== undefined && code in X402_POLICY_ERRORS) {
      throw new X402PolicyRejectedError(code, detail.split('\n')[0] ?? '');
    }
    throw new X402PaymentError(`simulation failed: ${detail.split('\n')[0]}`);
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }
  return Buffer.from(bytes).toString('base64');
}
