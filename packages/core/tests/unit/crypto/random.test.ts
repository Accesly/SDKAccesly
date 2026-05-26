import { afterEach, describe, expect, it } from 'vitest';
import { __setRandomSourceForTests, getRandomBytes } from '../../../src/crypto/random.js';

describe('crypto/random', () => {
  let restore: (() => void) | undefined;

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it('produces the requested number of bytes', () => {
    expect(getRandomBytes(0).length).toBe(0);
    expect(getRandomBytes(1).length).toBe(1);
    expect(getRandomBytes(64).length).toBe(64);
    expect(getRandomBytes(1024).length).toBe(1024);
  });

  it('different calls return different bytes (probabilistic)', () => {
    const a = getRandomBytes(32);
    const b = getRandomBytes(32);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('rejects invalid lengths', () => {
    expect(() => getRandomBytes(-1)).toThrow(RangeError);
    expect(() => getRandomBytes(65_537)).toThrow(RangeError);
    expect(() => getRandomBytes(1.5)).toThrow(RangeError);
  });

  it('supports test override that is restorable', () => {
    let calls = 0;
    restore = __setRandomSourceForTests((length) => {
      calls += 1;
      return new Uint8Array(length).fill(0xab);
    });
    const out = getRandomBytes(4);
    expect(Array.from(out)).toEqual([0xab, 0xab, 0xab, 0xab]);
    expect(calls).toBe(1);
    restore();
    restore = undefined;
    // After restore, real CSPRNG is used (very unlikely to be all 0xab).
    const real = getRandomBytes(8);
    expect(real.every((b) => b === 0xab)).toBe(false);
  });
});
