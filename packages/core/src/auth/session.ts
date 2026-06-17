/**
 * Pluggable session storage for `AuthTokens`. The SDK ships two
 * implementations:
 *
 *   - `LocalStorageSessionStorage` — persiste en `window.localStorage`.
 *     Sobrevive page reloads / cierre de tab; aceptable para apps web first-
 *     party que confían en su CSP / XSS posture. Es el **default** del
 *     `AcceslyProvider` cuando detecta `window.localStorage` disponible.
 *
 *   - `InMemorySessionStorage` — solo vive en memoria. Cualquier reload borra
 *     la sesión. Útil para Node/SSR y para apps que quieren forzar re-login en
 *     cada pestaña nueva. Es el fallback cuando `localStorage` no existe (SSR,
 *     workers, etc.).
 *
 * Apps que quieran otro backend (httpOnly cookie + server session, IndexedDB,
 * Electron safeStorage, native iOS Keychain) implementan la interfaz a mano.
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

/**
 * Persiste `AuthTokens` en `window.localStorage`. Sobrevive reloads, cierre
 * de tab y restart del browser. Lectura síncrona (la I/O del storage local es
 * blocking pero rápida — sub-ms para items chicos como un token JWT).
 *
 * **Trade-off:** un XSS en la app puede leer los tokens. Para mitigar:
 *  - CSP estricta (`script-src 'self'`, sin `unsafe-inline`).
 *  - Marcar el token como short-lived (Cognito default = 1h) + refresh token
 *    rotando.
 *  - Considerar mover a httpOnly cookie + backend session si el modelo de
 *    amenaza lo justifica.
 *
 * Usa el storage key `accesly:session` por default; configurable por si una
 * app sirve múltiples Accesly providers en el mismo origin (raro).
 */
export class LocalStorageSessionStorage implements SessionStorage {
  private readonly key: string;

  constructor(opts: { key?: string } = {}) {
    this.key = opts.key ?? 'accesly:session';
  }

  load(): AuthTokens | null {
    try {
      const raw = globalThis.localStorage?.getItem(this.key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<AuthTokens>;
      if (
        typeof parsed.idToken !== 'string' ||
        typeof parsed.expiresAt !== 'number'
      ) {
        return null;
      }
      return parsed as AuthTokens;
    } catch {
      return null;
    }
  }

  save(tokens: AuthTokens): void {
    try {
      globalThis.localStorage?.setItem(this.key, JSON.stringify(tokens));
    } catch {
      // Quota exceeded, private mode, disabled — degradar a no-op silencioso.
      // La sesión seguirá funcionando in-memory durante esta tab.
    }
  }

  clear(): void {
    try {
      globalThis.localStorage?.removeItem(this.key);
    } catch {
      // no-op
    }
  }
}

/**
 * Devuelve la implementación de `SessionStorage` por default para el
 * environment actual: `LocalStorageSessionStorage` si `window.localStorage`
 * está disponible (browsers), si no `InMemorySessionStorage` (Node/SSR).
 *
 * Usado por `AcceslyProvider` cuando no se pasa `overrides.sessionStorage`.
 */
export function defaultSessionStorage(): SessionStorage {
  try {
    if (typeof globalThis.localStorage !== 'undefined') {
      // Touch-test: algunos browsers (Safari private mode antes de v15)
      // exponen `localStorage` pero lanzan en `setItem`. Si truena, fallback.
      const probeKey = '__accesly_probe__';
      globalThis.localStorage.setItem(probeKey, '1');
      globalThis.localStorage.removeItem(probeKey);
      return new LocalStorageSessionStorage();
    }
  } catch {
    // localStorage existe pero no funciona — fallback.
  }
  return new InMemorySessionStorage();
}
