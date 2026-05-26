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
}
