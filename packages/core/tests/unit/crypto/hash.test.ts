import { describe, expect, it } from 'vitest';
import { sha256, sha256Hex } from '../../../src/crypto/hash.js';

describe('crypto/hash', () => {
  it('sha256("") matches the canonical empty-string digest', () => {
    const digest = sha256(new Uint8Array(0));
    expect(sha256Hex(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(digest.length).toBe(32);
  });

  it('sha256("abc") matches the canonical digest', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('sha256Hex accepts Uint8Array input', () => {
    const bytes = new TextEncoder().encode('abc');
    expect(sha256Hex(bytes)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('sha256 is deterministic', () => {
    const a = sha256(new TextEncoder().encode('accesly'));
    const b = sha256(new TextEncoder().encode('accesly'));
    expect(a).toEqual(b);
  });
});
