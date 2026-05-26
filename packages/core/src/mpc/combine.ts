/**
 * MPC combine — given any two of the three encrypted fragments and the
 * corresponding decryption keys, decrypt, run Shamir interpolation, and return
 * the reconstructed ed25519 seed plus its public key.
 *
 * Allow-listed in `audit-no-custody.mjs` to use `shamirCombine`.
 *
 * The returned `privateSeed` is hot — the caller MUST zeroize it as soon as
 * the signature it was reconstructed for is produced. Use `withZeroize` from
 * `@accesly/core/crypto` for that.
 */

import { decryptAesGcm, type EncryptedEnvelope } from '../crypto/aesgcm.js';
import { ED25519_SEED_LENGTH, publicKeyFromSeed } from '../crypto/keypair.js';
import { decodeShare, shamirCombine, type ShamirShare } from '../crypto/shamir.js';
import { zeroize } from '../crypto/zeroize.js';

/** An encrypted fragment with the AES-GCM key needed to decrypt it. */
export interface EncryptedFragmentInput {
  readonly envelope: EncryptedEnvelope;
  readonly key: Uint8Array;
}

export interface ReconstructKeyParams {
  /**
   * Exactly two encrypted fragments. Order does not matter (the Shamir index
   * is encoded inside each decrypted share blob).
   */
  readonly fragments: readonly [EncryptedFragmentInput, EncryptedFragmentInput];
}

export interface ReconstructKeyResult {
  /** Reconstructed 32-byte ed25519 seed. CALLER MUST ZEROIZE. */
  readonly privateSeed: Uint8Array;
  /** 32-byte ed25519 public key, derived from the seed for convenience. */
  readonly publicKey: Uint8Array;
}

/**
 * Reconstructs the ed25519 seed from two fragments. Throws if:
 *  - any AES-GCM auth tag fails to validate,
 *  - the two decoded shares carry the same Shamir index,
 *  - any decoded share has unexpected length (not 33: 1 byte index + 32 seed).
 */
export function reconstructKey(params: ReconstructKeyParams): ReconstructKeyResult {
  const [fragA, fragB] = params.fragments;
  const decodedA = decryptAesGcm(fragA.envelope, fragA.key);
  const decodedB = decryptAesGcm(fragB.envelope, fragB.key);

  let shareA: ShamirShare | undefined;
  let shareB: ShamirShare | undefined;
  let combined: Uint8Array | undefined;
  try {
    shareA = decodeShare(decodedA);
    shareB = decodeShare(decodedB);
    if (shareA.data.length !== 32) {
      throw new RangeError(
        `reconstructKey: expected 32-byte share payload, got ${shareA.data.length}`,
      );
    }
    if (shareB.data.length !== 32) {
      throw new RangeError(
        `reconstructKey: expected 32-byte share payload, got ${shareB.data.length}`,
      );
    }
    combined = shamirCombine([shareA, shareB]);
    if (combined.length !== 32) {
      throw new RangeError(
        `reconstructKey: combined seed has unexpected length ${combined.length}`,
      );
    }
    const publicKey = publicKeyFromSeed(combined);
    return { privateSeed: combined, publicKey };
  } catch (err) {
    // On any failure, ensure no partial seed material leaks out.
    if (combined) zeroize(combined);
    throw err;
  } finally {
    // Always wipe the plaintext share payloads, even on success.
    zeroize(decodedA);
    zeroize(decodedB);
    if (shareA) zeroize(shareA.data);
    if (shareB) zeroize(shareB.data);
  }
}

export interface ReconstructFromPlainParams {
  /** Plain (already-decrypted) F1 — encoded share, includes the 1-byte index. */
  readonly fragmentF1Plain: Uint8Array;
  /** Encrypted F2 envelope as returned by the backend `/fragments/2`. */
  readonly fragmentF2: EncryptedFragmentInput;
}

/**
 * Variant of `reconstructKey` for the common signing flow: F1 has already
 * been decrypted on-device (via WebAuthn PRF) while F2 still needs the
 * backend-supplied session key. Avoids a wasteful "encrypt-then-decrypt-F1"
 * round trip.
 *
 * Allow-listed in `audit-no-custody.mjs` to use `shamirCombine`.
 */
export function reconstructFromPlainAndEncrypted(
  params: ReconstructFromPlainParams,
): ReconstructKeyResult {
  const decodedF2 = decryptAesGcm(params.fragmentF2.envelope, params.fragmentF2.key);
  let shareA: ShamirShare | undefined;
  let shareB: ShamirShare | undefined;
  let combined: Uint8Array | undefined;
  try {
    shareA = decodeShare(params.fragmentF1Plain);
    shareB = decodeShare(decodedF2);
    if (shareA.data.length !== ED25519_SEED_LENGTH || shareB.data.length !== ED25519_SEED_LENGTH) {
      throw new RangeError(
        `reconstructFromPlainAndEncrypted: expected ${ED25519_SEED_LENGTH}-byte share payload`,
      );
    }
    combined = shamirCombine([shareA, shareB]);
    const publicKey = publicKeyFromSeed(combined);
    return { privateSeed: combined, publicKey };
  } catch (err) {
    if (combined) zeroize(combined);
    throw err;
  } finally {
    zeroize(decodedF2);
    if (shareA) zeroize(shareA.data);
    if (shareB) zeroize(shareB.data);
  }
}
