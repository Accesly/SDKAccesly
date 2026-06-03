/**
 * Cryptographic primitives. Wrappers around audited noble libraries plus an
 * in-house GF(256) byte-wise Shamir Secret Sharing implementation.
 *
 * Files in this directory are allow-listed in `scripts/audit-no-custody.mjs`
 * to touch raw key material. Any code outside this allowlist that imports
 * these primitives must be reviewed under the non-custody rule.
 */

export {
  ED25519_PUBLIC_KEY_LENGTH,
  ED25519_SEED_LENGTH,
  ED25519_SIGNATURE_LENGTH,
  generateKeypair,
  publicKeyFromSeed,
  signEd25519,
  verifyEd25519,
  type Ed25519Keypair,
} from './keypair.js';

export {
  SHAMIR_MAX_SHARES,
  decodeShare,
  encodeShare,
  shamirCombine,
  splitSecret,
  type ShamirShare,
} from './shamir.js';

export {
  AES_GCM_NONCE_LENGTH,
  AES_GCM_TAG_LENGTH,
  AES_KEY_LENGTH,
  decryptAesGcm,
  encryptAesGcm,
  type EncryptedEnvelope,
} from './aesgcm.js';

export { PBKDF2_DEFAULT_ITERATIONS, hkdfSha256, pbkdf2Sha256, type Pbkdf2Options } from './kdf.js';

export {
  X25519_PRIVATE_KEY_LENGTH,
  X25519_PUBLIC_KEY_LENGTH,
  X25519_SHARED_SECRET_LENGTH,
  generateX25519Keypair,
  x25519Ecdh,
  x25519PublicKey,
  type X25519Keypair,
} from './x25519.js';

export { withZeroize, withZeroizeAsync, zeroize } from './zeroize.js';

export {
  unwrapSessionFragment2,
  type SessionFragment2Response,
  type UnwrappedFragment2,
} from './sessionFragment.js';

export { __setRandomSourceForTests, getRandomBytes } from './random.js';
