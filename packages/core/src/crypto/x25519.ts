/**
 * X25519 elliptic-curve Diffie-Hellman.
 *
 * Used for the session-key exchange with the Accesly backend when retrieving
 * F2: the SDK posts its ephemeral X25519 public key, the backend replies with
 * an envelope encrypted under a key derived from the shared secret.
 *
 * Built on `@noble/curves/ed25519` which exports `x25519` from the same file.
 * The shared secret is NOT a key on its own — always pass it through HKDF.
 */

import { x25519 } from '@noble/curves/ed25519';
import { getRandomBytes } from './random.js';

export const X25519_PRIVATE_KEY_LENGTH = 32;
export const X25519_PUBLIC_KEY_LENGTH = 32;
export const X25519_SHARED_SECRET_LENGTH = 32;

export interface X25519Keypair {
  /** 32-byte raw private scalar. Treat as secret; zeroize after use. */
  readonly privateKey: Uint8Array;
  /** 32-byte X25519 public key. */
  readonly publicKey: Uint8Array;
}

/**
 * Generates an ephemeral X25519 keypair from CSPRNG bytes.
 *
 * The standard X25519 private-key clamping is applied internally by noble.
 */
export function generateX25519Keypair(): X25519Keypair {
  const privateKey = getRandomBytes(X25519_PRIVATE_KEY_LENGTH);
  const publicKey = x25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

/**
 * Derives the X25519 public key from a raw private scalar.
 */
export function x25519PublicKey(privateKey: Uint8Array): Uint8Array {
  if (privateKey.length !== X25519_PRIVATE_KEY_LENGTH) {
    throw new RangeError(
      `x25519PublicKey: privateKey must be ${X25519_PRIVATE_KEY_LENGTH} bytes, got ${privateKey.length}`,
    );
  }
  return x25519.getPublicKey(privateKey);
}

/**
 * Computes the X25519 shared secret. Always pipe the result through HKDF before
 * using as an encryption/MAC key.
 *
 * Throws on malformed inputs. Does NOT reject all-zero output (which can occur
 * with adversarial public keys); the caller's HKDF step provides domain
 * separation that mitigates this in practice.
 */
export function x25519Ecdh(privateKey: Uint8Array, theirPublicKey: Uint8Array): Uint8Array {
  if (privateKey.length !== X25519_PRIVATE_KEY_LENGTH) {
    throw new RangeError(
      `x25519Ecdh: privateKey must be ${X25519_PRIVATE_KEY_LENGTH} bytes, got ${privateKey.length}`,
    );
  }
  if (theirPublicKey.length !== X25519_PUBLIC_KEY_LENGTH) {
    throw new RangeError(
      `x25519Ecdh: theirPublicKey must be ${X25519_PUBLIC_KEY_LENGTH} bytes, got ${theirPublicKey.length}`,
    );
  }
  return x25519.getSharedSecret(privateKey, theirPublicKey);
}
