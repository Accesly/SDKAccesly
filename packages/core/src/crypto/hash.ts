/**
 * Wrappers thin alrededor de SHA-256 para que el integrador no tenga que
 * inventar el suyo con `crypto.subtle.digest()` (que requiere ArrayBuffer
 * tricks por las firmas cambiantes de `lib.dom`) ni importar `@noble/hashes`
 * a mano.
 *
 * Uso:
 *   import { sha256, sha256Hex } from '@accesly/core/crypto';
 *   const userIdHash = sha256(new TextEncoder().encode(email));
 *   const hex = sha256Hex('hello world');
 */

import { sha256 as nobleSha256 } from '@noble/hashes/sha2';

/**
 * SHA-256 sobre un `Uint8Array`. Síncrono — usa `@noble/hashes` que es JS puro
 * y portable (Node, browser, workers, SSR).
 */
export function sha256(data: Uint8Array): Uint8Array {
  return nobleSha256(data);
}

/**
 * SHA-256 sobre una string UTF-8 (o `Uint8Array`), devuelto como hex lowercase.
 */
export function sha256Hex(data: string | Uint8Array): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = nobleSha256(bytes);
  let out = '';
  for (let i = 0; i < digest.length; i += 1) {
    out += (digest[i] ?? 0).toString(16).padStart(2, '0');
  }
  return out;
}
