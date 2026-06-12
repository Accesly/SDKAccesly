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

/**
 * Structural type for the optional ZK email prover. Defined here (not
 * imported from `@accesly/zkemail`) so this package stays
 * runtime-independent of zkemail. Apps that wire recovery pass an
 * `@accesly/zkemail` `ZkEmailProver` instance — its public shape is a
 * superset of this.
 */
export interface ZkEmailProverHandle {
  prove(args: {
    readonly eml: string;
    readonly recovery: {
      readonly recipientEmail: string;
      readonly walletAddress: string;
      readonly newPasskeyPubkey: Uint8Array;
      readonly domainSalt: Uint8Array;
    };
    readonly rsaModulus: bigint;
  }): Promise<{
    readonly bundle: {
      readonly proof: { readonly a: Uint8Array; readonly b: Uint8Array; readonly c: Uint8Array };
      readonly publicSignals: readonly Uint8Array[];
    };
    readonly elapsedMs: number;
  }>;
}

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
   * Optional ZK email prover for SEP-30 recovery. When omitted,
   * `auth.recover()` throws `RecoveryNotAvailableError`. Apps that need
   * recovery wire it via `<AcceslyProvider zkEmailProver={...}>`.
   */
  readonly zkEmailProver?: ZkEmailProverHandle;
}

export const AcceslyContext = createContext<AcceslyContextValue | null>(null);
