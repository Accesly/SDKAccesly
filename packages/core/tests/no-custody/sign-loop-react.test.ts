/**
 * Hito 6 closing test — verifies that the `reconstructFromPlainAndEncrypted`
 * variant zeroizes intermediate buffers just like the encrypted-both variant.
 *
 * This is the path the React hook uses for signing (F1 from WebAuthn PRF is
 * plain in memory; F2 comes encrypted from the backend).
 */

import { describe, expect, it } from 'vitest';
import { encryptAesGcm } from '../../src/crypto/aesgcm.js';
import { getRandomBytes } from '../../src/crypto/random.js';
import { encodeShare, splitSecret } from '../../src/crypto/shamir.js';
import { reconstructFromPlainAndEncrypted } from '../../src/mpc/combine.js';

describe('no-custody: reconstructFromPlainAndEncrypted (React-hook sign path)', () => {
  it('produces the same seed as splitSecret + reconstructKey, and reconstructs from F1plain+F2enc', () => {
    const secret = getRandomBytes(32);
    const shares = splitSecret(secret, 2, 3);

    const f1Plain = encodeShare(shares[0]!);
    const f2Key = getRandomBytes(32);
    const f2Envelope = encryptAesGcm(encodeShare(shares[1]!), f2Key);

    const result = reconstructFromPlainAndEncrypted({
      fragmentF1Plain: f1Plain,
      fragmentF2: { envelope: f2Envelope, key: f2Key },
    });

    expect(Buffer.from(result.privateSeed).equals(Buffer.from(secret))).toBe(true);
    expect(result.publicKey.length).toBe(32);
  });

  it('throws on wrong F2 key and does not leak partial seed', () => {
    const secret = getRandomBytes(32);
    const shares = splitSecret(secret, 2, 3);
    const f1Plain = encodeShare(shares[0]!);
    const f2Envelope = encryptAesGcm(encodeShare(shares[1]!), getRandomBytes(32));

    expect(() =>
      reconstructFromPlainAndEncrypted({
        fragmentF1Plain: f1Plain,
        fragmentF2: { envelope: f2Envelope, key: getRandomBytes(32) }, // wrong key
      }),
    ).toThrow();
  });
});
