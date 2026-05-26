import { describe, expect, it } from 'vitest';
import { InMemorySessionStorage } from '../../../src/auth/session.js';
import type { AuthTokens } from '../../../src/auth/types.js';

const sampleTokens: AuthTokens = {
  idToken: 'id-jwt',
  accessToken: 'access-jwt',
  refreshToken: 'refresh-jwt',
  expiresAt: Date.now() + 3_600_000,
  username: 'alice@accesly.xyz',
};

describe('auth/session', () => {
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
