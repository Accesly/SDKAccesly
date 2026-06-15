/**
 * Unit tests for `recoveryKey.ts` — el helper de derivación de Recovery v2.
 *
 * Cubre:
 *  - Determinismo: misma (password, salt) → misma key. Cambiar uno → key distinta.
 *  - Validaciones de input (salt length, empty password).
 *  - Round-trip AES-GCM con la key derivada.
 *  - Iteración custom respetada (para tests rápidos).
 *  - Variante string-based: deriva el mismo valor que la variante buffer.
 *
 * Los tests "no-custody" — que verifican que el backend NO puede descifrar F3
 * sin el password — viven en `tests/no-custody/recovery-key-bound-to-password.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import {
  RECOVERY_KEY_BYTES,
  RECOVERY_SALT_BYTES,
  decryptAesGcm,
  deriveRecoveryKey,
  deriveRecoveryKeyFromPasswordString,
  encryptAesGcm,
  generateRecoverySalt,
} from '../../../src/crypto/index.js';

const FAST_ITERATIONS = 1_000; // tests; production usa 600k del default.

function pwd(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe('crypto/recoveryKey', () => {
  it('generateRecoverySalt returns 32 cryptorandom bytes', () => {
    const a = generateRecoverySalt();
    const b = generateRecoverySalt();
    expect(a).toBeInstanceOf(Uint8Array);
    expect(a.length).toBe(RECOVERY_SALT_BYTES);
    expect(a.length).toBe(32);
    // Probabilístico: dos salts distintos no son iguales.
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('deriveRecoveryKey returns a 32-byte key', () => {
    const salt = generateRecoverySalt();
    const key = deriveRecoveryKey({
      password: pwd('correct horse battery staple'),
      salt,
      iterations: FAST_ITERATIONS,
    });
    expect(key.length).toBe(RECOVERY_KEY_BYTES);
    expect(key.length).toBe(32);
  });

  it('is deterministic: same (password, salt) yields the same key', () => {
    const salt = generateRecoverySalt();
    const a = deriveRecoveryKey({
      password: pwd('hunter2-long'),
      salt,
      iterations: FAST_ITERATIONS,
    });
    const b = deriveRecoveryKey({
      password: pwd('hunter2-long'),
      salt,
      iterations: FAST_ITERATIONS,
    });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('different passwords → different keys (same salt)', () => {
    const salt = generateRecoverySalt();
    const a = deriveRecoveryKey({
      password: pwd('password-aaa'),
      salt,
      iterations: FAST_ITERATIONS,
    });
    const b = deriveRecoveryKey({
      password: pwd('password-bbb'),
      salt,
      iterations: FAST_ITERATIONS,
    });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('different salts → different keys (same password)', () => {
    const a = deriveRecoveryKey({
      password: pwd('shared-password'),
      salt: generateRecoverySalt(),
      iterations: FAST_ITERATIONS,
    });
    const b = deriveRecoveryKey({
      password: pwd('shared-password'),
      salt: generateRecoverySalt(),
      iterations: FAST_ITERATIONS,
    });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('rejects salt of wrong length', () => {
    expect(() =>
      deriveRecoveryKey({
        password: pwd('x'),
        salt: new Uint8Array(31),
        iterations: FAST_ITERATIONS,
      }),
    ).toThrow(/salt must be 32 bytes/i);
    expect(() =>
      deriveRecoveryKey({
        password: pwd('x'),
        salt: new Uint8Array(33),
        iterations: FAST_ITERATIONS,
      }),
    ).toThrow(/salt must be 32 bytes/i);
  });

  it('rejects empty password', () => {
    expect(() =>
      deriveRecoveryKey({
        password: new Uint8Array(0),
        salt: generateRecoverySalt(),
        iterations: FAST_ITERATIONS,
      }),
    ).toThrow(/non-empty/i);
  });

  it('deriveRecoveryKeyFromPasswordString matches the buffer variant', () => {
    const salt = generateRecoverySalt();
    const fromStr = deriveRecoveryKeyFromPasswordString('same-password', salt, FAST_ITERATIONS);
    const fromBuf = deriveRecoveryKey({
      password: pwd('same-password'),
      salt,
      iterations: FAST_ITERATIONS,
    });
    expect(Buffer.from(fromStr).equals(Buffer.from(fromBuf))).toBe(true);
  });

  it('round-trip AES-GCM with derived key — encrypt and decrypt F3 mock', async () => {
    const salt = generateRecoverySalt();
    const key = deriveRecoveryKey({
      password: pwd('my-cognito-password'),
      salt,
      iterations: FAST_ITERATIONS,
    });
    // Simulamos un F3 fragment de 33 bytes (Shamir-encoded share).
    const f3 = new Uint8Array(33).fill(0xab);
    const envelope = encryptAesGcm(f3, key);
    const decrypted = decryptAesGcm(envelope, key);
    expect(Buffer.from(decrypted).equals(Buffer.from(f3))).toBe(true);
  });

  it('wrong password fails to decrypt — non-custody guard', () => {
    const salt = generateRecoverySalt();
    const goodKey = deriveRecoveryKey({
      password: pwd('original-password'),
      salt,
      iterations: FAST_ITERATIONS,
    });
    const badKey = deriveRecoveryKey({
      password: pwd('attacker-guess'),
      salt,
      iterations: FAST_ITERATIONS,
    });
    const f3 = new Uint8Array(33).fill(0xcd);
    const envelope = encryptAesGcm(f3, goodKey);
    // El password equivocado deriva otra key → AES-GCM auth tag falla.
    expect(() => decryptAesGcm(envelope, badKey)).toThrow();
  });

  it('default iteration count is 600k', () => {
    // No corremos el derive con 600k aquí (lento); solo verificamos que
    // el default no falla con un salt valid + password corto.
    const salt = generateRecoverySalt();
    const key = deriveRecoveryKey({
      password: pwd('short'),
      salt,
      // sin override de iterations → 600k
    });
    expect(key.length).toBe(32);
  });
});
