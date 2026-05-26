/**
 * Passkey verification via WebAuthn (`navigator.credentials.get`).
 *
 * Two use cases:
 *  1. Unlock F1 — re-evaluate the PRF extension with the same salt that was
 *     used at registration. Returns the 32-byte PRF output that decrypts the
 *     stored F1 envelope.
 *  2. Sign a challenge for SEP-10 — return the raw assertion signature so the
 *     caller can submit it to the Stellar anchor.
 */

export interface UnlockPasskeyParams {
  readonly rpId: string;
  /** Specific credential to use; omit to let the browser pick one. */
  readonly credentialId?: Uint8Array;
  /** 32-byte challenge. Generated if omitted. */
  readonly challenge: Uint8Array;
  /**
   * 32-byte PRF salt — must match what was used at registration to recover
   * the same PRF output.
   */
  readonly prfSalt?: Uint8Array;
  readonly credentialsGet?: typeof navigator.credentials.get;
}

export interface UnlockPasskeyResult {
  readonly credentialId: Uint8Array;
  readonly authenticatorData: Uint8Array;
  readonly clientDataJSON: Uint8Array;
  readonly signature: Uint8Array;
  /** Non-null iff PRF was requested AND the authenticator supports it. */
  readonly prfOutput: Uint8Array | null;
}

function asBufferSource(bytes: Uint8Array): BufferSource {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return new Uint8Array(ab);
}

export async function unlockPasskey(params: UnlockPasskeyParams): Promise<UnlockPasskeyResult> {
  const credentialsGet = params.credentialsGet ?? defaultCredentialsGet();
  if (params.challenge.length !== 32) {
    throw new RangeError(
      `unlockPasskey: challenge must be 32 bytes, got ${params.challenge.length}`,
    );
  }
  if (params.prfSalt !== undefined && params.prfSalt.length !== 32) {
    throw new RangeError(
      `unlockPasskey: prfSalt must be 32 bytes when provided, got ${params.prfSalt.length}`,
    );
  }

  const publicKey: PublicKeyCredentialRequestOptions = {
    rpId: params.rpId,
    challenge: asBufferSource(params.challenge),
    userVerification: 'required',
    timeout: 60_000,
    ...(params.credentialId
      ? {
          allowCredentials: [
            {
              type: 'public-key',
              id: asBufferSource(params.credentialId),
              transports: ['internal', 'hybrid'],
            },
          ],
        }
      : {}),
    ...(params.prfSalt
      ? {
          extensions: {
            prf: { eval: { first: asBufferSource(params.prfSalt) } },
          },
        }
      : {}),
  };

  const cred = (await credentialsGet({ publicKey })) as PublicKeyCredential | null;
  if (!cred) throw new Error('unlockPasskey: navigator.credentials.get returned null');

  const assertion = cred.response as AuthenticatorAssertionResponse;
  const credentialId = new Uint8Array(cred.rawId as unknown as ArrayBuffer);

  const extResults = (
    cred as PublicKeyCredential & {
      getClientExtensionResults?: () => { prf?: { results?: { first?: ArrayBuffer } } };
    }
  ).getClientExtensionResults?.();
  const prfBuffer = extResults?.prf?.results?.first;
  const prfOutput = prfBuffer ? new Uint8Array(prfBuffer as unknown as ArrayBuffer) : null;

  return {
    credentialId,
    authenticatorData: new Uint8Array(assertion.authenticatorData as unknown as ArrayBuffer),
    clientDataJSON: new Uint8Array(assertion.clientDataJSON as unknown as ArrayBuffer),
    signature: new Uint8Array(assertion.signature as unknown as ArrayBuffer),
    prfOutput,
  };
}

function defaultCredentialsGet(): typeof navigator.credentials.get {
  if (typeof navigator === 'undefined' || !navigator.credentials?.get) {
    throw new Error(
      'WebAuthn is not available in this environment. ' +
        'Accesly requires a browser that supports navigator.credentials.get.',
    );
  }
  return navigator.credentials.get.bind(navigator.credentials);
}
