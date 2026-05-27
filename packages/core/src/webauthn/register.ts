/**
 * Passkey registration via WebAuthn (`navigator.credentials.create`).
 *
 * Forces:
 *  - `userVerification: 'required'` — biometric/PIN must be presented.
 *  - `residentKey: 'required'` — credential stored on the authenticator (so
 *    sign-in works across browsers / tabs without a server-side username
 *    hint).
 *  - Algorithm `-7` (ES256, secp256r1).
 *  - PRF extension requested with a 32-byte salt. If the authenticator
 *    supports PRF, we get back 32 bytes deterministically derived from the
 *    passkey + salt — used to encrypt F1.
 */

import { getRandomBytes } from '../crypto/random.js';

/**
 * Forces a Uint8Array into a fresh ArrayBuffer-backed copy. Works around
 * TS 5.7 strict `BufferSource` typing where `Uint8Array<ArrayBufferLike>` is
 * not assignable to `BufferSource` (`ArrayBuffer | ArrayBufferView`). The
 * runtime behaviour is identical; this is purely a types coercion.
 */
function asBufferSource(bytes: Uint8Array): BufferSource {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return new Uint8Array(ab);
}

export interface RegisterPasskeyParams {
  /** WebAuthn relying-party ID — usually the apex domain (e.g. `accesly.xyz`). */
  readonly rpId: string;
  /** Human-readable RP name shown in the OS prompt. */
  readonly rpName: string;
  /** Unique, opaque, per-user ID. Use `SHA-256(email)` or the Cognito sub. */
  readonly userId: Uint8Array;
  /** Username shown in the OS picker (typically the email). */
  readonly userName: string;
  /** Display name shown in the OS picker. Defaults to `userName`. */
  readonly userDisplayName?: string;
  /** 32 bytes used as the PRF salt. Generated if omitted. */
  readonly prfSalt?: Uint8Array;
  /**
   * Test-only: replace `navigator.credentials.create`. Defaults to the
   * platform API.
   */
  readonly credentialsCreate?: typeof navigator.credentials.create;
}

export interface RegisterPasskeyResult {
  readonly credentialId: Uint8Array;
  readonly secp256r1Pubkey: Uint8Array;
  readonly prfSalt: Uint8Array;
  readonly prfSupported: boolean;
  /** Non-null iff `prfSupported` is true. Treat as a high-entropy key. */
  readonly prfOutput: Uint8Array | null;
}

/** Algorithm identifier for ES256 (secp256r1 + SHA-256), per IANA COSE. */
const COSE_ALG_ES256 = -7;

/**
 * Registers a new passkey for the user and (when the authenticator supports
 * PRF) returns the 32-byte key derived from the passkey + salt that can be
 * used to encrypt F1.
 *
 * Throws if `navigator.credentials.create` is not available, the user cancels,
 * or the authenticator rejects the request.
 */
export async function registerPasskey(
  params: RegisterPasskeyParams,
): Promise<RegisterPasskeyResult> {
  const credentialsCreate = params.credentialsCreate ?? defaultCredentialsCreate();
  const prfSalt = params.prfSalt ?? getRandomBytes(32);
  if (prfSalt.length !== 32) {
    throw new RangeError(`registerPasskey: prfSalt must be 32 bytes, got ${prfSalt.length}`);
  }

  const challenge = getRandomBytes(32);

  const publicKey: PublicKeyCredentialCreationOptions = {
    rp: { id: params.rpId, name: params.rpName },
    user: {
      id: asBufferSource(params.userId),
      name: params.userName,
      displayName: params.userDisplayName ?? params.userName,
    },
    challenge: asBufferSource(challenge),
    pubKeyCredParams: [{ type: 'public-key', alg: COSE_ALG_ES256 }],
    authenticatorSelection: {
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'required',
    },
    timeout: 60_000,
    attestation: 'none',
    extensions: {
      // Request PRF eval at create time. Some authenticators ignore it at
      // create and only honour it at get; we handle both.
      prf: { eval: { first: asBufferSource(prfSalt) } },
    },
  };

  const cred = (await credentialsCreate({ publicKey })) as PublicKeyCredential | null;
  if (!cred) throw new Error('registerPasskey: navigator.credentials.create returned null');
  const attestation = cred.response as AuthenticatorAttestationResponse;

  const credentialId = new Uint8Array(cred.rawId as unknown as ArrayBuffer);
  const secp256r1Pubkey = extractSecp256r1Pubkey(attestation);

  // PRF result is present iff the authenticator supports the extension AND
  // was happy to evaluate at create time.
  const extResults = (
    cred as PublicKeyCredential & {
      getClientExtensionResults?: () => { prf?: { results?: { first?: ArrayBuffer } } };
    }
  ).getClientExtensionResults?.();
  const prfBuffer = extResults?.prf?.results?.first;
  const prfOutput = prfBuffer ? new Uint8Array(prfBuffer as unknown as ArrayBuffer) : null;

  return {
    credentialId,
    secp256r1Pubkey,
    prfSalt,
    prfSupported: prfOutput !== null,
    prfOutput,
  };
}

