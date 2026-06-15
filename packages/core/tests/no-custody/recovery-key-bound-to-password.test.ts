/**
 * CI-BLOCKING no-custody test #8 (Recovery v2).
 *
 * Premisa central de Recovery v2: **el backend no puede descifrar F3**.
 *
 * El backend almacena `{F3_enc, recoverySalt}`. La clave que descifra `F3_enc`
 * es `recoveryKey = PBKDF2(cognito_password, recoverySalt, 600k)`. Cognito
 * usa SRP — guarda un verifier, no el password en plano. Por lo tanto el
 * backend, en operación normal, no tiene `cognito_password` y no puede
 * derivar `recoveryKey`.
 *
 * Este test verifica que la propiedad criptográfica se mantiene:
 *  1. Con `{F3_enc, recoverySalt}` solos, NO se puede descifrar F3.
 *  2. Solo con `password + recoverySalt` correctos se descifra.
 *  3. Cambios en ANY de los tres (password, salt, ciphertext) rompen
 *     el descifrado.
 *
 * Si este test falla, el modelo Recovery v2 está roto y la no-custodia
 * se pierde. NO MERGEAR.
 *
 * Ver SDKAccesly/docs/Plan_Final_v1.md §5 (Fase 1).
 */

import { describe, expect, it } from 'vitest';
import {
  decryptAesGcm,
  deriveRecoveryKey,
  encryptAesGcm,
  generateRecoverySalt,
  getRandomBytes,
} from '../../src/crypto/index.js';

const FAST = 1_000; // PBKDF2 iter para tests; producción usa 600k.

function pwd(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe('no-custody #8: recoveryKey is password-bound', () => {
  it('backend with only {F3_enc, recoverySalt} CANNOT decrypt F3', () => {
    const password = pwd('cognito-real-password');
    const salt = generateRecoverySalt();
    const recoveryKey = deriveRecoveryKey({ password, salt, iterations: FAST });
    const f3Plain = getRandomBytes(33);
    const f3Enc = encryptAesGcm(f3Plain, recoveryKey);

    // El backend tiene SOLO: f3Enc + salt. No tiene recoveryKey ni password.
    // Cualquier intento de descifrar sin el password fallará por AES-GCM auth.
    const attackerGuesses = ['', '123456', 'password', 'admin', 'qwerty'];
    for (const guess of attackerGuesses) {
      const guessedKey = deriveRecoveryKey({
        password: pwd(guess || '\0'),
        salt,
        iterations: FAST,
      });
      expect(() => decryptAesGcm(f3Enc, guessedKey)).toThrow();
    }
  });

  it('only the correct password + salt yields F3 plain', () => {
    const password = pwd('correct-password');
    const salt = generateRecoverySalt();
    const key = deriveRecoveryKey({ password, salt, iterations: FAST });
    const f3 = getRandomBytes(33);
    const env = encryptAesGcm(f3, key);

    const decrypted = decryptAesGcm(env, key);
    expect(decrypted.length).toBe(f3.length);
    for (let i = 0; i < f3.length; i += 1) {
      expect(decrypted[i]).toBe(f3[i]);
    }
  });

  it('changing the salt (man-in-the-middle) breaks decryption', () => {
    const password = pwd('original-password');
    const salt = generateRecoverySalt();
    const evilSalt = generateRecoverySalt();

    const key = deriveRecoveryKey({ password, salt, iterations: FAST });
    const env = encryptAesGcm(getRandomBytes(33), key);

    // Backend hostil podría devolver un salt distinto para forzar al SDK a
    // derivar la key incorrecta. AES-GCM auth tag detecta y rechaza.
    const evilKey = deriveRecoveryKey({
      password,
      salt: evilSalt,
      iterations: FAST,
    });
    expect(() => decryptAesGcm(env, evilKey)).toThrow();
  });

  it('tampered ciphertext fails authentication (no silent corruption)', () => {
    const password = pwd('p');
    const salt = generateRecoverySalt();
    const key = deriveRecoveryKey({ password, salt, iterations: FAST });
    const env = encryptAesGcm(getRandomBytes(33), key);

    // Atacante flip 1 bit del ciphertext. AES-GCM auth tag debe rechazar.
    const tampered = {
      ...env,
      ciphertext: new Uint8Array(env.ciphertext),
    };
    tampered.ciphertext[0] ^= 0x01;
    expect(() => decryptAesGcm(tampered, key)).toThrow();
  });

  it('1000 random password guesses fail to decrypt — brute-force resistance check', () => {
    const realPassword = pwd('the-real-password-2024');
    const salt = generateRecoverySalt();
    const key = deriveRecoveryKey({ password: realPassword, salt, iterations: FAST });
    const env = encryptAesGcm(getRandomBytes(33), key);

    let succeeded = 0;
    for (let i = 0; i < 1000; i += 1) {
      const guess = pwd(`guess-${i}-${Math.random()}`);
      const guessedKey = deriveRecoveryKey({ password: guess, salt, iterations: FAST });
      try {
        decryptAesGcm(env, guessedKey);
        succeeded += 1;
      } catch {
        // expected
      }
    }
    expect(succeeded).toBe(0);
  });
});
