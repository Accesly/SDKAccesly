/**
 * MPC split — generate a fresh ed25519 keypair, split the seed with Shamir
 * (2-of-3), encrypt each fragment under a caller-supplied key, and zeroize all
 * intermediate secret state.
 *
 * Allow-listed in `audit-no-custody.mjs` to use `splitSecret`.
 *
 * Hito 2 leaves "where the encryption keys come from" to the caller. Hito 4 will
 * wire WebAuthn PRF + email PBKDF2 derivations on top of this primitive.
 */

import { sha256 } from '@noble/hashes/sha2';
import { encryptAesGcm, type EncryptedEnvelope } from '../crypto/aesgcm.js';
import { generateKeypair } from '../crypto/keypair.js';
import { encodeShare, splitSecret } from '../crypto/shamir.js';
import { withZeroize, zeroize } from '../crypto/zeroize.js';

/** Total number of shares produced. */
export const TOTAL_FRAGMENTS = 3;
/** Number of shares required to reconstruct the seed. */
export const RECONSTRUCT_THRESHOLD = 2;

/**
 * A 3-tuple of distinct AES-256-GCM encryption keys, one per fragment.
 * The caller derives these from device material, server material, and email
 * recovery material respectively (see Hito 4 for the actual derivations).
 */
export type FragmentEncryptionKeys = readonly [
  /** Key used to encrypt fragment F1 (device-bound). */
  Uint8Array,
  /** Key used to encrypt fragment F2 (server-stored). */
  Uint8Array,
  /** Key used to encrypt fragment F3 (email-recovery-bound). */
  Uint8Array,
];

export interface CreateWalletParams {
  /** UTF-8 encoded user identifier (typically an email address). */
  readonly emailBytes: Uint8Array;
  /** High-entropy salt for the email commitment (32 bytes recommended). */
  readonly emailSalt: Uint8Array;
  /** Three distinct AES-256-GCM keys, one per fragment. */
  readonly encryptionKeys: FragmentEncryptionKeys;
  /**
   * Optional additional authenticated data bound to each fragment envelope.
   * If provided, the same AAD must be supplied at decrypt time. Useful for
   * binding a fragment to an appId / user-sub claim.
   */
  readonly fragmentAad?: Uint8Array;
}

/** Three encrypted fragments in F1/F2/F3 order. */
export type EncryptedFragments = readonly [EncryptedEnvelope, EncryptedEnvelope, EncryptedEnvelope];

export interface CreateWalletResult {
  /** Raw ed25519 public key (32 bytes). Send to the backend. */
  readonly publicKey: Uint8Array;
  /** SHA-256(email || salt). 32 bytes. Send to the backend. */
  readonly emailCommitment: Uint8Array;
  /** Encrypted fragments. F1 stays on device; F2 and F3 go to the backend. */
  readonly encryptedFragments: EncryptedFragments;
}

/**
 * Generates a fresh wallet keypair, splits the seed 2-of-3, encrypts each
 * fragment, and returns only what is safe to leak outside the secure context.
 *
 * Zeroization:
 *  - The ed25519 seed is zeroed before return.
 *  - Plain Shamir shares are zeroed after encryption.
 *  - Intermediate share encodings are zeroed after encryption.
 *
 * Throws if any of the three encryption keys is not 32 bytes.
 */
export function createWallet(params: CreateWalletParams): CreateWalletResult {
  if (params.emailBytes.length === 0) {
    throw new RangeError('createWallet: emailBytes must be non-empty');
  }
  if (params.emailSalt.length === 0) {
    throw new RangeError('createWallet: emailSalt must be non-empty');
  }
  // assertKeyLength is performed by encryptAesGcm; nothing else to validate here.

  const keypair = generateKeypair();

  return withZeroize([keypair.privateSeed], () => {
    const shares = splitSecret(keypair.privateSeed, RECONSTRUCT_THRESHOLD, TOTAL_FRAGMENTS);
    if (shares.length !== TOTAL_FRAGMENTS) {
      // Defense-in-depth: splitSecret guarantees this but it's cheap to assert.
      throw new Error(`createWallet: expected ${TOTAL_FRAGMENTS} shares, got ${shares.length}`);
    }

    const encryptedFragments = shares.map((share, idx) => {
      const encoded = encodeShare(share);
      try {
        return encryptAesGcm(encoded, params.encryptionKeys[idx]!, params.fragmentAad);
      } finally {
        zeroize(encoded);
        zeroize(share.data);
      }
    }) as unknown as [EncryptedEnvelope, EncryptedEnvelope, EncryptedEnvelope];

    const commitInput = concat(params.emailBytes, params.emailSalt);
    const emailCommitment = sha256(commitInput);
    zeroize(commitInput);

    return {
      publicKey: keypair.publicKey,
      emailCommitment,
      encryptedFragments,
    } satisfies CreateWalletResult;
  });
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
