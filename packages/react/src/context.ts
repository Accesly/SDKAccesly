/**
 * React context internals — keep separate from the Provider component to
 * make refactors and tests cleaner.
 */

import { createContext } from 'react';
import type {
  AccesslyEndpoints,
  AuthClient,
  AuthStatus,
  CognitoConfig,
  DeviceStore,
  Environment,
  SessionStorage,
  TokenManager,
} from '@accesly/core';

export interface AcceslyContextValue {
  readonly appId: string;
  readonly env: Environment;
  readonly apiUrl: string;
  readonly cognitoConfig: CognitoConfig;
  readonly authClient: AuthClient;
  readonly sessionStorage: SessionStorage;
  readonly tokenManager: TokenManager;
  readonly endpoints: AccesslyEndpoints;
  readonly deviceStore: DeviceStore;
  /** Current auth status — re-rendered whenever it changes. */
  readonly status: AuthStatus;
  readonly username: string | null;
  /** Force a re-read of `tokenManager.getStatus()`. */
  readonly refreshStatus: () => Promise<void>;
  /**
   * Path absoluto (con leading `/`) que el SDK usa para construir el
   * callback URI del OAuth con Cognito. Si el integrador no lo seteó en
   * `<AcceslyProvider authCallbackPath="...">`, queda `undefined` y los
   * defaults del SDK caen al legacy `${origin}/auth/callback`.
   *
   * Cuando está seteado, todas las llamadas del SDK (`auth.signInWithGoogle()`,
   * `auth.handleAuthCallback()` sin args, `<AuthCallback>` sin
   * `redirectUri`, `<RecoveryFlow>` Google path) usan
   * `${window.location.origin}${authCallbackPath}` como redirect URI por
   * default. El integrador puede seguir overrideando per-call si necesita
   * routing distinto en algún flow específico.
   */
  readonly authCallbackPath?: string;
}

export const AcceslyContext = createContext<AcceslyContextValue | null>(null);
