/**
 * Helpers del lado del que paga: `fetch` que resuelve 402 solo, y los dos
 * signers que soporta Accesly (MPC 2-de-3 y session key).
 */

import {
  AcceslyExactStellarScheme,
  type AcceslyX402SchemeOptions,
  type AcceslyX402Signer,
} from './x402.js';

export interface MpcX402SignerParams {
  readonly smartAccount: string;
  /** Pubkey del owner (la de `bootstrap`), 32 bytes. */
  readonly ownerPubkey: Uint8Array;
  readonly ed25519VerifierAddress: string;
  /** Rule que cubre el `transfer` del token (p. ej. `biometric-tx`). */
  readonly contextRuleId: number;
  /**
   * Reconstruye la seed 2-de-3 con `@accesly/core/mpc` (F1 del device + F2
   * del servidor). Se llama una vez por pago; la seed se zero-iza al firmar.
   */
  readonly reconstructSeed: () => Promise<Uint8Array>;
}

/** Signer que firma cada pago con la llave maestra reconstruida 2-de-3. */
export function mpcX402Signer(params: MpcX402SignerParams): AcceslyX402Signer {
  return {
    smartAccount: params.smartAccount,
    signerPubkey: params.ownerPubkey,
    ed25519VerifierAddress: params.ed25519VerifierAddress,
    contextRuleIds: [params.contextRuleId],
    loadSeed: params.reconstructSeed,
  };
}

export interface SessionKeyX402SignerParams {
  readonly smartAccount: string;
  /** Pubkey de la session key, 32 bytes. */
  readonly sessionPubkey: Uint8Array;
  /** Seed de la session key. Se pasa una copia por pago. */
  readonly sessionSeed: Uint8Array;
  readonly ed25519VerifierAddress: string;
  /** Rule de la session key (la que tiene la `x402-spending-policy`). */
  readonly contextRuleId: number;
}

/**
 * Signer que firma con la session key. La session key solo puede mover el
 * token dentro de los topes y la allowlist que impone la política on-chain.
 */
export function sessionKeyX402Signer(params: SessionKeyX402SignerParams): AcceslyX402Signer {
  return {
    smartAccount: params.smartAccount,
    signerPubkey: params.sessionPubkey,
    ed25519VerifierAddress: params.ed25519VerifierAddress,
    contextRuleIds: [params.contextRuleId],
    loadSeed: async () => params.sessionSeed.slice(),
  };
}

/**
 * Devuelve un `fetch` que, ante un 402, paga con el Smart Account y reintenta.
 * Carga `@x402/core` y `@x402/fetch` en runtime (peer deps opcionales).
 */
export async function createAcceslyX402Fetch(
  signer: AcceslyX402Signer,
  options: AcceslyX402SchemeOptions & { readonly fetch?: typeof globalThis.fetch } = {},
): Promise<typeof globalThis.fetch> {
  const [{ x402Client }, { wrapFetchWithPayment }] = await Promise.all([
    import('@x402/core/client'),
    import('@x402/fetch'),
  ]);
  const client = new x402Client().register(
    'stellar:*',
    new AcceslyExactStellarScheme(signer, options),
  );
  return wrapFetchWithPayment(options.fetch ?? globalThis.fetch, client) as typeof globalThis.fetch;
}
