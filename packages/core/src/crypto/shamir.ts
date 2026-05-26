/**
 * Shamir Secret Sharing over GF(256), byte-wise.
 *
 * Each byte of the secret is split independently using a random polynomial of
 * degree `threshold - 1` over the Galois field GF(2^8) with reducing polynomial
 * 0x11b (the AES field). Reconstruction is Lagrange interpolation evaluated at
 * x = 0 using any `threshold` shares.
 *
 * References:
 *  - Adi Shamir, "How to Share a Secret" (1979)
 *  - SLIP-0039 (https://github.com/satoshilabs/slips/blob/master/slip-0039.md)
 *    — uses GF(256) the same way.
 *
 * This file is allow-listed in `audit-no-custody.mjs`: the function names
 * `splitSecret`, `shamirCombine`, and `shamirCombine` are reserved to this
 * module + `packages/core/src/mpc/{split,combine}.ts`.
 */

import { getRandomBytes } from './random.js';

/* ------------------------------------------------------------------------ */
/*  GF(256) arithmetic                                                       */
/* ------------------------------------------------------------------------ */

/**
 * EXP[i] = 0x03^i over GF(256), with i in [0, 510].
 * The duplicated upper half lets `gfMul` add log values without a modulo.
 */
const EXP = new Uint8Array(512);

/**
 * LOG[x] = log_{0x03}(x) over GF(256), with x in [1, 255].
 * LOG[0] is undefined (logarithm of zero); callers must guard explicitly.
 */
const LOG = new Uint8Array(256);

(function buildTables(): void {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    // Multiply x by the generator 0x03 = (x + 1).
    let next = x ^ ((x << 1) & 0xff);
    if (x & 0x80) next ^= 0x1b; // reduce modulo 0x11b
    x = next;
  }
  for (let i = 255; i < 510; i += 1) {
    EXP[i] = EXP[i - 255] ?? 0;
  }
})();

/** Multiplication in GF(256). */
function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  // a, b in [1, 255] => LOG[a], LOG[b] in [0, 254] => sum in [0, 508] within EXP table size.
  return EXP[LOG[a]! + LOG[b]!]!;
}

/** Division in GF(256). Returns 0 when numerator is 0; throws on zero denominator. */
function gfDiv(numerator: number, denominator: number): number {
  if (denominator === 0) {
    throw new Error('shamir: division by zero in GF(256)');
  }
  if (numerator === 0) return 0;
  // LOG[num] - LOG[den] could be negative; +255 keeps the index non-negative.
  return EXP[LOG[numerator]! + 255 - LOG[denominator]!]!;
}

/** Evaluate polynomial `coeffs` at `x` using Horner's method, over GF(256). */
function evaluatePolynomial(coeffs: Uint8Array, x: number): number {
  let result = coeffs[coeffs.length - 1]!;
  for (let i = coeffs.length - 2; i >= 0; i -= 1) {
    result = gfMul(result, x) ^ coeffs[i]!;
  }
  return result;
}

/* ------------------------------------------------------------------------ */
/*  Public API                                                               */
/* ------------------------------------------------------------------------ */

/**
 * A single Shamir share.
 *
 * `index` is the x-coordinate (1..255). `data[i]` is the y-coordinate of the
 * i-th byte's polynomial evaluated at `index`. Two shares are equal iff their
 * (index, data) pairs are equal.
 */
export interface ShamirShare {
  readonly index: number;
  readonly data: Uint8Array;
}

export const SHAMIR_MAX_SHARES = 255;

/**
 * Splits `secret` into `totalShares` shares of which any `threshold` suffice
 * to reconstruct.
 *
 * `threshold` must be in [2, 255]. `totalShares` must be in [threshold, 255].
 * `secret` may be of any length >= 1.
 *
 * Memory: the random coefficients are zeroed after each byte. The returned
 * shares are heap-allocated; the caller is responsible for clearing them once
 * they are no longer needed (e.g. once encrypted to envelopes).
 */
