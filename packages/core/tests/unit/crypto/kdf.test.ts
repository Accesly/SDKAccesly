import { describe, expect, it } from 'vitest';
import { PBKDF2_DEFAULT_ITERATIONS, hkdfSha256, pbkdf2Sha256 } from '../../../src/crypto/kdf.js';
import { getRandomBytes } from '../../../src/crypto/random.js';

describe('crypto/kdf', () => {
  describe('hkdfSha256', () => {
    it('produces deterministic output for the same inputs', () => {
      const ikm = new Uint8Array([1, 2, 3, 4]);
      const salt = new Uint8Array([5, 6, 7, 8]);
      const info = new TextEncoder().encode('accesly-test');
      const a = hkdfSha256(ikm, salt, info, 32);
      const b = hkdfSha256(ikm, salt, info, 32);
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
      expect(a.length).toBe(32);
    });

    it('produces different output when info changes', () => {
      const ikm = new Uint8Array([1, 2, 3, 4]);
      const salt = new Uint8Array([5, 6, 7, 8]);
      const a = hkdfSha256(ikm, salt, new TextEncoder().encode('info-A'), 32);
      const b = hkdfSha256(ikm, salt, new TextEncoder().encode('info-B'), 32);
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    });

    it('supports variable output length up to 8160 bytes', () => {
      const ikm = getRandomBytes(32);
      const salt = getRandomBytes(16);
      const info = new TextEncoder().encode('long');
      expect(hkdfSha256(ikm, salt, info, 1).length).toBe(1);
      expect(hkdfSha256(ikm, salt, info, 32).length).toBe(32);
      expect(hkdfSha256(ikm, salt, info, 8160).length).toBe(8160);
    });

    it('rejects out-of-range lengths', () => {
      const ikm = new Uint8Array(8);
      const salt = new Uint8Array(8);
      const info = new Uint8Array(0);
      expect(() => hkdfSha256(ikm, salt, info, 0)).toThrow(RangeError);
      expect(() => hkdfSha256(ikm, salt, info, 8161)).toThrow(RangeError);
    });

    // RFC 5869 test vector 1
    it('matches RFC 5869 Test Case 1', () => {
      const ikm = new Uint8Array(22).fill(0x0b);
      const salt = Buffer.from('000102030405060708090a0b0c', 'hex');
      const info = Buffer.from('f0f1f2f3f4f5f6f7f8f9', 'hex');
      const expected = Buffer.from(
        '3cb25f25faacd57a90434f64d0362f2a' +
          '2d2d0a90cf1a5a4c5db02d56ecc4c5bf' +
          '34007208d5b887185865',
        'hex',
      );
      const okm = hkdfSha256(ikm, new Uint8Array(salt), new Uint8Array(info), 42);
      expect(Buffer.from(okm).equals(expected)).toBe(true);
    });
  });

  describe('pbkdf2Sha256', () => {
    it('default iterations is OWASP 2023 recommendation', () => {
      expect(PBKDF2_DEFAULT_ITERATIONS).toBe(600_000);
    });

    it('produces deterministic output (low iterations for test speed)', () => {
      const password = new TextEncoder().encode('hunter2');
      const salt = new TextEncoder().encode('accesly-salt');
      const a = pbkdf2Sha256(password, salt, { iterations: 1000, length: 32 });
      const b = pbkdf2Sha256(password, salt, { iterations: 1000, length: 32 });
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
      expect(a.length).toBe(32);
    });

    it('different password yields different key', () => {
      const salt = new TextEncoder().encode('s');
      const a = pbkdf2Sha256(new TextEncoder().encode('a'), salt, { iterations: 1000 });
      const b = pbkdf2Sha256(new TextEncoder().encode('b'), salt, { iterations: 1000 });
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    });

    it('different salt yields different key', () => {
      const pwd = new TextEncoder().encode('same');
      const a = pbkdf2Sha256(pwd, new TextEncoder().encode('s1'), { iterations: 1000 });
      const b = pbkdf2Sha256(pwd, new TextEncoder().encode('s2'), { iterations: 1000 });
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    });

    it('rejects invalid iterations', () => {
      const pwd = new Uint8Array(4);
      const salt = new Uint8Array(4);
      expect(() => pbkdf2Sha256(pwd, salt, { iterations: 0 })).toThrow(RangeError);
      expect(() => pbkdf2Sha256(pwd, salt, { iterations: 1.5 })).toThrow(RangeError);
    });

    it('rejects out-of-range length', () => {
      const pwd = new Uint8Array(4);
      const salt = new Uint8Array(4);
      expect(() => pbkdf2Sha256(pwd, salt, { iterations: 1000, length: 0 })).toThrow(RangeError);
      expect(() => pbkdf2Sha256(pwd, salt, { iterations: 1000, length: 1025 })).toThrow(RangeError);
    });

    // Canonical PBKDF2-HMAC-SHA-256 reference vector. Reproducible with Python:
    //   hashlib.pbkdf2_hmac('sha256', b'password', b'salt', 1, 32).hex()
    //   => '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b'
    it('matches the canonical PBKDF2-HMAC-SHA-256 vector', () => {
      const password = new TextEncoder().encode('password');
      const salt = new TextEncoder().encode('salt');
      const expected = Buffer.from(
        '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b',
        'hex',
      );
      const out = pbkdf2Sha256(password, salt, { iterations: 1, length: 32 });
      expect(Buffer.from(out).equals(expected)).toBe(true);
    });
  });
});
