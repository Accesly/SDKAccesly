import { describe, expect, it } from 'vitest';
import { getRandomBytes } from '../../../src/crypto/random.js';
import {
  RECONSTRUCT_THRESHOLD,
  TOTAL_FRAGMENTS,
  createWallet,
  type FragmentEncryptionKeys,
} from '../../../src/mpc/split.js';
import { reconstructKey } from '../../../src/mpc/combine.js';

function freshKeys(): FragmentEncryptionKeys {
  return [getRandomBytes(32), getRandomBytes(32), getRandomBytes(32)] as const;
}

describe('mpc/split + combine', () => {
  it('createWallet returns publicKey + commitment + 3 fragments', () => {
    const result = createWallet({
      emailBytes: new TextEncoder().encode('alice@accesly.xyz'),
      emailSalt: getRandomBytes(32),
      encryptionKeys: freshKeys(),
    });
    expect(result.publicKey.length).toBe(32);
    expect(result.emailCommitment.length).toBe(32);
    expect(result.encryptedFragments.length).toBe(TOTAL_FRAGMENTS);
    for (const env of result.encryptedFragments) {
      expect(env.nonce.length).toBe(12);
      expect(env.ciphertext.length).toBeGreaterThan(0);
    }
  });

  it('TOTAL_FRAGMENTS=3, RECONSTRUCT_THRESHOLD=2', () => {
    expect(TOTAL_FRAGMENTS).toBe(3);
    expect(RECONSTRUCT_THRESHOLD).toBe(2);
  });

  it.each([
    [0, 1],
    [0, 2],
    [1, 2],
  ])('reconstructKey from fragments [%i, %i] recovers a signing-capable seed', (i, j) => {
    const keys = freshKeys();
    const created = createWallet({
      emailBytes: new TextEncoder().encode('bob@accesly.xyz'),
      emailSalt: getRandomBytes(32),
      encryptionKeys: keys,
    });

    const reconstructed = reconstructKey({
      fragments: [
        { envelope: created.encryptedFragments[i]!, key: keys[i]! },
        { envelope: created.encryptedFragments[j]!, key: keys[j]! },
      ],
    });

    expect(reconstructed.privateSeed.length).toBe(32);
    expect(reconstructed.publicKey.length).toBe(32);
    // The reconstructed public key must match what createWallet returned.
    expect(Buffer.from(reconstructed.publicKey).equals(Buffer.from(created.publicKey))).toBe(true);
  });

  it('reconstructKey with wrong key on one fragment throws', () => {
    const keys = freshKeys();
    const created = createWallet({
      emailBytes: new TextEncoder().encode('carol@accesly.xyz'),
      emailSalt: getRandomBytes(32),
      encryptionKeys: keys,
    });
    expect(() =>
      reconstructKey({
        fragments: [
          { envelope: created.encryptedFragments[0]!, key: keys[0]! },
          { envelope: created.encryptedFragments[1]!, key: getRandomBytes(32) },
        ],
      }),
    ).toThrow();
  });

  it('createWallet validates inputs', () => {
    expect(() =>
      createWallet({
        emailBytes: new Uint8Array(0),
        emailSalt: getRandomBytes(32),
        encryptionKeys: freshKeys(),
      }),
    ).toThrow(RangeError);
    expect(() =>
      createWallet({
        emailBytes: new TextEncoder().encode('x'),
        emailSalt: new Uint8Array(0),
        encryptionKeys: freshKeys(),
      }),
    ).toThrow(RangeError);
    expect(() =>
      createWallet({
        emailBytes: new TextEncoder().encode('x'),
        emailSalt: getRandomBytes(32),
        encryptionKeys: [
          getRandomBytes(16),
          getRandomBytes(32),
          getRandomBytes(32),
        ] as unknown as FragmentEncryptionKeys,
      }),
    ).toThrow(RangeError);
  });

  it('createWallet AAD must match on reconstruct', () => {
    const keys = freshKeys();
    const aad = new TextEncoder().encode('binding-ctx');
    const created = createWallet({
      emailBytes: new TextEncoder().encode('dave@accesly.xyz'),
      emailSalt: getRandomBytes(32),
      encryptionKeys: keys,
      fragmentAad: aad,
    });

    // Reconstruct with the right AAD works (envelopes already carry it).
    const ok = reconstructKey({
      fragments: [
        { envelope: created.encryptedFragments[0]!, key: keys[0]! },
        { envelope: created.encryptedFragments[1]!, key: keys[1]! },
      ],
    });
    expect(Buffer.from(ok.publicKey).equals(Buffer.from(created.publicKey))).toBe(true);

    // Tampering AAD on one envelope fails the auth tag check.
    const tamperedEnv = {
      ...created.encryptedFragments[0]!,
      aad: new TextEncoder().encode('different-ctx'),
    };
    expect(() =>
      reconstructKey({
        fragments: [
          { envelope: tamperedEnv, key: keys[0]! },
          { envelope: created.encryptedFragments[1]!, key: keys[1]! },
        ],
      }),
    ).toThrow();
  });

  it('emailCommitment is deterministic for same (email, salt)', () => {
    const email = new TextEncoder().encode('same@accesly.xyz');
    const salt = getRandomBytes(32);
    const r1 = createWallet({ emailBytes: email, emailSalt: salt, encryptionKeys: freshKeys() });
    const r2 = createWallet({ emailBytes: email, emailSalt: salt, encryptionKeys: freshKeys() });
    expect(Buffer.from(r1.emailCommitment).equals(Buffer.from(r2.emailCommitment))).toBe(true);
    // But the keypairs differ — emailCommitment doesn't leak seed material.
    expect(Buffer.from(r1.publicKey).equals(Buffer.from(r2.publicKey))).toBe(false);
  });

  it('emailCommitment changes when salt changes', () => {
    const email = new TextEncoder().encode('same@accesly.xyz');
    const r1 = createWallet({
      emailBytes: email,
      emailSalt: getRandomBytes(32),
      encryptionKeys: freshKeys(),
    });
    const r2 = createWallet({
      emailBytes: email,
      emailSalt: getRandomBytes(32),
      encryptionKeys: freshKeys(),
    });
    expect(Buffer.from(r1.emailCommitment).equals(Buffer.from(r2.emailCommitment))).toBe(false);
  });
});
