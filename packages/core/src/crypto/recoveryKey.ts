/**
 * Recovery key derivation para Recovery v2 (2026-06-15).
 *
 * El flujo:
 *  1. Al `createWallet`, el SDK genera un `recoverySalt` aleatorio (32 bytes).
 *  2. Deriva `recoveryKey = PBKDF2-SHA256(password, recoverySalt, 600k iter)`
 *     usando el password de Cognito que el usuario acaba de ingresar.
 *  3. Cifra `F3` con `recoveryKey` (AES-GCM) y envía `{F3_enc, recoverySalt}`
 *     al backend.
 *  4. Al recuperar (otra device): user mete email → OTP → password.
 *     - Backend libera `F3_enc + recoverySalt`.
 *     - SDK deriva `recoveryKey` con el mismo password + salt.
 *     - SDK descifra `F3` → reconstruye seed con F2+F3 → registra new passkey
 *       → firma `rotate_signer` con la seed reconstruida.
 *
 * **Garantía no-custodial:** el backend nunca tiene el password de Cognito
 * en plano (Cognito guarda un SRP verifier, no el password). Por lo tanto
 * el backend no puede derivar `recoveryKey` y no puede descifrar `F3`.
 *
 * Ver SDKAccesly/docs/Plan_Final_v1.md §5 (Fase 1).
 */

import { sha256 } from '@noble/hashes/sha2';
import { pbkdf2Sha256, PBKDF2_DEFAULT_ITERATIONS } from './kdf.js';
import { getRandomBytes } from './random.js';
import { zeroize } from './zeroize.js';

/**
 * Calcula `sha256(email.toLowerCase().trim())` y devuelve 32 bytes.
 *
 * El backend lo usa como índice en el GSI `by-email-hash` de
 * `user_fragments` para resolver Recovery v2 sin exponer el email en
 * plano más allá de Cognito (que ya lo tiene).
 */
export function emailHashBytes(email: string): Uint8Array {
  const normalized = email.toLowerCase().trim();
  return sha256(new TextEncoder().encode(normalized));
}

/** Largo del salt en bytes. Coincide con `emailSalt` del flujo de createWallet. */
export const RECOVERY_SALT_BYTES = 32;

/** Largo de la `recoveryKey` derivada. Suficiente para AES-256-GCM. */
export const RECOVERY_KEY_BYTES = 32;

export interface DeriveRecoveryKeyParams {
  /**
   * Password en plano. **Solo vive en cliente.** Después de la derivación
   * el caller debe zero-izar el buffer del password con `zeroize`.
   *
   * Si el caller solo tiene un `string`, debe codificarlo a `Uint8Array`
   * vía `new TextEncoder().encode(password)` ANTES de pasarlo aquí —
   * los `string` JS son inmutables y no se pueden zeroizar.
   */
  readonly password: Uint8Array;
  /**
   * Salt de recovery (32 bytes). En `createWallet` se genera con
   * `generateRecoverySalt()`. En recovery se recibe del backend junto con
   * el `fragmentF3Encrypted`.
   */
  readonly salt: Uint8Array;
  /**
   * Iteraciones PBKDF2. Default 600k (OWASP 2023). Solo pasar override
   * para tests; producción debe usar el default.
   */
  readonly iterations?: number;
}

/**
 * Genera un salt aleatorio de 32 bytes para recovery key.
 *
 * Llamado una sola vez en `createWallet`. El salt viaja al backend junto con
 * `fragmentF3Encrypted` y se usa para re-derivar la misma key durante recovery.
 */
export function generateRecoverySalt(): Uint8Array {
  return getRandomBytes(RECOVERY_SALT_BYTES);
}

/**
 * Deriva una `recoveryKey` AES-256 desde el password de Cognito + salt.
 *
 * Determinista: misma `(password, salt)` → misma key.
 *
 * **Importante para no-custodia:** el caller es responsable de:
 *  - zeroizar `params.password` después de llamar esta función.
 *  - zeroizar el `Uint8Array` devuelto después de usarlo para AES-GCM
 *    (encrypt o decrypt).
 *
 * @throws RangeError si `salt.length !== RECOVERY_SALT_BYTES`.
 */
export function deriveRecoveryKey(params: DeriveRecoveryKeyParams): Uint8Array {
  if (params.salt.length !== RECOVERY_SALT_BYTES) {
    throw new RangeError(
      `deriveRecoveryKey: salt must be ${RECOVERY_SALT_BYTES} bytes, got ${params.salt.length}`,
    );
  }
  if (params.password.length === 0) {
    throw new RangeError('deriveRecoveryKey: password must be non-empty');
  }
  const iterations = params.iterations ?? PBKDF2_DEFAULT_ITERATIONS;
  return pbkdf2Sha256(params.password, params.salt, {
    iterations,
    length: RECOVERY_KEY_BYTES,
  });
}

/**
 * Helper conveniente: deriva una `recoveryKey` desde un password string +
 * salt, codificando + zeroizando el buffer del password en el camino.
 *
 * **Cuidado:** strings JS son inmutables; no podemos zeroizar el string
 * original que el caller pasó. Para no-custodia estricta el caller debe
 * usar `deriveRecoveryKey` directamente con un buffer y zeroizarlo.
 *
 * Este helper se ofrece para integradores que aceptan el trade-off de UX
 * vs. estricta higiene de memoria.
 */
export function deriveRecoveryKeyFromPasswordString(
  password: string,
  salt: Uint8Array,
  iterations?: number,
): Uint8Array {
  const buffer = new TextEncoder().encode(password);
  try {
    return deriveRecoveryKey({
      password: buffer,
      salt,
      ...(iterations !== undefined ? { iterations } : {}),
    });
  } finally {
    zeroize(buffer);
  }
}
