/**
 * Ed25519 keypair generation, signing and verification.
 *
 * Thin wrapper over `@noble/curves/ed25519`. The seed (32-byte private scalar
 * input) is what we keep in memory during signing — callers must zeroize after
 * use. This file is allow-listed in `audit-no-custody.mjs` to use `ed25519.sign`.
 */

import { ed25519 } from '@noble/curves/ed25519';
import { getRandomBytes } from './random.js';

/**
 * Length, in bytes, of a raw ed25519 private seed.
 */
export const ED25519_SEED_LENGTH = 32;

/**
 * Length, in bytes, of a raw ed25519 public key.
 */
export const ED25519_PUBLIC_KEY_LENGTH = 32;

/**
 * Length, in bytes, of an ed25519 signature.
 */
export const ED25519_SIGNATURE_LENGTH = 64;

export interface Ed25519Keypair {
  /** 32-byte raw private seed. Treat as secret; zeroize after use. */
  readonly privateSeed: Uint8Array;
  /** 32-byte raw public key derived from the seed. */
  readonly publicKey: Uint8Array;
}

/**
 * Generates a new ed25519 keypair from CSPRNG bytes.
 */
export function generateKeypair(): Ed25519Keypair {
  const privateSeed = getRandomBytes(ED25519_SEED_LENGTH);
  const publicKey = ed25519.getPublicKey(privateSeed);
  return { privateSeed, publicKey };
}

/**
 * Derives the public key from a raw ed25519 seed without exposing the seed.
 *
 * Throws if `seed` is not exactly 32 bytes.
 */
export function publicKeyFromSeed(seed: Uint8Array): Uint8Array {
  if (seed.length !== ED25519_SEED_LENGTH) {
    throw new RangeError(
      `publicKeyFromSeed: seed must be ${ED25519_SEED_LENGTH} bytes, got ${seed.length}`,
    );
  }
  return ed25519.getPublicKey(seed);
}

/**
 * Signs `message` with the ed25519 seed.
 *
 * The caller is responsible for zeroizing `privateSeed` after the call.
 * The signature is non-malleable and 64 bytes long.
 */
export function signEd25519(message: Uint8Array, privateSeed: Uint8Array): Uint8Array {
  if (privateSeed.length !== ED25519_SEED_LENGTH) {
    throw new RangeError(
      `signEd25519: privateSeed must be ${ED25519_SEED_LENGTH} bytes, got ${privateSeed.length}`,
    );
  }
  return ed25519.sign(message, privateSeed);
}

/**
 * Verifies an ed25519 signature.
 *
 * Returns `false` (never throws) on malformed inputs or mismatched length —
 * cryptographic primitives must be hard to misuse.
 */
export function verifyEd25519(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  if (signature.length !== ED25519_SIGNATURE_LENGTH) return false;
  if (publicKey.length !== ED25519_PUBLIC_KEY_LENGTH) return false;
  try {
    return ed25519.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}
