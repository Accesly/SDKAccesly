import { describe, expect, it } from 'vitest';
import {
  SHAMIR_MAX_SHARES,
  decodeShare,
  encodeShare,
  shamirCombine,
  splitSecret,
} from '../../../src/crypto/shamir.js';
import { getRandomBytes } from '../../../src/crypto/random.js';

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

describe('crypto/shamir', () => {
  describe('parameter validation', () => {
    it('rejects empty secret', () => {
      expect(() => splitSecret(new Uint8Array(0), 2, 3)).toThrow(RangeError);
    });

    it('rejects threshold < 2', () => {
      expect(() => splitSecret(new Uint8Array(32), 1, 3)).toThrow(RangeError);
    });

    it('rejects threshold > 255', () => {
      expect(() => splitSecret(new Uint8Array(32), 256, 256)).toThrow(RangeError);
    });

    it('rejects totalShares < threshold', () => {
      expect(() => splitSecret(new Uint8Array(32), 3, 2)).toThrow(RangeError);
    });

    it('rejects totalShares > 255', () => {
      expect(() => splitSecret(new Uint8Array(32), 2, 256)).toThrow(RangeError);
    });
  });

  describe('round-trip 2-of-3 on 32-byte secrets (1000 iterations)', () => {
    it('any 2 of 3 shares reconstruct the original', () => {
      for (let iter = 0; iter < 1000; iter += 1) {
        const secret = getRandomBytes(32);
        const shares = splitSecret(secret, 2, 3);
        expect(shares.length).toBe(3);

        // Try every 2-share combination.
        const combos: Array<[number, number]> = [
          [0, 1],
          [0, 2],
          [1, 2],
        ];
        for (const [i, j] of combos) {
          const reconstructed = shamirCombine([shares[i]!, shares[j]!]);
          expect(arraysEqual(reconstructed, secret)).toBe(true);
        }
      }
    });
  });

  describe('round-trip with k-of-n variations', () => {
    it.each([
      [2, 5],
      [3, 5],
      [4, 7],
      [5, 8],
    ])('threshold=%i, total=%i', (threshold, total) => {
      const secret = getRandomBytes(32);
      const shares = splitSecret(secret, threshold, total);
      expect(shares.length).toBe(total);

      // First `threshold` shares reconstruct.
      const subset = shares.slice(0, threshold);
      expect(arraysEqual(shamirCombine(subset), secret)).toBe(true);

      // All shares also reconstruct.
      expect(arraysEqual(shamirCombine(shares), secret)).toBe(true);
    });
  });

  describe('insufficient shares', () => {
    it('with 1-of-2-of-3, a single share does NOT reveal the secret', () => {
      const secret = getRandomBytes(32);
      const shares = splitSecret(secret, 2, 3);
      // Lagrange on 1 point produces the share's y values (NOT the secret).
      // We assert inequality with very high probability.
      const result = shamirCombine([shares[0]!]);
      expect(arraysEqual(result, secret)).toBe(false);
    });
  });

  describe('share encoding', () => {
    it('round-trips through encode/decode', () => {
      const share = { index: 42, data: getRandomBytes(32) };
      const encoded = encodeShare(share);
      expect(encoded.length).toBe(33);
      expect(encoded[0]).toBe(42);
      const decoded = decodeShare(encoded);
      expect(decoded.index).toBe(42);
      expect(arraysEqual(decoded.data, share.data)).toBe(true);
    });

    it('rejects out-of-range index on encode', () => {
      expect(() => encodeShare({ index: 0, data: new Uint8Array(32) })).toThrow(RangeError);
      expect(() => encodeShare({ index: 256, data: new Uint8Array(32) })).toThrow(RangeError);
    });

    it('rejects short blob on decode', () => {
      expect(() => decodeShare(new Uint8Array(0))).toThrow(RangeError);
      expect(() => decodeShare(new Uint8Array(1))).toThrow(RangeError);
    });
  });

  describe('combine input validation', () => {
    it('rejects empty share list', () => {
      expect(() => shamirCombine([])).toThrow(RangeError);
    });

    it('rejects duplicate share indexes', () => {
      const shares = splitSecret(new Uint8Array(8), 2, 3);
      expect(() => shamirCombine([shares[0]!, shares[0]!])).toThrow();
    });

    it('rejects shares of mismatched length', () => {
      const a = { index: 1, data: new Uint8Array(8) };
      const b = { index: 2, data: new Uint8Array(16) };
      expect(() => shamirCombine([a, b])).toThrow(RangeError);
    });

    it('rejects out-of-range indexes', () => {
      const a = { index: 0, data: new Uint8Array(8) };
      const b = { index: 2, data: new Uint8Array(8) };
      expect(() => shamirCombine([a, b])).toThrow(RangeError);
    });
  });

  describe('boundary', () => {
    it('SHAMIR_MAX_SHARES is 255', () => {
      expect(SHAMIR_MAX_SHARES).toBe(255);
    });

    it('handles 1-byte secret', () => {
      const secret = new Uint8Array([0x42]);
      const shares = splitSecret(secret, 2, 3);
      expect(arraysEqual(shamirCombine([shares[0]!, shares[2]!]), secret)).toBe(true);
    });

    it('handles 1024-byte secret', () => {
      const secret = getRandomBytes(1024);
      const shares = splitSecret(secret, 2, 3);
      expect(arraysEqual(shamirCombine([shares[1]!, shares[2]!]), secret)).toBe(true);
    });
  });
});
