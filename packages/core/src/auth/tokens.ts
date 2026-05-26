/**
 * Token manager — combines an `AuthClient` and a `SessionStorage` to expose
 * a single `getValidIdToken()` operation that auto-refreshes when the cached
 * idToken is close to expiring.
 *
 * Concurrent calls share the in-flight refresh promise so we never make two
 * refresh round-trips for the same idToken expiry.
 */

import type { AuthClient, AuthTokens } from './types.js';
import type { SessionStorage } from './session.js';

export interface TokenManagerOptions {
  readonly authClient: AuthClient;
  readonly storage: SessionStorage;
  /** Time before expiry to trigger a refresh. Default: 5 minutes. */
  readonly refreshLeadTimeMs?: number;
  /** Override the wall clock. Tests only. Default: `Date.now`. */
  readonly clock?: () => number;
}

export type AuthStatus = 'anonymous' | 'authenticated' | 'expired';

export class TokenManager {
  private readonly authClient: AuthClient;
  private readonly storage: SessionStorage;
  private readonly refreshLeadTimeMs: number;
  private readonly clock: () => number;
  private refreshInFlight: Promise<AuthTokens | null> | null = null;

  constructor(opts: TokenManagerOptions) {
    this.authClient = opts.authClient;
    this.storage = opts.storage;
    this.refreshLeadTimeMs = opts.refreshLeadTimeMs ?? 5 * 60 * 1000;
    this.clock = opts.clock ?? Date.now;
  }

  /**
   * Returns a valid idToken. If the cached token is missing, returns `null`.
   * If the token is close to expiry (or expired), tries to refresh. If the
   * refresh fails, clears the local session and returns `null`.
   */
  async getValidIdToken(): Promise<string | null> {
    const current = await Promise.resolve(this.storage.load());
    if (!current) return null;
    if (this.isExpiredOrSoon(current)) {
      const refreshed = await this.refresh();
      return refreshed?.idToken ?? null;
    }
    return current.idToken;
  }

  /**
   * Snapshot of the auth status without triggering a refresh. Useful for UI
   * components that need to decide what to render.
   */
  async getStatus(): Promise<AuthStatus> {
    const current = await Promise.resolve(this.storage.load());
    if (!current) return 'anonymous';
    return this.isExpiredOrSoon(current) ? 'expired' : 'authenticated';
  }

  /**
   * Stores the freshly-issued tokens (called by the auth namespace after a
   * successful signIn / refreshSession).
   */
  async setTokens(tokens: AuthTokens): Promise<void> {
    await Promise.resolve(this.storage.save(tokens));
  }

  /**
   * Clears local session AND revokes the refresh token at the IdP. If the
   * IdP revoke fails (network), local clear still happens — the user expects
   * "log out" to be immediate from their perspective.
   */
  async signOut(): Promise<void> {
    const current = await Promise.resolve(this.storage.load());
    await Promise.resolve(this.storage.clear());
    if (current) {
      try {
        await this.authClient.signOut(current.refreshToken);
      } catch {
        /* swallow — local sign-out succeeded, IdP revoke can be retried */
      }
    }
  }

  private isExpiredOrSoon(t: AuthTokens): boolean {
    return this.clock() + this.refreshLeadTimeMs >= t.expiresAt;
  }

  /**
   * Refreshes the session. Concurrent callers share the same in-flight
   * promise so we never make two refresh round-trips for the same expiry.
   * On failure, clears the local session.
   */
  private refresh(): Promise<AuthTokens | null> {
    if (this.refreshInFlight) return this.refreshInFlight;

    const promise = (async (): Promise<AuthTokens | null> => {
      const current = await Promise.resolve(this.storage.load());
      if (!current) return null;
      try {
        const fresh = await this.authClient.refreshSession(current.refreshToken, current.username);
        await Promise.resolve(this.storage.save(fresh));
        return fresh;
      } catch {
        await Promise.resolve(this.storage.clear());
        return null;
      }
    })();

    this.refreshInFlight = promise;
    void promise.finally(() => {
      this.refreshInFlight = null;
    });
    return promise;
  }
}
