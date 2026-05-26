/**
 * AES-256-GCM authenticated encryption.
 *
 * Wraps `@noble/ciphers/aes`. The auth tag is appended to the ciphertext, as
 * is standard for AEAD APIs (and what the backend openapi spec assumes for
 * `EncryptedFragment.ciphertext`).
 *
 * Nonce reuse with the same key is catastrophic for AES-GCM. We generate a
 * fresh 96-bit nonce on every encrypt and never expose a "nonce override"
 * parameter to consumers.
 */

import { gcm } from '@noble/ciphers/aes';
import { getRandomBytes } from './random.js';

export const AES_KEY_LENGTH = 32; // 256 bits
export const AES_GCM_NONCE_LENGTH = 12; // 96 bits, recommended by NIST SP 800-38D
export const AES_GCM_TAG_LENGTH = 16; // 128 bits

export interface EncryptedEnvelope {
  /** Random 12-byte nonce used for this encryption. */
  readonly nonce: Uint8Array;
  /** AES-GCM ciphertext with the 16-byte auth tag appended. */
  readonly ciphertext: Uint8Array;
  /** Optional additional authenticated data, kept for round-tripping. */
  readonly aad?: Uint8Array;
}

/**
 * Encrypts `plaintext` with `key` and optional `aad`. The returned envelope
 * contains a fresh nonce and ciphertext with the auth tag appended.
 */
export function encryptAesGcm(
  plaintext: Uint8Array,
  key: Uint8Array,
  aad?: Uint8Array,
): EncryptedEnvelope {
  assertKeyLength(key);
  const nonce = getRandomBytes(AES_GCM_NONCE_LENGTH);
  const cipher = gcm(key, nonce, aad);
  const ciphertext = cipher.encrypt(plaintext);
  return aad !== undefined ? { nonce, ciphertext, aad } : { nonce, ciphertext };
}

/**
 * Decrypts the envelope. Throws if the auth tag does not validate or if the
 * key/nonce/aad does not match what was used for encryption.
 *
 * The returned plaintext is a fresh buffer; the caller is responsible for
 * zeroizing it after use if sensitive.
 */
export function decryptAesGcm(envelope: EncryptedEnvelope, key: Uint8Array): Uint8Array {
  assertKeyLength(key);
  if (envelope.nonce.length !== AES_GCM_NONCE_LENGTH) {
    throw new RangeError(
      `decryptAesGcm: nonce must be ${AES_GCM_NONCE_LENGTH} bytes, got ${envelope.nonce.length}`,
    );
  }
  if (envelope.ciphertext.length < AES_GCM_TAG_LENGTH) {
    throw new RangeError(
      `decryptAesGcm: ciphertext too short to contain auth tag (${envelope.ciphertext.length} bytes)`,
    );
  }
  const cipher = gcm(key, envelope.nonce, envelope.aad);
  return cipher.decrypt(envelope.ciphertext);
}

function assertKeyLength(key: Uint8Array): void {
  if (key.length !== AES_KEY_LENGTH) {
    throw new RangeError(`AES-256-GCM key must be ${AES_KEY_LENGTH} bytes, got ${key.length}`);
  }
}
