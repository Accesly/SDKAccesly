import { describe, expect, it, vi } from 'vitest';
import { registerPasskey } from '../../../src/webauthn/register.js';

function fakeSpki(): ArrayBuffer {
  // Last 65 bytes = uncompressed EC point starting with 0x04
  const spki = new Uint8Array(91);
  spki[91 - 65] = 0x04;
  for (let i = 1; i < 65; i += 1) spki[91 - 65 + i] = i;
  return spki.buffer;
}

describe('webauthn/register', () => {
  it('builds a Level-2 create options blob and extracts pubkey + credentialId', async () => {
    const credentialId = new Uint8Array(32).fill(0x77);
    const prfOutput = new Uint8Array(32).fill(0xaa);

    const credentialsCreate = vi.fn().mockResolvedValue({
      rawId: credentialId.buffer,
      response: {
        getPublicKey: () => fakeSpki(),
      },
      getClientExtensionResults: () => ({ prf: { results: { first: prfOutput.buffer } } }),
    });

    const result = await registerPasskey({
      rpId: 'accesly.xyz',
      rpName: 'Accesly',
      userId: new Uint8Array(32).fill(0x42),
      userName: 'alice@accesly.xyz',
      credentialsCreate: credentialsCreate as unknown as typeof navigator.credentials.create,
    });

    expect(credentialsCreate).toHaveBeenCalledTimes(1);
    const opts = credentialsCreate.mock.calls[0]![0].publicKey;
    expect(opts.rp).toEqual({ id: 'accesly.xyz', name: 'Accesly' });
    expect(opts.user.name).toBe('alice@accesly.xyz');
    expect(opts.authenticatorSelection.userVerification).toBe('required');
    expect(opts.authenticatorSelection.residentKey).toBe('required');
    expect(opts.pubKeyCredParams[0]).toEqual({ type: 'public-key', alg: -7 });

    expect(result.credentialId.length).toBe(32);
    expect(result.secp256r1Pubkey.length).toBe(65);
    expect(result.secp256r1Pubkey[0]).toBe(0x04);
    expect(result.prfSupported).toBe(true);
    expect(result.prfOutput?.length).toBe(32);
    expect(result.prfSalt.length).toBe(32);
  });

  it('reports prfSupported=false when the authenticator skips PRF', async () => {
    const credentialsCreate = vi.fn().mockResolvedValue({
      rawId: new Uint8Array(16).buffer,
      response: { getPublicKey: () => fakeSpki() },
      getClientExtensionResults: () => ({}),
    });

    const result = await registerPasskey({
      rpId: 'a',
      rpName: 'a',
      userId: new Uint8Array(8),
      userName: 'a@a.a',
      credentialsCreate: credentialsCreate as unknown as typeof navigator.credentials.create,
    });
    expect(result.prfSupported).toBe(false);
    expect(result.prfOutput).toBeNull();
  });

  it('throws when prfSalt is not 32 bytes', async () => {
    await expect(
      registerPasskey({
        rpId: 'a',
        rpName: 'a',
        userId: new Uint8Array(8),
        userName: 'a@a.a',
        prfSalt: new Uint8Array(16),
        credentialsCreate: vi.fn() as unknown as typeof navigator.credentials.create,
      }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it('throws when authenticator does not expose getPublicKey()', async () => {
    const credentialsCreate = vi.fn().mockResolvedValue({
      rawId: new Uint8Array(8).buffer,
      response: {},
      getClientExtensionResults: () => ({}),
    });
    await expect(
      registerPasskey({
        rpId: 'a',
        rpName: 'a',
        userId: new Uint8Array(8),
        userName: 'a@a.a',
        credentialsCreate: credentialsCreate as unknown as typeof navigator.credentials.create,
      }),
    ).rejects.toThrow(/getPublicKey/);
  });

  it('throws when SPKI does not contain an uncompressed EC point', async () => {
    const bad = new Uint8Array(91);
    bad[91 - 65] = 0x03; // compressed, not uncompressed
    const credentialsCreate = vi.fn().mockResolvedValue({
      rawId: new Uint8Array(8).buffer,
      response: { getPublicKey: () => bad.buffer },
      getClientExtensionResults: () => ({}),
    });
    await expect(
      registerPasskey({
        rpId: 'a',
        rpName: 'a',
        userId: new Uint8Array(8),
        userName: 'a@a.a',
        credentialsCreate: credentialsCreate as unknown as typeof navigator.credentials.create,
      }),
    ).rejects.toThrow(/uncompressed/);
  });
});
