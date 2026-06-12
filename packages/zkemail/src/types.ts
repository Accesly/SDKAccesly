/**
 * Public types for the `@accesly/zkemail` prover.
 *
 * The prover lifecycle:
 *
 *   eml file ──▶ parseEml ──▶ buildCircuitInputs ──▶ prove ──▶ formatForSoroban ──▶ contract.verify(proof, signals)
 *
 * Each stage's input/output is typed here so consumers can mix-and-match
 * (e.g. parse client-side, prove in a worker, format right before tx submit).
 */

/** Recovery parameters that bind a proof to the user's intended action. */
export interface RecoveryParams {
  /** Lowercase, trimmed recipient email — the address that received the DKIM-signed message. */
  readonly recipientEmail: string;
  /** Wallet address being recovered (G... strkey). */
  readonly walletAddress: string;
  /** New passkey public key (secp256r1, 64 bytes) that will replace the lost one. */
  readonly newPasskeyPubkey: Uint8Array;
  /**
   * Domain salt that the contract expects, per D1. 32 bytes fixed at deploy
   * time (see `accesly-zkemail/docs/Design_Decisions.md` D1.4).
   */
  readonly domainSalt: Uint8Array;
}

/**
 * Raw circuit inputs ready to feed snarkjs. Field names match the circom
 * declaration in `accesly-zkemail/circuits/accesly_email.circom`.
 */
export interface CircuitInputs {
  // From the .eml
  readonly emailHeader: string[]; // bytes, each as decimal string (snarkjs convention)
  readonly emailHeaderLength: string; // unpadded length, decimal string
  readonly pubkey: string[]; // RSA-2048 modulus limbs, 17 × 121-bit decimal strings
  readonly signature: string[]; // RSA signature limbs, 17 × 121-bit decimal strings

  // From the recovery context (used to derive recipient_email_hash etc.)
  readonly recipientEmailNormalized: string[]; // bytes, decimal strings
  readonly recipientEmailLength: string;
  readonly domainSalt: string[]; // 32 bytes, decimal strings
  readonly walletAddress: string[]; // 32 bytes (raw strkey decoded), decimal strings
  readonly newPasskeyPubkey: string[]; // 64 bytes, decimal strings

  // Header range pointers (zk-email convention — offsets into emailHeader)
  readonly subjectIndex: string;
  readonly subjectLength: string;
  readonly fromIndex: string;
  readonly fromLength: string;
  readonly dateIndex: string;
  readonly dateLength: string;
  readonly toIndex: string;
  readonly toLength: string;
}

/**
 * snarkjs.groth16.fullProve output (BLS12-381). Coordinates are decimal
 * strings; G2 points are `[[X.c0, X.c1], [Y.c0, Y.c1], [Z.c0, Z.c1]]`.
 */
export interface SnarkjsProof {
  readonly pi_a: [string, string, string];
  readonly pi_b: [[string, string], [string, string], [string, string]];
  readonly pi_c: [string, string, string];
  readonly protocol: 'groth16';
  readonly curve: 'bls12381';
}

/**
 * Soroban-ready proof + signals. Each `Uint8Array` matches the layout the
 * Rust contract expects via `BytesN<N>::from_array`:
 *
 *   - G1 = 96 bytes (X 48 || Y 48 BE).
 *   - G2 = 192 bytes (X.c1 || X.c0 || Y.c1 || Y.c0).
 *   - Fr public signal = 32 bytes BE.
 *
 * Total: 384 bytes proof + 14 × 32 = 448 bytes signals. ~830 bytes per tx
 * before XDR overhead.
 */
export interface SorobanProofBundle {
  readonly proof: {
    readonly a: Uint8Array; // 96
    readonly b: Uint8Array; // 192
    readonly c: Uint8Array; // 96
  };
  readonly publicSignals: readonly Uint8Array[]; // 14 × 32
}

/**
 * Configuration for `createZkEmailProver`. The CDN URL serves the wasm
 * (witness generator) and zkey (Groth16 proving key). See
 * `accesly-zkemail/docs/Phase1_Measurements.md` — ~282 MB brotli total.
 */
export interface ZkEmailProverConfig {
  /** Base URL where `accesly_email.wasm` and `accesly_email_final.zkey` live. */
  readonly artifactsBaseUrl: string;
  /**
   * Optional version tag for cache busting. Recommended: pin to the
   * ceremony tag (e.g. `v1.0.0-ceremony-2026-08`) so deploys to the same
   * URL prefix don't poison browser caches.
   */
  readonly artifactVersion?: string;
  /**
   * Optional override for `fetch`. Lets consumers inject a custom client
   * (Service Worker pre-warm, range-request progressive download, retry
   * with backoff). Defaults to global `fetch`.
   */
  readonly fetch?: typeof globalThis.fetch;
}

/** Result of a successful proof generation. */
export interface ProveResult {
  readonly bundle: SorobanProofBundle;
  /** Time spent on witness + proof generation, milliseconds. */
  readonly elapsedMs: number;
}
