/**
 * WebAuthn / passkey types shared between register, verify, and storage.
 *
 * The SDK uses passkeys to:
 *  1. Prove user presence at signing time (always).
 *  2. Derive a deterministic encryption key for F1 via the PRF extension,
 *     when the browser supports it (Chrome 116+, Safari 18+, Edge 116+).
 *
 * When PRF is NOT supported (current Firefox), the SDK falls back to a random
 * encryption key stored alongside the credential. The passkey still gates
 * signing via user verification, but F1 is recoverable from device storage
 * alone — the trade-off is documented.
 */

import type { EncryptedEnvelope } from '../crypto/aesgcm.js';

/**
 * Public key of an existing wallet passkey, plus the credentialId needed to
 * trigger `navigator.credentials.get` for that exact credential.
 */
export interface PasskeyDescriptor {
  /** 32+ bytes returned by the authenticator at registration time. */
  readonly credentialId: Uint8Array;
  /** Uncompressed 65-byte secp256r1 public key extracted from the COSE blob. */
  readonly secp256r1Pubkey: Uint8Array;
  /** Whether the WebAuthn PRF extension is available for this credential. */
  readonly prfSupported: boolean;
}

/**
 * Stable per-user record persisted in the device's `DeviceStore`. The
 * fragmentF1Encrypted ciphertext is decryptable ONLY by re-running the PRF
 * extension with the same `prfSalt` (PRF mode) or with a stored device key
 * (fallback mode).
 */
export interface CredentialRecord {
  /** Cognito username (the email). Used as the primary key. */
  readonly username: string;
  /** Passkey credentialId. */
  readonly credentialId: Uint8Array;
  /** Uncompressed 65-byte secp256r1 public key. */
  readonly secp256r1Pubkey: Uint8Array;
  /** F1 encrypted with the PRF-derived (or fallback) AES-256-GCM key. */
  readonly fragmentF1Encrypted: EncryptedEnvelope;
  /** 32-byte salt fed into the WebAuthn PRF extension. */
  readonly prfSalt: Uint8Array;
  /**
   * If non-empty, F1's encryption key is `prfSalt`-bound to the passkey via
   * PRF and CANNOT be recovered from this record alone. Empty means the SDK
   * fell back to storing the AES key alongside (less secure, see types
   * doc-comment).
   */
  readonly fallbackKeyMaterial: Uint8Array;
  /** Stellar Smart Account contract address (`C…`) once createWallet returned. */
  readonly walletAddress: string | null;
  /** ms-epoch creation timestamp. */
  readonly createdAt: number;
  /* ------------------------------------------------------------------ */
  /* Optional fields added in v0.3.0 — backwards compatible. Populated by */
  /* `wallet.createWallet` when `credentialId` + `prfSalt` are provided so */
  /* a ghost-wallet deploy can be retried via `wallet.retryDeploy`.       */
  /* ------------------------------------------------------------------ */
  /** 32-byte ed25519 public key of the wallet owner. Needed for retry POST. */
  readonly publicKey?: Uint8Array;
  /** 32-byte `SHA-256(email || salt)` commitment. Needed for retry POST. */
  readonly emailCommitment?: Uint8Array;
  /** Encrypted F2 fragment — kept locally only to enable idempotent retry. */
  readonly fragmentF2Encrypted?: EncryptedEnvelope;
  /** Encrypted F3 fragment — kept locally only to enable idempotent retry. */
  readonly fragmentF3Encrypted?: EncryptedEnvelope;
  /**
   * Last-known on-chain confirmation status from the backend:
   *  - `true`  → backend confirmed the contract is live on Soroban
   *  - `false` → backend has the record but Soroban RPC says no contract yet
   *              (ghost wallet — retry the deploy with `wallet.retryDeploy`)
   *  - `null`  → backend could not reach Soroban RPC; treat as unknown
   *  - omitted → never queried after the initial POST
   */
  readonly onChain?: boolean | null;
  /**
   * Testnet only — `true` once the SDK has successfully triggered Stellar's
   * friendbot to fund the Smart Account with native XLM. Idempotency flag
   * so we don't repeatedly hit friendbot on every login. Always `undefined`
   * on mainnet (friendbot doesn't exist there; users fund via onramps).
   */
  readonly testnetFunded?: boolean;
  /* ------------------------------------------------------------------ */
  /* Added in v1.1.0 — backwards compatible (todos opcionales).         */
  /* ------------------------------------------------------------------ */
  /**
   * 32-byte salt usado en `HKDF(prfOutput, encryptionSalt, info)` para derivar
   * las llaves AES de F1 y F2. Persistido aquí para que `wallet.unlockForSigning`
   * pueda recuperar las mismas keys en cada sesión sin que el integrador tenga
   * que guardarlas en su propio store. Si está omitido (wallets pre-1.1.0), el
   * SDK lo asume re-derivado con `prfSalt` como HKDF salt — compatible con el
   * código del example legacy.
   */
  readonly encryptionSalt?: Uint8Array;
  /**
   * Bucket libre para metadata específica del integrador. Casos típicos:
   * `{ kycCompleted: true, displayName: 'Daniel', avatarUrl: '...' }`. El SDK
   * no toca ni lee este campo — solo lo persiste tal cual. Útil para no tener
   * que mantener un store paralelo al `DeviceStore` del SDK.
   *
   * El integrador es responsable de que los valores sean JSON-serializable
   * (no Uint8Array, no Date — usá strings/numbers/booleans/objects/arrays).
   */
  readonly metadata?: Record<string, unknown>;
}
