/**
 * Cryptographically secure randomness.
 *
 * Wraps the platform CSPRNG (`crypto.getRandomValues`) so tests can inject a
 * deterministic source. Production code should never see the override.
 *
 * The Web Crypto API is available in Node 20+, modern browsers, and React Native
 * (via react-native-quick-crypto or polyfill). No fallback is provided — failing
 * loud is better than silently using a weaker source.
 */

type RandomSource = (length: number) => Uint8Array;

const platformSource: RandomSource = (length: number): Uint8Array => {
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error(
      'crypto.getRandomValues is not available in this environment. ' +
        'Accesly requires Node 20+ or a modern browser/React Native runtime.',
    );
  }
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
};

let currentSource: RandomSource = platformSource;

/**
 * Returns `length` cryptographically random bytes.
 */
export function getRandomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 0 || length > 65_536) {
    throw new RangeError(`getRandomBytes: length must be 0..65536, got ${length}`);
  }
  return currentSource(length);
}

/**
 * Test-only: replace the randomness source with a deterministic one.
 * Returns a restore function.
 *
 * Never call this from production code. Tests use it for property-based and
 * reproducible scenarios.
 */
export function __setRandomSourceForTests(source: RandomSource): () => void {
  const previous = currentSource;
  currentSource = source;
  return () => {
    currentSource = previous;
  };
}
