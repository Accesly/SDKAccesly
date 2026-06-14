/**
 * Types for the SEP-30 recovery orchestrator.
 *
 * The orchestrator coordinates 4 actors (SDK prover, Soroban RPC, the
 * recover backend Lambda, the local DeviceStore) so callers — both the
 * `@accesly/react` hook and the example app — drive the flow through one
 * promise.
 */

import type { EncryptedFragmentWire } from '../types/api.js';

/**
 * Structural type of `@accesly/zkemail`'s prover. Lives here so
 * `@accesly/core` does not take a hard runtime dep on `@accesly/zkemail`.
 */
export interface ZkEmailProverHandle {
  prove(args: {
    readonly eml: string;
    readonly recovery: {
      readonly recipientEmail: string;
      readonly walletAddress: string;
      readonly newPasskeyPubkey: Uint8Array;
      readonly domainSalt: Uint8Array;
    };
    readonly rsaModulus: bigint;
  }): Promise<{
    readonly bundle: {
      readonly proof: {
        readonly a: Uint8Array;
        readonly b: Uint8Array;
        readonly c: Uint8Array;
      };
      readonly publicSignals: readonly Uint8Array[];
    };
    readonly elapsedMs: number;
  }>;
}

export interface RecoverWalletInput {
  /** Smart Account contract address (C…). The user must know/remember it. */
  readonly walletAddress: string;
  /** Recovery email — must match the `email_commitment` stored in the SA. */
  readonly email: string;
  /** Raw .eml the user downloaded via Gmail "Show original". */
  readonly eml: string;
  /** RSA-2048 modulus of the DKIM key that signed the .eml. */
  readonly rsaModulus: bigint;
  /** New secp256r1 passkey pubkey (65 bytes uncompressed). */
  readonly newPasskeyPubkey: Uint8Array;
  /**
   * The SA's `email_commitment` was computed with this salt at onboarding.
   * The recovery flow keeps the same commitment — recovery rotates the
   * passkey + master key, not the email identity. The user must have stored
   * this salt at onboarding (export-on-create).
   *
   * If you do NOT have it, recovery is impossible: the binding (2) check
   * in the verifier (`recipient_email_hash == key_data`) will fail because
   * the new commitment will differ.
   */
  readonly emailSalt: Uint8Array;
  /**
   * Local-device encryption keys for the NEW Shamir fragments. The caller
   * derives them from the new passkey's PRF + a password / device-bound
   * material. Same shape as `createWallet`. F2's key is the one the backend
   * uses to gate access via ECDH; F3's is derived from the email password
   * (PBKDF2). F1's key never leaves the device.
   */
  readonly newEncryptionKeys: readonly [Uint8Array, Uint8Array, Uint8Array];
  /** Stellar network passphrase (testnet or mainnet). */
  readonly networkPassphrase: string;
  /** Soroban RPC URL — used for the rule queries + the eventual submit. */
  readonly sorobanRpcUrl: string;
  /** Address of the ed25519 verifier contract (shared per network). */
  readonly ed25519VerifierAddress: string;
  /** Address of the secp256r1 verifier contract (shared per network). */
  readonly secp256r1VerifierAddress: string;
  /** Address of the zk-email verifier v2 contract (per network). */
  readonly zkEmailVerifierAddress: string;
  /**
   * SHA-256 of the DKIM "From" domain (e.g. `sha256("gmail.com")`). The SDK
   * passes this raw inside `sig_data` so the on-chain DKIM registry lookup
   * can match `(domain_hash, dkim_pk_hash)`.
   */
  readonly dkimDomainHash: Uint8Array;
  /** ZK email prover instance (lazy-loaded by the app, NOT a runtime dep). */
  readonly prover: ZkEmailProverHandle;
}

export interface RecoverWalletResult {
  readonly walletAddress: string;
  /** Soroban tx hash of the on-chain rotation. */
  readonly txHash: string;
  /** Submit status returned by the backend (`PENDING` / `DUPLICATE` / …). */
  readonly status: string;
  /**
   * The new master key publicly verifiable bytes (ed25519 pubkey). The
   * caller persists this client-side as the SA's new owner.
   */
  readonly newOwnerPubkey: Uint8Array;
  /**
   * Encrypted F1 to persist locally. F2/F3 are already in the backend.
   * The caller hands this to the `DeviceStore`.
   */
  readonly fragmentF1Encrypted: EncryptedFragmentWire;
  /** Total wall-clock elapsed in ms. Useful for UI feedback. */
  readonly elapsedMs: number;
  /** Per-step timings for debugging. */
  readonly stepTimings: {
    readonly shamirMs: number;
    readonly proofMs: number;
    readonly queryRulesMs: number;
    readonly envelopeMs: number;
    readonly submitMs: number;
  };
}

export interface RecoverProgressCallback {
  /** Fires at each milestone. The UI can render a stepper. */
  (step: RecoverStep): void;
}

export type RecoverStep =
  | 'shamir_split'
  | 'generating_proof'
  | 'querying_rules'
  | 'building_envelope'
  | 'submitting'
  | 'persisting_local';
