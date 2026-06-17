/**
 * Authentication subsystem — Cognito wrapper, session storage abstraction,
 * and token manager with auto-refresh.
 *
 * Typical wiring:
 *   const authClient = new CognitoAuthClient({ region, userPoolId, userPoolClientId });
 *   const storage    = new InMemorySessionStorage();
 *   const tokens     = new TokenManager({ authClient, storage });
 *   const api        = new AccesslyApiClient({ baseUrl, getIdToken: () => tokens.getValidIdToken() });
 */

export type { AuthClient, AuthTokens, SignUpResult } from './types.js';
export { CognitoAuthClient, type CognitoConfig } from './cognito.js';
export {
  InMemorySessionStorage,
  LocalStorageSessionStorage,
  defaultSessionStorage,
  type SessionStorage,
} from './session.js';
export { TokenManager, type AuthStatus, type TokenManagerOptions } from './tokens.js';
