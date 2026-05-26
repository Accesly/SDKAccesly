import { describe, expect, it, vi } from 'vitest';
import { InMemorySessionStorage } from '../../../src/auth/session.js';
import { TokenManager } from '../../../src/auth/tokens.js';
import type { AuthClient, AuthTokens } from '../../../src/auth/types.js';

const FIXED_NOW = 1_700_000_000_000;

function makeTokens(over: Partial<AuthTokens> = {}): AuthTokens {
  return {
    idToken: 'id',
    accessToken: 'ac',
    refreshToken: 'rt',
    expiresAt: FIXED_NOW + 60 * 60 * 1000,
    username: 'alice@accesly.xyz',
    ...over,
  };
}

function makeMockAuthClient(over: Partial<AuthClient> = {}): AuthClient {
  return {
    signUp: vi.fn(),
    confirmSignUp: vi.fn(),
    resendConfirmationCode: vi.fn(),
    signIn: vi.fn(),
    refreshSession: vi.fn(),
    signOut: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe('auth/tokens', () => {
  describe('getValidIdToken', () => {
    it('returns null when storage is empty', async () => {
      const tm = new TokenManager({
        authClient: makeMockAuthClient(),
        storage: new InMemorySessionStorage(),
        clock: () => FIXED_NOW,
      });
      expect(await tm.getValidIdToken()).toBeNull();
    });

    it('returns the cached idToken when not close to expiry', async () => {
      const storage = new InMemorySessionStorage();
      storage.save(makeTokens());
      const tm = new TokenManager({
        authClient: makeMockAuthClient(),
        storage,
        clock: () => FIXED_NOW,
      });
      expect(await tm.getValidIdToken()).toBe('id');
    });

    it('refreshes when within lead time of expiry', async () => {
      const storage = new InMemorySessionStorage();
      // expires in 4 minutes (less than default 5-minute lead time)
      storage.save(makeTokens({ expiresAt: FIXED_NOW + 4 * 60 * 1000 }));
      const fresh = makeTokens({ idToken: 'id-fresh', expiresAt: FIXED_NOW + 60 * 60 * 1000 });
      const refreshSession = vi.fn().mockResolvedValue(fresh);
      const tm = new TokenManager({
        authClient: makeMockAuthClient({ refreshSession }),
        storage,
        clock: () => FIXED_NOW,
      });
      expect(await tm.getValidIdToken()).toBe('id-fresh');
      expect(refreshSession).toHaveBeenCalledTimes(1);
      expect(refreshSession).toHaveBeenCalledWith('rt', 'alice@accesly.xyz');
      expect(storage.load()?.idToken).toBe('id-fresh');
    });

    it('clears storage and returns null when refresh fails', async () => {
      const storage = new InMemorySessionStorage();
      storage.save(makeTokens({ expiresAt: FIXED_NOW - 1 }));
      const refreshSession = vi.fn().mockRejectedValue(new Error('expired'));
      const tm = new TokenManager({
        authClient: makeMockAuthClient({ refreshSession }),
        storage,
        clock: () => FIXED_NOW,
      });
      expect(await tm.getValidIdToken()).toBeNull();
      expect(storage.load()).toBeNull();
    });

    it('shares the in-flight refresh promise across concurrent callers', async () => {
      const storage = new InMemorySessionStorage();
      storage.save(makeTokens({ expiresAt: FIXED_NOW - 1 }));
      let resolveRefresh: ((t: AuthTokens) => void) | undefined;
      const refreshSession = vi.fn().mockReturnValue(
        new Promise<AuthTokens>((res) => {
          resolveRefresh = res;
        }),
      );
      const tm = new TokenManager({
        authClient: makeMockAuthClient({ refreshSession }),
        storage,
        clock: () => FIXED_NOW,
      });

      const pending = Promise.all([
        tm.getValidIdToken(),
        tm.getValidIdToken(),
        tm.getValidIdToken(),
      ]);
      // Flush pending microtasks so all three callers reach the point where
      // they trigger refresh(); the shared in-flight promise then dedupes
      // the underlying refreshSession call.
      await new Promise((resolve) => setImmediate(resolve));
      expect(refreshSession).toHaveBeenCalledTimes(1);
      resolveRefresh!(makeTokens({ idToken: 'id-fresh' }));
      const [a, b, c] = await pending;
      expect(a).toBe('id-fresh');
      expect(b).toBe('id-fresh');
      expect(c).toBe('id-fresh');
    });
  });

  describe('getStatus', () => {
    it('reports anonymous when storage is empty', async () => {
      const tm = new TokenManager({
        authClient: makeMockAuthClient(),
        storage: new InMemorySessionStorage(),
        clock: () => FIXED_NOW,
      });
      expect(await tm.getStatus()).toBe('anonymous');
    });

    it('reports authenticated when token is valid', async () => {
      const storage = new InMemorySessionStorage();
      storage.save(makeTokens());
      const tm = new TokenManager({
        authClient: makeMockAuthClient(),
        storage,
        clock: () => FIXED_NOW,
      });
      expect(await tm.getStatus()).toBe('authenticated');
    });

    it('reports expired when within lead time', async () => {
      const storage = new InMemorySessionStorage();
      storage.save(makeTokens({ expiresAt: FIXED_NOW + 60_000 }));
      const tm = new TokenManager({
        authClient: makeMockAuthClient(),
        storage,
        clock: () => FIXED_NOW,
      });
      expect(await tm.getStatus()).toBe('expired');
    });
  });

  describe('signOut', () => {
    it('clears local storage and revokes the refresh token', async () => {
      const storage = new InMemorySessionStorage();
      storage.save(makeTokens());
      const signOut = vi.fn().mockResolvedValue(undefined);
      const tm = new TokenManager({
        authClient: makeMockAuthClient({ signOut }),
        storage,
        clock: () => FIXED_NOW,
      });
      await tm.signOut();
      expect(storage.load()).toBeNull();
      expect(signOut).toHaveBeenCalledWith('rt');
    });

    it('still clears local storage even if IdP revoke fails', async () => {
      const storage = new InMemorySessionStorage();
      storage.save(makeTokens());
      const signOut = vi.fn().mockRejectedValue(new Error('network'));
      const tm = new TokenManager({
        authClient: makeMockAuthClient({ signOut }),
        storage,
        clock: () => FIXED_NOW,
      });
      await tm.signOut();
      expect(storage.load()).toBeNull();
    });

    it('is a no-op when already anonymous', async () => {
      const signOut = vi.fn();
      const tm = new TokenManager({
        authClient: makeMockAuthClient({ signOut }),
        storage: new InMemorySessionStorage(),
        clock: () => FIXED_NOW,
      });
      await tm.signOut();
      expect(signOut).not.toHaveBeenCalled();
    });
  });

  describe('setTokens', () => {
    it('writes through to storage', async () => {
      const storage = new InMemorySessionStorage();
      const tm = new TokenManager({
        authClient: makeMockAuthClient(),
        storage,
        clock: () => FIXED_NOW,
      });
      const t = makeTokens();
      await tm.setTokens(t);
      expect(storage.load()).toEqual(t);
    });
  });
});
