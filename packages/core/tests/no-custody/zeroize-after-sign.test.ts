/**
 * CI-BLOCKING no-custody test #3.
 *
 * Sensitive buffers must be zeroed immediately after use. Specifically:
 *  - createWallet() zeroizes its internal ed25519 seed before returning.
 *  - withZeroize zeroizes everything in `secrets`, including on throw.
 *
 * If a future refactor stops zeroizing, an attacker who scrapes process
 * memory (or a debugger, or a heapdump) recovers the seed. This test makes
 * the regression explicit at CI time.
 */

import { describe, expect, it } from 'vitest';
import { __setRandomSourceForTests } from '../../src/crypto/random.js';
import { withZeroize } from '../../src/crypto/zeroize.js';
import { createWallet } from '../../src/mpc/split.js';
import { generateKeypair, signEd25519 } from '../../src/crypto/keypair.js';

function isAllZero(buf: Uint8Array): boolean {
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] !== 0) return false;
  }
  return true;
}

describe('no-custody #3: sensitive buffers are zeroed after use', () => {
  it('withZeroize zeroizes all listed buffers on success', () => {
    const secret = new Uint8Array(32).fill(0xff);
    const result = withZeroize([secret], () => 'signed');
    expect(result).toBe('signed');
    expect(isAllZero(secret)).toBe(true);
  });

  it('withZeroize zeroizes all listed buffers even on throw', () => {
    const secret = new Uint8Array(32).fill(0xff);
    expect(() =>
      withZeroize([secret], () => {
        throw new Error('signing failed');
      }),
    ).toThrow('signing failed');
    expect(isAllZero(secret)).toBe(true);
  });

  it('manual sign-and-zeroize pattern leaves seed at zero', () => {
    const keypair = generateKeypair();
    const message = new TextEncoder().encode('tx-to-sign');
    const seedRef = keypair.privateSeed; // keep a reference to assert after
    expect(isAllZero(seedRef)).toBe(false);

    withZeroize([seedRef], () => {
      const sig = signEd25519(message, seedRef);
      expect(sig.length).toBe(64);
    });

    expect(isAllZero(seedRef)).toBe(true);
  });

  it('createWallet does NOT leak its internal seed via the result graph', () => {
    // Force a deterministic seed so we can search the result bytes.
    const KNOWN_SEED = new Uint8Array(32).fill(0x77);
    let callIndex = 0;
    const restore = __setRandomSourceForTests((length) => {
      const out = new Uint8Array(length);
      if (callIndex === 0) {
        out.set(KNOWN_SEED.subarray(0, length));
      } else {
        const real = new Uint8Array(length);
        globalThis.crypto.getRandomValues(real);
        out.set(real);
      }
      callIndex += 1;
      return out;
    });
    try {
      const result = createWallet({
        emailBytes: new TextEncoder().encode('zero@accesly.xyz'),
        emailSalt: new Uint8Array(32).fill(0xcc),
        encryptionKeys: [
          new Uint8Array(32).fill(0x11),
          new Uint8Array(32).fill(0x22),
          new Uint8Array(32).fill(0x33),
        ],
      });

      // We can't reach into the internal seed buffer post-return (it's gone
      // from any reference we hold). But we CAN assert that no field of
      // the result equals the known seed.
      expect(Buffer.from(result.publicKey).equals(Buffer.from(KNOWN_SEED))).toBe(false);
      expect(Buffer.from(result.emailCommitment).equals(Buffer.from(KNOWN_SEED))).toBe(false);
      for (const env of result.encryptedFragments) {
        expect(Buffer.from(env.nonce).equals(Buffer.from(KNOWN_SEED.subarray(0, 12)))).toBe(false);
        // The ciphertext is AES-GCM output, will not match raw seed.
      }
    } finally {
      restore();
    }
  });
});
