/**
 * CI-BLOCKING no-custody test #2.
 *
 * The Shamir threshold MUST be enforced: a single share, no matter who holds
 * it, cannot reconstruct the original seed. If this property breaks (e.g.
 * because someone "optimized" splitSecret with threshold=1), recovery becomes
 * single-fragment custodial — backend alone could move funds.
 *
 * Tests run with multiple random secrets to make accidental "lucky" matches
 * statistically impossible (single share is 32 random-looking bytes vs. a 32
 * byte secret; probability of coincidence is 2^-256 per attempt).
 */

import { describe, expect, it } from 'vitest';
import { getRandomBytes } from '../../src/crypto/random.js';
import { shamirCombine, splitSecret } from '../../src/crypto/shamir.js';

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

describe('no-custody #2: single Shamir share cannot reconstruct (k=2 of n=3)', () => {
  it('each individual share, run through combine, does NOT yield the secret', () => {
    for (let iter = 0; iter < 100; iter += 1) {
      const secret = getRandomBytes(32);
      const shares = splitSecret(secret, 2, 3);
      for (const share of shares) {
        const single = shamirCombine([share]);
        expect(arraysEqual(single, secret)).toBe(false);
      }
    }
  });

  it('a single share leaks NO bytes of the secret (above chance)', () => {
    // Out of 100 attempts × 32 bytes, the number of accidental matches per
    // position must remain at the expected ~100/256 ≈ 0.39 per byte. A
    // catastrophic bug (single share == secret) would push this to 100.
    const ATTEMPTS = 100;
    const matches = new Uint32Array(32);
    for (let iter = 0; iter < ATTEMPTS; iter += 1) {
      const secret = getRandomBytes(32);
      const shares = splitSecret(secret, 2, 3);
      const single = shamirCombine([shares[0]!]);
      for (let i = 0; i < 32; i += 1) {
        if (secret[i] === single[i]) matches[i] += 1;
      }
    }
    // No byte position should match more than 10 times out of 100 (well under
    // the ~50 that a constant-leak bug would produce).
    for (let i = 0; i < 32; i += 1) {
      expect(matches[i]).toBeLessThan(10);
    }
  });

  it('reconstruct-with-1 returns the share itself (defensive — confirms Lagrange behavior)', () => {
    // Sanity check that the wrong reconstruction is deterministic so we can
    // detect regressions where someone "improved" combine to silently use the
    // raw share byte (which would equal the secret with 1/256 probability per
    // byte — even worse).
    const secret = new Uint8Array(32).fill(0x42);
    const shares = splitSecret(secret, 2, 3);
    const single = shamirCombine([shares[0]!]);
    // Lagrange at x=0 with one point (x_1, y_1) returns y_1 * (1/1) = y_1.
    expect(arraysEqual(single, shares[0]!.data)).toBe(true);
    // And y_1 != secret (because secret bytes are randomized through the
    // polynomial's higher-order coefficient).
    expect(arraysEqual(single, secret)).toBe(false);
  });
});
