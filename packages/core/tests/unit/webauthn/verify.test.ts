import { describe, expect, it, vi } from 'vitest';
import { unlockPasskey } from '../../../src/webauthn/verify.js';

describe('webauthn/verify', () => {
  it('passes credentialId + prfSalt to navigator.credentials.get', async () => {
    const credentialId = new Uint8Array(32).fill(0x11);
    const prfSalt = new Uint8Array(32).fill(0x22);
    const prfOutput = new Uint8Array(32).fill(0xab);

    const credentialsGet = vi.fn().mockResolvedValue({
      rawId: credentialId.buffer,
      response: {
        authenticatorData: new Uint8Array([0x01, 0x02]).buffer,
        clientDataJSON: new Uint8Array([0x03, 0x04]).buffer,
        signature: new Uint8Array([0x05, 0x06]).buffer,
      },
      getClientExtensionResults: () => ({ prf: { results: { first: prfOutput.buffer } } }),
    });

    const result = await unlockPasskey({
      rpId: 'accesly.xyz',
      credentialId,
      challenge: new Uint8Array(32).fill(0x33),
      prfSalt,
      credentialsGet: credentialsGet as unknown as typeof navigator.credentials.get,
    });

    expect(credentialsGet).toHaveBeenCalledTimes(1);
    const opts = credentialsGet.mock.calls[0]![0].publicKey;
    expect(opts.rpId).toBe('accesly.xyz');
    expect(opts.userVerification).toBe('required');
    expect(opts.allowCredentials).toHaveLength(1);
    expect(opts.extensions.prf.eval.first.byteLength).toBe(32);

    expect(result.credentialId.length).toBe(32);
    expect(result.prfOutput?.length).toBe(32);
  });

  it('rejects challenge of wrong length', async () => {
    await expect(
      unlockPasskey({
        rpId: 'a',
        challenge: new Uint8Array(16),
        credentialsGet: vi.fn() as unknown as typeof navigator.credentials.get,
      }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it('rejects prfSalt of wrong length', async () => {
    await expect(
      unlockPasskey({
        rpId: 'a',
        challenge: new Uint8Array(32),
        prfSalt: new Uint8Array(16),
        credentialsGet: vi.fn() as unknown as typeof navigator.credentials.get,
      }),
    ).rejects.toBeInstanceOf(RangeError);
  });
});
