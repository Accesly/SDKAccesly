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
}

export const AcceslyContext = createContext<AcceslyContextValue | null>(null);