export function splitSecret(
  secret: Uint8Array,
  threshold: number,
  totalShares: number,
): ShamirShare[] {
  if (secret.length === 0) {
    throw new RangeError('splitSecret: secret must be non-empty');
  }
  if (!Number.isInteger(threshold) || threshold < 2 || threshold > SHAMIR_MAX_SHARES) {
    throw new RangeError(`splitSecret: threshold must be in [2, 255], got ${threshold}`);
  }
  if (
    !Number.isInteger(totalShares) ||
    totalShares < threshold ||
    totalShares > SHAMIR_MAX_SHARES
  ) {
    throw new RangeError(
      `splitSecret: totalShares must be in [${threshold}, 255], got ${totalShares}`,
    );
  }

  // Pre-allocate one Uint8Array per share for the y-coordinates.
  const shares: ShamirShare[] = [];
  for (let i = 0; i < totalShares; i += 1) {
    shares.push({ index: i + 1, data: new Uint8Array(secret.length) });
  }

  // For each byte of the secret, generate a random polynomial of degree
  // `threshold - 1` whose constant term is the secret byte, and evaluate it
  // at x = 1..totalShares.
  const coeffs = new Uint8Array(threshold);
  for (let byteIdx = 0; byteIdx < secret.length; byteIdx += 1) {
    coeffs[0] = secret[byteIdx]!;
    const rand = getRandomBytes(threshold - 1);
    coeffs.set(rand, 1);
    for (let s = 0; s < totalShares; s += 1) {
      shares[s]!.data[byteIdx] = evaluatePolynomial(coeffs, shares[s]!.index);
    }
    coeffs.fill(0); // zeroize between bytes
    rand.fill(0);
  }

  return shares;
}

/**
 * Reconstructs the original secret from `shares`. Returns whatever number of
 * bytes was the original secret length.
 *
 * Caller MUST provide exactly `threshold` shares of the original split. Fewer
 * yields a wrong but indistinguishable value (a defining property of Shamir);
 * more is redundant. Duplicate or zero-indexed shares throw.
 */
export function shamirCombine(shares: readonly ShamirShare[]): Uint8Array {
  if (shares.length === 0) {
    throw new RangeError('shamirCombine: at least 1 share required');
  }
  const length = shares[0]!.data.length;
  const seenIndexes = new Set<number>();
  for (const share of shares) {
    if (share.index < 1 || share.index > SHAMIR_MAX_SHARES) {
      throw new RangeError(`shamirCombine: share index out of range: ${share.index}`);
    }
    if (share.data.length !== length) {
      throw new RangeError(
        `shamirCombine: all shares must have the same length (${length}), got ${share.data.length}`,
      );
    }
    if (seenIndexes.has(share.index)) {
      throw new Error(`shamirCombine: duplicate share index ${share.index}`);
    }
    seenIndexes.add(share.index);
  }

  // Precompute the Lagrange basis at x = 0 for each share.
  // L_i(0) = prod_{j != i} (x_j) / (x_j XOR x_i)   [subtraction == XOR in char 2]
  const lagrange = new Uint8Array(shares.length);
  for (let i = 0; i < shares.length; i += 1) {
    let numerator = 1;
    let denominator = 1;
    for (let j = 0; j < shares.length; j += 1) {
      if (i === j) continue;
      numerator = gfMul(numerator, shares[j]!.index);
      denominator = gfMul(denominator, shares[j]!.index ^ shares[i]!.index);
    }
    lagrange[i] = gfDiv(numerator, denominator);
  }

  const result = new Uint8Array(length);
  for (let byteIdx = 0; byteIdx < length; byteIdx += 1) {
    let acc = 0;
    for (let i = 0; i < shares.length; i += 1) {
      acc ^= gfMul(shares[i]!.data[byteIdx]!, lagrange[i]!);
    }
    result[byteIdx] = acc;
  }
  return result;
}

/* ------------------------------------------------------------------------ */
/*  Wire encoding for a single share                                         */
/* ------------------------------------------------------------------------ */

/**
 * Encodes a share as a flat Uint8Array `[index, ...data]`. Useful for storing
 * or transmitting a single fragment as one binary blob.
 */
export function encodeShare(share: ShamirShare): Uint8Array {
  if (share.index < 1 || share.index > SHAMIR_MAX_SHARES) {
    throw new RangeError(`encodeShare: index out of range: ${share.index}`);
  }
  const out = new Uint8Array(share.data.length + 1);
  out[0] = share.index;
  out.set(share.data, 1);
  return out;
}

/**
 * Decodes a flat share blob produced by `encodeShare`.
 */
export function decodeShare(encoded: Uint8Array): ShamirShare {
  if (encoded.length < 2) {
    throw new RangeError(`decodeShare: encoded share too short (${encoded.length} bytes)`);
  }
  const index = encoded[0]!;
  if (index < 1 || index > SHAMIR_MAX_SHARES) {
    throw new RangeError(`decodeShare: index out of range: ${index}`);
  }
  return { index, data: encoded.slice(1) };
}
