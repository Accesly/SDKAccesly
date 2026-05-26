/**
 * Key derivation functions.
 *
 * - HKDF-SHA-256 for deriving session/encryption keys from high-entropy inputs
 *   (e.g. ECDH shared secrets, raw seeds).
 * - PBKDF2-SHA-256 for deriving keys from low-entropy inputs (passwords, email
 *   addresses). Default iteration count follows OWASP 2023 guidance (600k).
 */

import { hkdf } from '@noble/hashes/hkdf';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha2';

/**
 * OWASP 2023 recommendation for PBKDF2-HMAC-SHA-256 iterations.
 * @see https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
 */
export const PBKDF2_DEFAULT_ITERATIONS = 600_000;

/**
 * HKDF-Extract-and-Expand with SHA-256.
 *
 * `ikm` should be high-entropy material. For password-derived keys, use
 * `pbkdf2Sha256` instead.
 */
export function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Uint8Array {
  if (length <= 0 || length > 8160) {
    // RFC 5869: HKDF max output is 255 * HashLen = 255 * 32 = 8160 for SHA-256.
    throw new RangeError(`hkdfSha256: length must be 1..8160, got ${length}`);
  }
  return hkdf(sha256, ikm, salt, info, length);
}

export interface Pbkdf2Options {
  /** Number of iterations. Defaults to PBKDF2_DEFAULT_ITERATIONS (600k). */
  readonly iterations?: number;
  /** Output length in bytes. Defaults to 32 (256 bits). */
  readonly length?: number;
}

/**
 * PBKDF2-HMAC-SHA-256.
 *
 * Use for low-entropy inputs such as emails or passphrases. The default
 * configuration (600k iterations, 32-byte output) follows OWASP 2023.
 *
 * `password` is a Uint8Array (not a string) so the caller can zeroize it
 * after derivation. Strings can be converted via `new TextEncoder().encode`.
 */
export function pbkdf2Sha256(
  password: Uint8Array,
  salt: Uint8Array,
  options: Pbkdf2Options = {},
): Uint8Array {
  const iterations = options.iterations ?? PBKDF2_DEFAULT_ITERATIONS;
  const length = options.length ?? 32;
  if (iterations < 1 || !Number.isInteger(iterations)) {
    throw new RangeError(`pbkdf2Sha256: iterations must be a positive integer`);
  }
  if (length < 1 || length > 1024) {
    throw new RangeError(`pbkdf2Sha256: length must be 1..1024, got ${length}`);
  }
  return pbkdf2(sha256, password, salt, { c: iterations, dkLen: length });
}
