/**
 * Stellar transaction signing.
 *
 * ALLOW-LISTED in `audit-no-custody.mjs` to call `Keypair.fromRawEd25519Seed`.
 *
 * The signer takes a fully-reconstructed ed25519 seed as input and:
 *   1. Wraps the operation in `withZeroizeAsync` so the seed buffer is
 *      cleared even on throw.
 *   2. Defensively asserts the seed length is 32 bytes.
 *   3. Optionally verifies the derived public key matches an expected one
 *      (anti-foot-gun against the caller passing the wrong seed).
 *   4. Parses the XDR, signs, returns the signed XDR.
 *
 * `@stellar/stellar-sdk` is lazy-imported to keep it out of bundles that
 * never sign.
 */

import { publicKeyFromSeed, ED25519_SEED_LENGTH } from '../crypto/keypair.js';
import { withZeroizeAsync } from '../crypto/zeroize.js';
import { loadStellarSdk } from './loadSdk.js';

export interface SignTransactionParams {
  /** Base64-encoded transaction envelope XDR returned by the builder. */
  readonly transactionXdr: string;
  /**
   * Raw 32-byte ed25519 seed reconstructed via Shamir. WILL BE ZEROED by
   * this function, even on throw. The caller MUST NOT reuse the buffer.
   */
  readonly ed25519Seed: Uint8Array;
  readonly networkPassphrase: string;
  /**
   * Optional sanity check: assert that the public key derived from the seed
   * equals this expected value. Catches "wrong seed reconstruction" bugs
   * (e.g. mixed-up fragments) before submitting a tx that would be rejected
   * on-chain anyway.
   */
  readonly expectedPublicKey?: Uint8Array;
}

export interface SignTransactionResult {
  /** Base64-encoded signed envelope XDR ready to submit. */
  readonly signedXdr: string;
  /** Public key that produced the signature, for caller verification. */
  readonly publicKey: Uint8Array;
}

/**
 * Signs `transactionXdr` with `ed25519Seed`. The seed is zeroed on return.
 */
export async function signTransaction(
  params: SignTransactionParams,
): Promise<SignTransactionResult> {
  if (params.ed25519Seed.length !== ED25519_SEED_LENGTH) {
    throw new RangeError(
      `signTransaction: ed25519Seed must be ${ED25519_SEED_LENGTH} bytes, got ${params.ed25519Seed.length}`,
    );
  }

  const publicKey = publicKeyFromSeed(params.ed25519Seed);
  if (params.expectedPublicKey) {
    if (params.expectedPublicKey.length !== publicKey.length) {
      throw new RangeError(
        `signTransaction: expectedPublicKey must be ${publicKey.length} bytes, got ${params.expectedPublicKey.length}`,
      );
    }
    if (!bytesEqual(publicKey, params.expectedPublicKey)) {
      throw new Error('signTransaction: derived public key does not match expectedPublicKey');
    }
  }

  return withZeroizeAsync([params.ed25519Seed], async () => {
    const sdk = await loadStellarSdk();
    const { Keypair, TransactionBuilder } = sdk;

    // `Buffer.from(uint8array)` shares the underlying ArrayBuffer in Node and
    // copies in browser. We pass through a fresh copy so the sdk-internal
    // retention doesn't pin our seed past the zeroize point.
    const seedCopy = new Uint8Array(params.ed25519Seed);
    try {
      // ALLOW-LISTED: Keypair.fromRawEd25519Seed is the only path that takes
      // a raw seed without an intermediate base32 encoding (which would land
      // the secret in a heap string).
      const keypair = Keypair.fromRawEd25519Seed(Buffer.from(seedCopy));

      const tx = TransactionBuilder.fromXDR(params.transactionXdr, params.networkPassphrase);
      tx.sign(keypair);

      return {
        signedXdr: tx.toEnvelope().toXDR('base64'),
        publicKey,
      } satisfies SignTransactionResult;
    } finally {
      seedCopy.fill(0);
    }
  });
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
