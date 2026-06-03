/**
 * Unwrap the session-wrapped F2 envelope returned by `POST /fragments/2`.
 *
 * The backend wraps F2 in a per-request session layer (X25519 ECDH +
 * HKDF-SHA256 → AES-256-GCM). The SDK undoes this layer here and recovers
 * the EncryptedFragment that the SDK itself stored at createWallet time —
 * which still needs to be decrypted with the F2 derivation key the caller
 * derived from user credentials (out of scope of this helper).
 *
 * Backend reference:
 *   CloudServices-accesly/lambdas/shared/src/session-keys.ts
 *   info = "accesly:getFragment2:v1"
 *   salt = empty
 *   AES-256-GCM, 12-byte nonce, 16-byte tag returned separately.
 */

import { gcm } from '@noble/ciphers/aes';

import { hkdfSha256 } from './kdf.js';
import { x25519Ecdh } from './x25519.js';
import { zeroize } from './zeroize.js';

const HKDF_INFO = new TextEncoder().encode('accesly:getFragment2:v1');
const HKDF_SALT = new Uint8Array(0);
const SESSION_KEY_LENGTH = 32;

export interface SessionFragment2Response {
  /** Base64 12-byte AES-GCM nonce. */
  readonly nonce: string;
  /** Base64 AES-GCM ciphertext (does NOT include the auth tag). */
  readonly ciphertext: string;
  /** Base64 16-byte AES-GCM auth tag. */
  readonly authTag: string;
  /** Base64 32-byte server X25519 ephemeral public key. */
  readonly serverEphemeralPubkey: string;
}

export interface UnwrappedFragment2 {
  /**
   * Raw plaintext bytes the backend wrapped — typically a UTF-8 JSON of the
   * original `EncryptedFragment` envelope (ciphertext + nonce + algo). The
   * caller parses + AES-GCM-decrypts again with its F2 key to get F2 plain.
   */
  readonly plaintext: Uint8Array;
}

/**
 * Given the backend response and the matching ephemeral X25519 private key
 * the SDK used in the request, decrypts the session layer and returns the
 * inner plaintext (the EncryptedFragment JSON serialized as bytes).
 *
 * Both the client ephemeral private key and the derived session key are
 * zero-ized at the end. The caller MUST NOT reuse `clientEphemeralPrivKey`.
 */
export function unwrapSessionFragment2(
  response: SessionFragment2Response,
  clientEphemeralPrivKey: Uint8Array,
): UnwrappedFragment2 {
  const serverPub = base64ToBytes(response.serverEphemeralPubkey);
  const nonce = base64ToBytes(response.nonce);
  const ciphertext = base64ToBytes(response.ciphertext);
  const authTag = base64ToBytes(response.authTag);

  if (serverPub.length !== 32) {
    throw new Error(
      `unwrapSessionFragment2: serverEphemeralPubkey must be 32 bytes, got ${serverPub.length}`,
    );
  }
  if (nonce.length !== 12) {
    throw new Error(`unwrapSessionFragment2: nonce must be 12 bytes, got ${nonce.length}`);
  }
  if (authTag.length !== 16) {
    throw new Error(`unwrapSessionFragment2: authTag must be 16 bytes, got ${authTag.length}`);
  }

  const shared = x25519Ecdh(clientEphemeralPrivKey, serverPub);
  const sessionKey = hkdfSha256(shared, HKDF_SALT, HKDF_INFO, SESSION_KEY_LENGTH);

  // Noble's AES-GCM expects ciphertext with the auth tag appended.
  const ctWithTag = new Uint8Array(ciphertext.length + authTag.length);
  ctWithTag.set(ciphertext, 0);
  ctWithTag.set(authTag, ciphertext.length);

  let plaintext: Uint8Array;
  try {
    plaintext = gcm(sessionKey, nonce).decrypt(ctWithTag);
  } finally {
    zeroize(shared);
    zeroize(sessionKey);
    zeroize(clientEphemeralPrivKey);
  }

  return { plaintext };
}

function base64ToBytes(s: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(s);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  return new Uint8Array(Buffer.from(s, 'base64'));
}
