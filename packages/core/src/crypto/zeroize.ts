/**
 * Defensive memory zeroing for sensitive buffers.
 *
 * JavaScript does not guarantee that a freed buffer will be wiped from the
 * heap — V8 may keep a copy in young generation until the next GC, JIT'd code
 * may hold register copies, etc. `zeroize` is therefore best-effort. It does:
 *  1. Overwrite the buffer with zeros (immediate).
 *  2. Make any future accidental use of the buffer return zeros instead of
 *     the original secret.
 *
 * Always pair sensitive operations with `withZeroize` so the cleanup happens
 * even on thrown errors.
 */

/**
 * Overwrites a buffer with zeros in place. No-op on undefined/null.
 *
 * Note: views into the same underlying ArrayBuffer are also zeroed.
 */
export function zeroize(buf: Uint8Array | undefined | null): void {
  if (!buf) return;
  buf.fill(0);
}

/**
 * Runs `fn` and then zeroizes every buffer in `secrets`, including on throw.
 * Returns whatever `fn` returns.
 *
 * Use this around any code that derives intermediate secret material so that a
 * thrown error cannot leave the secret alive in memory.
 *
 * @example
 *   const signature = withZeroize([reconstructedSeed, fragmentF2Plain], () => {
 *     return sign(message, reconstructedSeed);
 *   });
 */
export function withZeroize<T>(
  secrets: ReadonlyArray<Uint8Array | undefined | null>,
  fn: () => T,
): T {
  try {
    return fn();
  } finally {
    for (const buf of secrets) zeroize(buf);
  }
}

/**
 * Async variant of `withZeroize`.
 */
export async function withZeroizeAsync<T>(
  secrets: ReadonlyArray<Uint8Array | undefined | null>,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } finally {
    for (const buf of secrets) zeroize(buf);
  }
}