function defaultCredentialsCreate(): typeof navigator.credentials.create {
  if (typeof navigator === 'undefined' || !navigator.credentials?.create) {
    throw new Error(
      'WebAuthn is not available in this environment. ' +
        'Accesly requires a browser that supports navigator.credentials.create.',
    );
  }
  return navigator.credentials.create.bind(navigator.credentials);
}

/**
 * Extracts the raw 65-byte uncompressed secp256r1 public key from the
 * authenticator's attestation object.
 *
 * Spec: the credential public key is encoded in CBOR/COSE inside
 * attestationObject.authData starting at offset 37 + 16 (rpIdHash + flags +
 * counter + AAGUID) + 2 (credIdLength) + credIdLength.
 *
 * To avoid pulling a CBOR decoder, we use the `getPublicKey()` convenience
 * method exposed by Level-2 WebAuthn (Chrome 85+, Safari 14+), which returns
 * an SPKI DER blob whose last 65 bytes are the uncompressed point.
 */
function extractSecp256r1Pubkey(attestation: AuthenticatorAttestationResponse): Uint8Array {
  const withHelpers = attestation as AuthenticatorAttestationResponse & {
    getPublicKey?: () => ArrayBuffer | null;
  };
  const spki = withHelpers.getPublicKey?.();
  if (!spki) {
    throw new Error(
      'registerPasskey: authenticator did not expose getPublicKey(); ' +
        'older browsers without WebAuthn Level-2 are not supported',
    );
  }
  const der = new Uint8Array(spki);
  // Delegate to the normalizer — handles standard 91-byte ES256 SPKI plus
  // a few alternative shapes some authenticators have been observed to
  // return (raw uncompressed point, raw X||Y without prefix, etc).
  try {
    return normalizeSecp256r1Pubkey(der);
  } catch (err) {
    const hexPreview = Array.from(der.slice(0, Math.min(8, der.length)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    throw new Error(
      `registerPasskey: could not extract secp256r1 pubkey from SPKI ` +
        `(length=${der.length}, first8=0x${hexPreview}). ` +
        `Underlying: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Coerces any reasonable secp256r1 public-key representation into the
 * canonical 65-byte uncompressed form (`0x04 || X(32) || Y(32)`) that the
 * Accesly backend expects on `POST /wallets`.
 *
 * Accepted inputs:
 *  - 65 bytes starting with `0x04` → returned as-is (copied).
 *  - 64 bytes (raw `X || Y` without the SEC1 uncompressed prefix) → prepends
 *    `0x04`. Some libraries strip the prefix when serialising EC points.
 *  - 91 bytes (standard P-256 SPKI from WebAuthn `getPublicKey()`) → extracts
 *    the trailing 65-byte uncompressed point.
 *
 * Rejected inputs:
 *  - 33 bytes (compressed `0x02|0x03 || X`) → throws; caller must decompress
 *    first (we don't pull a curve impl just for this).
 *  - Anything else → throws with the observed length.
 *
 * This helper exists to be defensive at the React-hook wire-serialisation
 * step so that wallets don't fail to create due to a small format mismatch
 * between the SDK's `registerPasskey` output and the backend validator.
 */
export function normalizeSecp256r1Pubkey(input: Uint8Array): Uint8Array {
  if (input.length === 65 && input[0] === 0x04) {
    return new Uint8Array(input);
  }
  if (input.length === 64) {
    const out = new Uint8Array(65);
    out[0] = 0x04;
    out.set(input, 1);
    return out;
  }
  if (input.length === 91 && input[26] === 0x04) {
    // P-256 SubjectPublicKeyInfo — the uncompressed point sits at offset 26.
    return new Uint8Array(input.subarray(26));
  }
  if (input.length === 33 && (input[0] === 0x02 || input[0] === 0x03)) {
    throw new Error(
      'normalizeSecp256r1Pubkey: compressed EC point received (prefix ' +
        `0x${input[0].toString(16)}). Decompress to uncompressed form before passing in.`,
    );
  }
  throw new RangeError(
    `normalizeSecp256r1Pubkey: unrecognised format ` +
      `(length=${input.length}, prefix=0x${(input[0] ?? 0).toString(16)}). ` +
      `Expected 65 bytes with 0x04 prefix, 64 bytes raw X||Y, or 91-byte P-256 SPKI.`,
  );
}
