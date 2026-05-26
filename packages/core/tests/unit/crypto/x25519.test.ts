import { describe, expect, it } from 'vitest';
import {
  X25519_PRIVATE_KEY_LENGTH,
  X25519_PUBLIC_KEY_LENGTH,
  X25519_SHARED_SECRET_LENGTH,
  generateX25519Keypair,
  x25519Ecdh,
  x25519PublicKey,
} from '../../../src/crypto/x25519.js';

describe('crypto/x25519', () => {
  it('generates 32/32 keypairs', () => {
    const { privateKey, publicKey } = generateX25519Keypair();
    expect(privateKey.length).toBe(X25519_PRIVATE_KEY_LENGTH);
    expect(publicKey.length).toBe(X25519_PUBLIC_KEY_LENGTH);
  });

  it('x25519PublicKey is deterministic and matches generated pub', () => {
    const { privateKey, publicKey } = generateX25519Keypair();
    const derived = x25519PublicKey(privateKey);
    expect(Buffer.from(derived).equals(Buffer.from(publicKey))).toBe(true);
  });

  it('ECDH produces the same shared secret on both sides', () => {
    const alice = generateX25519Keypair();
    const bob = generateX25519Keypair();
    const aliceSees = x25519Ecdh(alice.privateKey, bob.publicKey);
    const bobSees = x25519Ecdh(bob.privateKey, alice.publicKey);
    expect(aliceSees.length).toBe(X25519_SHARED_SECRET_LENGTH);
    expect(Buffer.from(aliceSees).equals(Buffer.from(bobSees))).toBe(true);
  });

  it('different keypairs produce different shared secrets', () => {
    const alice = generateX25519Keypair();
    const bob = generateX25519Keypair();
    const carol = generateX25519Keypair();
    const ab = x25519Ecdh(alice.privateKey, bob.publicKey);
    const ac = x25519Ecdh(alice.privateKey, carol.publicKey);
    expect(Buffer.from(ab).equals(Buffer.from(ac))).toBe(false);
  });

  it('rejects malformed inputs', () => {
    expect(() => x25519PublicKey(new Uint8Array(31))).toThrow(RangeError);
    expect(() => x25519Ecdh(new Uint8Array(31), new Uint8Array(32))).toThrow(RangeError);
    expect(() => x25519Ecdh(new Uint8Array(32), new Uint8Array(31))).toThrow(RangeError);
  });
});
