import { describe, expect, it } from 'vitest';
import {
  AES_GCM_NONCE_LENGTH,
  AES_GCM_TAG_LENGTH,
  AES_KEY_LENGTH,
  decryptAesGcm,
  encryptAesGcm,
} from '../../../src/crypto/aesgcm.js';
import { getRandomBytes } from '../../../src/crypto/random.js';

describe('crypto/aesgcm', () => {
  it('encrypts and decrypts round-trip without AAD', () => {
    const key = getRandomBytes(AES_KEY_LENGTH);
    const plaintext = new TextEncoder().encode('hello accesly');
    const envelope = encryptAesGcm(plaintext, key);
    expect(envelope.nonce.length).toBe(AES_GCM_NONCE_LENGTH);
    expect(envelope.ciphertext.length).toBe(plaintext.length + AES_GCM_TAG_LENGTH);
    const decrypted = decryptAesGcm(envelope, key);
    expect(new TextDecoder().decode(decrypted)).toBe('hello accesly');
  });

  it('encrypts and decrypts round-trip with AAD', () => {
    const key = getRandomBytes(AES_KEY_LENGTH);
    const plaintext = new TextEncoder().encode('with-aad');
    const aad = new TextEncoder().encode('context-binding');
    const envelope = encryptAesGcm(plaintext, key, aad);
    expect(envelope.aad).toBe(aad);
    const decrypted = decryptAesGcm(envelope, key);
    expect(new TextDecoder().decode(decrypted)).toBe('with-aad');
  });

  it('uses a fresh nonce per encryption (probabilistic)', () => {
    const key = getRandomBytes(AES_KEY_LENGTH);
    const plaintext = new TextEncoder().encode('same-input');
    const a = encryptAesGcm(plaintext, key);
    const b = encryptAesGcm(plaintext, key);
    expect(Buffer.from(a.nonce).equals(Buffer.from(b.nonce))).toBe(false);
    expect(Buffer.from(a.ciphertext).equals(Buffer.from(b.ciphertext))).toBe(false);
  });

  it('decrypt fails on tampered ciphertext', () => {
    const key = getRandomBytes(AES_KEY_LENGTH);
    const envelope = encryptAesGcm(new TextEncoder().encode('original'), key);
    envelope.ciphertext[0] ^= 0x01;
    expect(() => decryptAesGcm(envelope, key)).toThrow();
  });

  it('decrypt fails on wrong AAD', () => {
    const key = getRandomBytes(AES_KEY_LENGTH);
    const aad = new TextEncoder().encode('aad-1');
    const wrongAad = new TextEncoder().encode('aad-2');
    const envelope = encryptAesGcm(new TextEncoder().encode('x'), key, aad);
    const bogus = { ...envelope, aad: wrongAad };
    expect(() => decryptAesGcm(bogus, key)).toThrow();
  });

  it('decrypt fails on wrong key', () => {
    const keyA = getRandomBytes(AES_KEY_LENGTH);
    const keyB = getRandomBytes(AES_KEY_LENGTH);
    const envelope = encryptAesGcm(new TextEncoder().encode('secret'), keyA);
    expect(() => decryptAesGcm(envelope, keyB)).toThrow();
  });

  it('rejects wrong key length on encrypt', () => {
    expect(() => encryptAesGcm(new Uint8Array(10), new Uint8Array(16))).toThrow(RangeError);
  });

  it('rejects wrong key length on decrypt', () => {
    const envelope = encryptAesGcm(new Uint8Array(10), getRandomBytes(AES_KEY_LENGTH));
    expect(() => decryptAesGcm(envelope, new Uint8Array(16))).toThrow(RangeError);
  });

  it('rejects malformed envelopes', () => {
    const key = getRandomBytes(AES_KEY_LENGTH);
    expect(() =>
      decryptAesGcm({ nonce: new Uint8Array(8), ciphertext: new Uint8Array(32) }, key),
    ).toThrow(RangeError);
    expect(() =>
      decryptAesGcm(
        { nonce: new Uint8Array(AES_GCM_NONCE_LENGTH), ciphertext: new Uint8Array(8) },
        key,
      ),
    ).toThrow(RangeError);
  });
});
