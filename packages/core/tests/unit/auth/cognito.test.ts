/**
 * CognitoAuthClient tests with the `amazon-cognito-identity-js` module mocked.
 *
 * We DO NOT exercise SRP math here — the mocked classes just record the calls
 * and return canned successes/failures. Real Cognito interaction is verified
 * by the smoke test (`scripts/smoke-test-dev.mjs`) against the dev User Pool.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSignUp = vi.fn();
const mockConfirmRegistration = vi.fn();
const mockResendConfirmationCode = vi.fn();
const mockAuthenticateUser = vi.fn();
const mockRefreshSession = vi.fn();

vi.mock('amazon-cognito-identity-js', () => ({
  CognitoUserPool: vi.fn().mockImplementation(() => ({
    signUp: mockSignUp,
  })),
  CognitoUser: vi.fn().mockImplementation(() => ({
    confirmRegistration: mockConfirmRegistration,
    resendConfirmationCode: mockResendConfirmationCode,
    authenticateUser: mockAuthenticateUser,
    refreshSession: mockRefreshSession,
  })),
  CognitoUserAttribute: vi
    .fn()
    .mockImplementation((attrs: { Name: string; Value: string }) => attrs),
  AuthenticationDetails: vi
    .fn()
    .mockImplementation((details: { Username: string; Password: string }) => details),
  CognitoRefreshToken: vi.fn().mockImplementation((t: { RefreshToken: string }) => t),
}));

async function importClient() {
  // Late import so the mock above is wired before the module under test loads.
  return await import('../../../src/auth/cognito.js');
}

const VALID_CONFIG = {
  region: 'us-east-1',
  userPoolId: 'us-east-1_TEST',
  userPoolClientId: 'client123',
};

function fakeSession(
  idToken = 'id',
  accessToken = 'access',
  refreshToken = 'refresh',
  expSec = 1_700_003_600,
) {
  return {
    getIdToken: () => ({
      getJwtToken: () => idToken,
      getExpiration: () => expSec,
    }),
    getAccessToken: () => ({ getJwtToken: () => accessToken }),
    getRefreshToken: () => ({ getToken: () => refreshToken }),
  };
}

beforeEach(() => {
  mockSignUp.mockReset();
  mockConfirmRegistration.mockReset();
  mockResendConfirmationCode.mockReset();
  mockAuthenticateUser.mockReset();
  mockRefreshSession.mockReset();
});

describe('auth/cognito.CognitoAuthClient', () => {
  it('constructor validates required config', async () => {
    const { CognitoAuthClient } = await importClient();
    expect(() => new CognitoAuthClient({ ...VALID_CONFIG, region: '' })).toThrow(TypeError);
    expect(() => new CognitoAuthClient({ ...VALID_CONFIG, userPoolId: '' })).toThrow(TypeError);
    expect(() => new CognitoAuthClient({ ...VALID_CONFIG, userPoolClientId: '' })).toThrow(
      TypeError,
    );
  });

  it('signUp resolves with userSub + userConfirmed', async () => {
    const { CognitoAuthClient } = await importClient();
    mockSignUp.mockImplementation((_e, _p, _attrs, _v, cb) =>
      cb(null, { userSub: 'sub-123', userConfirmed: false, user: {} }),
    );
    const client = new CognitoAuthClient(VALID_CONFIG);
    const r = await client.signUp('alice@accesly.xyz', 'P@ssw0rd!');
    expect(r).toEqual({ userSub: 'sub-123', userConfirmed: false });
    expect(mockSignUp).toHaveBeenCalledWith(
      'alice@accesly.xyz',
      'P@ssw0rd!',
      expect.any(Array),
      expect.any(Array),
      expect.any(Function),
    );
  });

  it('signUp rejects on Cognito error', async () => {
    const { CognitoAuthClient } = await importClient();
    mockSignUp.mockImplementation((_e, _p, _attrs, _v, cb) =>
      cb({ name: 'UsernameExistsException', message: 'user exists' }),
    );
    const client = new CognitoAuthClient(VALID_CONFIG);
    await expect(client.signUp('a@b.c', 'pwd')).rejects.toThrow('user exists');
  });

  it('confirmSignUp resolves on success', async () => {
    const { CognitoAuthClient } = await importClient();
    mockConfirmRegistration.mockImplementation((_c, _force, cb) => cb(null, 'SUCCESS'));
    const client = new CognitoAuthClient(VALID_CONFIG);
    await expect(client.confirmSignUp('a@b.c', '123456')).resolves.toBeUndefined();
  });

  it('resendConfirmationCode resolves on success', async () => {
    const { CognitoAuthClient } = await importClient();
    mockResendConfirmationCode.mockImplementation((cb) => cb(null));
    const client = new CognitoAuthClient(VALID_CONFIG);
    await expect(client.resendConfirmationCode('a@b.c')).resolves.toBeUndefined();
  });

  it('signIn returns the tokens from the Cognito session', async () => {
    const { CognitoAuthClient } = await importClient();
    mockAuthenticateUser.mockImplementation((_auth, callbacks) => {
      callbacks.onSuccess(fakeSession('id-jwt', 'ac-jwt', 'rt-jwt', 1_700_003_600));
    });
    const client = new CognitoAuthClient(VALID_CONFIG);
    const tokens = await client.signIn('alice@accesly.xyz', 'pwd');
    expect(tokens).toEqual({
      idToken: 'id-jwt',
      accessToken: 'ac-jwt',
      refreshToken: 'rt-jwt',
      expiresAt: 1_700_003_600 * 1000,
      username: 'alice@accesly.xyz',
    });
  });

  it('signIn rejects on Cognito failure', async () => {
    const { CognitoAuthClient } = await importClient();
    mockAuthenticateUser.mockImplementation((_auth, callbacks) => {
      callbacks.onFailure({ name: 'NotAuthorizedException', message: 'wrong password' });
    });
    const client = new CognitoAuthClient(VALID_CONFIG);
    await expect(client.signIn('a@b.c', 'bad')).rejects.toThrow('wrong password');
  });

  it('refreshSession returns the fresh tokens', async () => {
    const { CognitoAuthClient } = await importClient();
    mockRefreshSession.mockImplementation((_token, cb) =>
      cb(null, fakeSession('id-fresh', 'ac-fresh', 'rt-fresh', 1_700_010_000)),
    );
    const client = new CognitoAuthClient(VALID_CONFIG);
    const tokens = await client.refreshSession('old-rt', 'alice@accesly.xyz');
    expect(tokens.idToken).toBe('id-fresh');
    expect(tokens.username).toBe('alice@accesly.xyz');
  });

  it('signOut POSTs RevokeToken with X-Amz-Target', async () => {
    const { CognitoAuthClient } = await importClient();
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const client = new CognitoAuthClient(VALID_CONFIG);
      await client.signOut('refresh-jwt');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('https://cognito-idp.us-east-1.amazonaws.com/');
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers['X-Amz-Target']).toBe('AWSCognitoIdentityProviderService.RevokeToken');
      expect(headers['Content-Type']).toBe('application/x-amz-json-1.1');
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({
        Token: 'refresh-jwt',
        ClientId: 'client123',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('signOut throws on non-2xx', async () => {
    const { CognitoAuthClient } = await importClient();
    const fetchMock = vi.fn().mockResolvedValue(new Response('bad', { status: 401 }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const client = new CognitoAuthClient(VALID_CONFIG);
      await expect(client.signOut('rt')).rejects.toThrow(/RevokeToken failed: 401/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
