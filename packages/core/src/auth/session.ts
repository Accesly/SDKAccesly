/**
 * Pluggable session storage for `AuthTokens`. The SDK persists nothing by
 * default — the `InMemorySessionStorage` is the safest choice for web apps
 * that re-authenticate on every page load.
 *
 * Apps that want persistence (Electron, native, or first-party domains willing
 * to accept the XSS exposure of localStorage) supply their own implementation.
 */

import type { AuthTokens } from './types.js';

export interface SessionStorage {
  load(): AuthTokens | null | Promise<AuthTokens | null>;
  save(tokens: AuthTokens): void | Promise<void>;
  clear(): void | Promise<void>;
}

export class InMemorySessionStorage implements SessionStorage {
  private tokens: AuthTokens | null = null;

  load(): AuthTokens | null {
    return this.tokens;
  }

  save(tokens: AuthTokens): void {
    this.tokens = tokens;
  }

  clear(): void {
    this.tokens = null;
  }
}
