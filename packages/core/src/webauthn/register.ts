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
  if (der.length < 65) {
    throw new Error(`registerPasskey: SPKI too short (${der.length} bytes)`);
  }
  // The uncompressed ECPoint is always the last 65 bytes of the SPKI for an
  // ES256 key. The leading bytes are the AlgorithmIdentifier wrapper.
  const ecPoint = der.subarray(der.length - 65);
  const prefix = ecPoint[0] ?? 0;
  if (prefix !== 0x04) {
    throw new Error(
      `registerPasskey: expected uncompressed EC point (0x04 prefix), got 0x${prefix.toString(16)}`,
    );
  }
  return new Uint8Array(ecPoint);
}
