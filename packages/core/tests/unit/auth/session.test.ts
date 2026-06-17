import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultSessionStorage,
  InMemorySessionStorage,
  LocalStorageSessionStorage,
} from '../../../src/auth/session.js';
import type { AuthTokens } from '../../../src/auth/types.js';

const sampleTokens: AuthTokens = {
  idToken: 'id-jwt',
  accessToken: 'access-jwt',
  refreshToken: 'refresh-jwt',
  expiresAt: Date.now() + 3_600_000,
  username: 'alice@accesly.xyz',
};

describe('auth/session — InMemorySessionStorage', () => {
  it('starts empty', () => {
    const s = new InMemorySessionStorage();
    expect(s.load()).toBeNull();
  });

  it('round-trips tokens through save/load', () => {
    const s = new InMemorySessionStorage();
    s.save(sampleTokens);
    expect(s.load()).toEqual(sampleTokens);
  });

  it('clears the stored tokens', () => {
    const s = new InMemorySessionStorage();
    s.save(sampleTokens);
    s.clear();
    expect(s.load()).toBeNull();
  });
});

describe('auth/session — LocalStorageSessionStorage', () => {
  const fakeStore = new Map<string, string>();
  const fakeLocalStorage = {
    getItem: (k: string) => fakeStore.get(k) ?? null,
    setItem: (k: string, v: string) => {
      fakeStore.set(k, v);
    },
    removeItem: (k: string) => {
      fakeStore.delete(k);
    },
    clear: () => fakeStore.clear(),
    length: 0,
    key: () => null,
  };

  beforeEach(() => {
    fakeStore.clear();
    vi.stubGlobal('localStorage', fakeLocalStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts empty', () => {
    const s = new LocalStorageSessionStorage();
    expect(s.load()).toBeNull();
  });

  it('round-trips tokens through save/load', () => {
    const s = new LocalStorageSessionStorage();
    s.save(sampleTokens);
    expect(s.load()).toEqual(sampleTokens);
  });

  it('uses the configured key', () => {
    const s = new LocalStorageSessionStorage({ key: 'custom:key' });
    s.save(sampleTokens);
    expect(fakeStore.has('custom:key')).toBe(true);
    expect(fakeStore.has('accesly:session')).toBe(false);
  });

  it('clears stored tokens', () => {
    const s = new LocalStorageSessionStorage();
    s.save(sampleTokens);
    s.clear();
    expect(s.load()).toBeNull();
  });

  it('returns null for malformed payloads', () => {
    fakeStore.set('accesly:session', 'not json {');
    expect(new LocalStorageSessionStorage().load()).toBeNull();

    fakeStore.set('accesly:session', JSON.stringify({ idToken: 123 }));
    expect(new LocalStorageSessionStorage().load()).toBeNull();
  });

  it('does not throw if save fails (quota / disabled)', () => {
    const throwing = {
      ...fakeLocalStorage,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    vi.stubGlobal('localStorage', throwing);
    expect(() => new LocalStorageSessionStorage().save(sampleTokens)).not.toThrow();
  });
});

describe('auth/session — defaultSessionStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns LocalStorageSessionStorage when window.localStorage works', () => {
    const fakeStore = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => fakeStore.get(k) ?? null,
      setItem: (k: string, v: string) => {
        fakeStore.set(k, v);
      },
      removeItem: (k: string) => fakeStore.delete(k),
      clear: () => fakeStore.clear(),
      length: 0,
      key: () => null,
    });
    expect(defaultSessionStorage()).toBeInstanceOf(LocalStorageSessionStorage);
  });

  it('falls back to InMemorySessionStorage when localStorage throws on probe', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('disabled');
      },
      removeItem: () => undefined,
      clear: () => undefined,
      length: 0,
      key: () => null,
    });
    expect(defaultSessionStorage()).toBeInstanceOf(InMemorySessionStorage);
  });
});
