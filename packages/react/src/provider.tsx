/**
 * `AcceslyProvider` — top-level React provider that creates the SDK instances
 * once and exposes them through context. All hooks consume this.
 *
 * Apps wrap their tree:
 *   <AcceslyProvider appId="myapp" env="dev">
 *     <App />
 *   </AcceslyProvider>
 *
 * For advanced cases (custom IdP, custom storage), pass `overrides` to inject
 * your own `AuthClient`, `SessionStorage`, or `DeviceStore`.
 */

import {
  AccesslyApiClient,
  AccesslyEndpoints,
  CognitoAuthClient,
  InMemoryDeviceStore,
  InMemorySessionStorage,
  TokenManager,
  type AuthClient,
  type AuthStatus,
  type CognitoConfig,
  type DeviceStore,
  type Environment,
  type SessionStorage,
  type TelemetrySink,
} from '@accesly/core';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AcceslyContext,
  type AcceslyContextValue,
  type ZkEmailProverHandle,
} from './context.js';
import { ENVIRONMENT_DEFAULTS } from './config.js';

export interface AcceslyProviderProps {
  readonly appId: string;
  readonly env: Environment;
  readonly children: ReactNode;
  /** Override the resolved API URL. */
  readonly apiUrl?: string;
  /** Override the resolved Cognito config. */
  readonly cognitoConfig?: CognitoConfig;
  /** Override SDK pieces — for tests or custom backends. */
  readonly overrides?: {
    readonly authClient?: AuthClient;
    readonly sessionStorage?: SessionStorage;
    readonly deviceStore?: DeviceStore;
  };
  /** Optional telemetry sink — surfaces every API request/response/retry. */
  readonly telemetry?: TelemetrySink;
  /**
   * Optional ZK email prover for SEP-30 recovery. Pass an instance from
   * `@accesly/zkemail` (`createZkEmailProver({ artifactsBaseUrl })`). When
   * omitted, `auth.recover()` throws `RecoveryNotAvailableError`.
   */
  readonly zkEmailProver?: ZkEmailProverHandle;
}

export function AcceslyProvider(props: AcceslyProviderProps): JSX.Element {
  const defaults = ENVIRONMENT_DEFAULTS[props.env];
  const apiUrl = props.apiUrl ?? defaults.apiUrl;
  const cognitoConfig = props.cognitoConfig ?? defaults.cognito;
  const telemetry = props.telemetry;

  // Build the SDK pieces once. The dependency array is intentionally only the
  // identity inputs — we don't want to rebuild on every render.
  const instances = useMemo(() => {
    const authClient: AuthClient =
      props.overrides?.authClient ?? new CognitoAuthClient(cognitoConfig);
    const sessionStorage: SessionStorage =
      props.overrides?.sessionStorage ?? new InMemorySessionStorage();
    const deviceStore: DeviceStore = props.overrides?.deviceStore ?? new InMemoryDeviceStore();
    const tokenManager = new TokenManager({ authClient, storage: sessionStorage });
    const apiClient = new AccesslyApiClient({
      baseUrl: apiUrl,
      getIdToken: () => tokenManager.getValidIdToken(),
      ...(telemetry ? { telemetry } : {}),
    });
    const endpoints = new AccesslyEndpoints(apiClient);
    return { authClient, sessionStorage, deviceStore, tokenManager, endpoints };
  }, [
    apiUrl,
    cognitoConfig.region,
    cognitoConfig.userPoolId,
    cognitoConfig.userPoolClientId,
    props.overrides?.authClient,
    props.overrides?.sessionStorage,
    props.overrides?.deviceStore,
  ]);

  // Compute the initial status synchronously from storage when possible. If
  // storage.load returns a Promise (custom async storage), fall back to
  // 'anonymous' and let the mount effect upgrade it.
  const [status, setStatus] = useState<AuthStatus>(() => initialStatus(instances.sessionStorage));
  const [username, setUsername] = useState<string | null>(() =>
    initialUsername(instances.sessionStorage),
  );
  const mountedRef = useRef(true);

  const refreshStatus = async (): Promise<void> => {
    const next = await instances.tokenManager.getStatus();
    const tokens = await Promise.resolve(instances.sessionStorage.load());
    if (mountedRef.current) {
      setStatus(next);
      setUsername(tokens?.username ?? null);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    void refreshStatus();
    return () => {
      mountedRef.current = false;
    };
  }, [instances]);

  const value: AcceslyContextValue = useMemo(
    () => ({
      appId: props.appId,
      env: props.env,
      apiUrl,
      cognitoConfig,
      authClient: instances.authClient,
      sessionStorage: instances.sessionStorage,
      tokenManager: instances.tokenManager,
      endpoints: instances.endpoints,
      deviceStore: instances.deviceStore,
      status,
      username,
      refreshStatus,
      ...(props.zkEmailProver ? { zkEmailProver: props.zkEmailProver } : {}),
    }),
    [
      props.appId,
      props.env,
      apiUrl,
      cognitoConfig,
      instances,
      status,
      username,
      refreshStatus,
      props.zkEmailProver,
    ],
  );

  return <AcceslyContext.Provider value={value}>{props.children}</AcceslyContext.Provider>;
}

function initialStatus(storage: SessionStorage): AuthStatus {
  const tokens = storage.load();
  if (tokens instanceof Promise) return 'anonymous';
  if (!tokens) return 'anonymous';
  return Date.now() + 5 * 60 * 1000 >= tokens.expiresAt ? 'expired' : 'authenticated';
}

function initialUsername(storage: SessionStorage): string | null {
  const tokens = storage.load();
  if (tokens instanceof Promise) return null;
  return tokens?.username ?? null;
}
