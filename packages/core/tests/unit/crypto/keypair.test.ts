import { describe, expect, it } from 'vitest';
import {
  ED25519_PUBLIC_KEY_LENGTH,
  ED25519_SEED_LENGTH,
  ED25519_SIGNATURE_LENGTH,
  generateKeypair,
  publicKeyFromSeed,
  signEd25519,
  verifyEd25519,
} from '../../../src/crypto/keypair.js';

describe('crypto/keypair', () => {
  it('generates 32/32 keypairs', () => {
    const { privateSeed, publicKey } = generateKeypair();
    expect(privateSeed).toBeInstanceOf(Uint8Array);
    expect(privateSeed.length).toBe(ED25519_SEED_LENGTH);
    expect(publicKey).toBeInstanceOf(Uint8Array);
    expect(publicKey.length).toBe(ED25519_PUBLIC_KEY_LENGTH);
  });

  it('produces distinct keypairs across calls', () => {
    const a = generateKeypair();
    const b = generateKeypair();
    expect(Buffer.from(a.privateSeed).equals(Buffer.from(b.privateSeed))).toBe(false);
    expect(Buffer.from(a.publicKey).equals(Buffer.from(b.publicKey))).toBe(false);
  });

  it('publicKeyFromSeed is deterministic and matches generateKeypair', () => {
    const { privateSeed, publicKey } = generateKeypair();
    const derived = publicKeyFromSeed(privateSeed);
    expect(Buffer.from(derived).equals(Buffer.from(publicKey))).toBe(true);
  });

  it('publicKeyFromSeed rejects wrong seed length', () => {
    expect(() => publicKeyFromSeed(new Uint8Array(31))).toThrow(RangeError);
    expect(() => publicKeyFromSeed(new Uint8Array(33))).toThrow(RangeError);
  });

  it('signs and verifies', () => {
    const { privateSeed, publicKey } = generateKeypair();
    const message = new TextEncoder().encode('accesly-test-message');
    const signature = signEd25519(message, privateSeed);
    expect(signature.length).toBe(ED25519_SIGNATURE_LENGTH);
    expect(verifyEd25519(signature, message, publicKey)).toBe(true);
  });

  it('verifyEd25519 returns false on wrong message', () => {
    const { privateSeed, publicKey } = generateKeypair();
    const message = new TextEncoder().encode('original');
    const tampered = new TextEncoder().encode('tampered');
    const signature = signEd25519(message, privateSeed);
    expect(verifyEd25519(signature, tampered, publicKey)).toBe(false);
  });

  it('verifyEd25519 returns false on wrong public key', () => {
    const a = generateKeypair();
    const b = generateKeypair();
    const message = new TextEncoder().encode('hello');
    const signature = signEd25519(message, a.privateSeed);
    expect(verifyEd25519(signature, message, b.publicKey)).toBe(false);
  });

  it('verifyEd25519 returns false (never throws) on malformed inputs', () => {
    const { publicKey } = generateKeypair();
    expect(verifyEd25519(new Uint8Array(63), new Uint8Array(0), publicKey)).toBe(false);
    expect(verifyEd25519(new Uint8Array(64), new Uint8Array(0), new Uint8Array(31))).toBe(false);
  });

  it('signEd25519 rejects wrong seed length', () => {
    expect(() => signEd25519(new Uint8Array(10), new Uint8Array(31))).toThrow(RangeError);
  });
});
