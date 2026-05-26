import { describe, expect, it } from 'vitest';
import { withZeroize, withZeroizeAsync, zeroize } from '../../../src/crypto/zeroize.js';

function isAllZero(buf: Uint8Array): boolean {
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] !== 0) return false;
  }
  return true;
}

describe('crypto/zeroize', () => {
  it('zeroize fills a buffer with zeros', () => {
    const buf = new Uint8Array([1, 2, 3, 4, 5]);
    zeroize(buf);
    expect(isAllZero(buf)).toBe(true);
  });

  it('zeroize is a no-op on undefined/null', () => {
    expect(() => zeroize(undefined)).not.toThrow();
    expect(() => zeroize(null)).not.toThrow();
  });

  it('zeroize wipes views that share an ArrayBuffer', () => {
    const ab = new ArrayBuffer(8);
    const a = new Uint8Array(ab, 0, 4);
    const b = new Uint8Array(ab, 4, 4);
    a.set([1, 2, 3, 4]);
    b.set([5, 6, 7, 8]);
    zeroize(a);
    // a is zeroed by definition.
    expect(isAllZero(a)).toBe(true);
    // b is NOT zeroed by zeroize(a) — fill() only affects the bytes inside a.
    expect(isAllZero(b)).toBe(false);
  });

  describe('withZeroize', () => {
    it('returns the inner result and zeroizes all secrets', () => {
      const s1 = new Uint8Array([1, 2, 3]);
      const s2 = new Uint8Array([4, 5, 6]);
      const result = withZeroize([s1, s2], () => 42);
      expect(result).toBe(42);
      expect(isAllZero(s1)).toBe(true);
      expect(isAllZero(s2)).toBe(true);
    });

    it('zeroizes even if the inner function throws', () => {
      const s = new Uint8Array([9, 9, 9]);
      expect(() =>
        withZeroize([s], () => {
          throw new Error('boom');
        }),
      ).toThrow('boom');
      expect(isAllZero(s)).toBe(true);
    });

    it('skips undefined/null entries safely', () => {
      const s = new Uint8Array([7, 7, 7]);
      withZeroize([s, undefined, null], () => undefined);
      expect(isAllZero(s)).toBe(true);
    });
  });

  describe('withZeroizeAsync', () => {
    it('awaits the inner promise and zeroizes after resolve', async () => {
      const s = new Uint8Array([1, 2, 3]);
      const result = await withZeroizeAsync([s], async () => 'ok');
      expect(result).toBe('ok');
      expect(isAllZero(s)).toBe(true);
    });

    it('zeroizes after reject', async () => {
      const s = new Uint8Array([1, 2, 3]);
      await expect(
        withZeroizeAsync([s], async () => {
          throw new Error('async-boom');
        }),
      ).rejects.toThrow('async-boom');
      expect(isAllZero(s)).toBe(true);
    });
  });
});
