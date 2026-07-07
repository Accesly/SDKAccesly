/**
 * `AcceslyProvider` — top-level React provider que construye los SDK
 * instances y los expone vía context.
 *
 * Apps wrap their tree:
 *   <AcceslyProvider appId="app_d_xxx" env="dev">
 *     <App />
 *   </AcceslyProvider>
 *
 * Fase 11.5 (2026-06-29) — Opción B (Cognito client per-app):
 * El Provider fetchea `/app-config/:appId` (público) al mount y usa
 * `appConfig.cognito.{userPoolId,clientId}` para instanciar el
 * `CognitoAuthClient`. Si la app no tiene esos campos (apps creadas
 * pre-Fase-11.5) el Provider lanza una pantalla de error explicando
 * que el dev tiene que actualizar.
 *
 * Para tests / custom backends, pasar `cognitoConfig` directo skipea
 * el bootstrap fetch.
 */

import {
  AccesslyApiClient,
  AccesslyEndpoints,
  CognitoAuthClient,
  defaultSessionStorage,
  InMemoryDeviceStore,
  TokenManager,
  type AuthClient,
  type AuthStatus,
  type CognitoConfig,
  type DeviceStore,
  type Environment,
  type SessionStorage,
  type TelemetrySink,
} from '@accesly/core';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AcceslyContext, type AcceslyContextValue } from './context.js';
import { ENVIRONMENT_DEFAULTS } from './config.js';

export interface AcceslyProviderProps {
  readonly appId: string;
  readonly env: Environment;
  readonly children: ReactNode;
  /** Override the resolved API URL. */
  readonly apiUrl?: string;
  /**
   * Override del Cognito config. Si se pasa, skipea el bootstrap fetch del
   * appConfig — útil para tests o setups custom donde el integrador maneja
   * Cognito por su cuenta. Default: leer del appConfig en runtime.
   */
  readonly cognitoConfig?: CognitoConfig;
  /** Override SDK pieces — for tests or custom backends. */
  readonly overrides?: {
    readonly authClient?: AuthClient;
    readonly sessionStorage?: SessionStorage;
    readonly deviceStore?: DeviceStore;
  };
  /** Optional telemetry sink — surfaces every API request/response/retry. */
  readonly telemetry?: TelemetrySink;
  /** Custom UI mientras el provider hace bootstrap del appConfig. */
  readonly loadingFallback?: ReactNode;
  /** Custom UI cuando el appConfig falta `cognito.clientId`. */
  readonly errorFallback?: (err: Error) => ReactNode;
  /**
   * Path del callback de OAuth (Google) DENTRO de la app del integrador.
   * Debe empezar con `/` y matchear EXACTAMENTE una de las
   * `CallbackURLs` registradas en el Cognito User Pool Client del app
   * (`POST /apps/:id/redirect-uris` desde el dashboard).
   *
   * Cuando el integrador lo setea, el SDK lo combina con
   * `window.location.origin` y lo usa como default tanto en
   * `auth.signInWithGoogle()` como en `auth.handleAuthCallback()`. Esto
   * evita tener que pasar `redirectUri` en cada call site cuando la app
   * vive bajo un sub-path (ej. `/demo/auth/callback` en una Astro/Next
   * landing con la wallet embedded).
   *
   * Default: undefined → SDK usa el legacy `${origin}/auth/callback`.
   *
   * Per-call override sigue funcionando — `auth.signInWithGoogle(uri)` o
   * `<AuthCallback redirectUri={uri}>` mandan sobre este default.
   */
  readonly authCallbackPath?: string;
}

interface CognitoSourceConfig {
  readonly region: string;
  readonly userPoolId: string;
  readonly userPoolClientId: string;
  readonly hostedUiDomain?: string;
}

export function AcceslyProvider(props: AcceslyProviderProps): JSX.Element {
  const defaults = ENVIRONMENT_DEFAULTS[props.env];
  const apiUrl = props.apiUrl ?? defaults.apiUrl;
  const telemetry = props.telemetry;

  // Estado del bootstrap del Cognito config. Si el integrador pasó
  // `cognitoConfig` skipeamos el fetch — útil para tests.
  const [resolvedCognito, setResolvedCognito] = useState<CognitoSourceConfig | null>(
    props.cognitoConfig
      ? {
          region: props.cognitoConfig.region,
          userPoolId: props.cognitoConfig.userPoolId,
          userPoolClientId: props.cognitoConfig.userPoolClientId,
          ...(props.cognitoConfig.hostedUiDomain
            ? { hostedUiDomain: props.cognitoConfig.hostedUiDomain }
            : {}),
        }
      : null,
  );
  const [bootstrapError, setBootstrapError] = useState<Error | null>(null);

  useEffect(() => {
    if (props.cognitoConfig) return; // override wins
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(
          `${apiUrl.replace(/\/+$/, '')}/app-config/${encodeURIComponent(props.appId)}`,
        );
        if (!r.ok) throw new Error(`appConfig fetch failed: HTTP ${r.status}`);
        const cfg = (await r.json()) as {
          cognito?: { userPoolId?: string; clientId?: string };
        };
        if (!cfg.cognito?.clientId || !cfg.cognito.userPoolId) {
          throw new Error(
            `appConfig.cognito missing — register this app on dev.accesly.xyz so it provisions its own Cognito client.`,
          );
        }
        if (cancelled) return;
        setResolvedCognito({
          region: defaults.cognito.region,
          userPoolId: cfg.cognito.userPoolId,
          userPoolClientId: cfg.cognito.clientId,
          ...(defaults.cognito.hostedUiDomain
            ? { hostedUiDomain: defaults.cognito.hostedUiDomain }
            : {}),
        });
      } catch (err) {
        if (cancelled) return;
        setBootstrapError(err instanceof Error ? err : new Error(String(err)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiUrl, props.appId, props.cognitoConfig, defaults.cognito.region, defaults.cognito.hostedUiDomain]);

  if (bootstrapError) {
    return (
      <>
        {props.errorFallback?.(bootstrapError) ?? (
          <DefaultErrorFallback err={bootstrapError} />
        )}
      </>
    );
  }
  if (!resolvedCognito) {
    return <>{props.loadingFallback ?? <DefaultLoadingFallback />}</>;
  }

  return (
    <BootstrappedProvider
      appId={props.appId}
      env={props.env}
      apiUrl={apiUrl}
      cognitoConfig={resolvedCognito}
      {...(props.authCallbackPath ? { authCallbackPath: props.authCallbackPath } : {})}
      {...(props.overrides ? { overrides: props.overrides } : {})}
      {...(telemetry ? { telemetry } : {})}
    >
      {props.children}
    </BootstrappedProvider>
  );
}

interface BootstrappedProviderProps {
  readonly appId: string;
  readonly env: Environment;
  readonly apiUrl: string;
  readonly cognitoConfig: CognitoSourceConfig;
  readonly overrides?: {
    readonly authClient?: AuthClient;
    readonly sessionStorage?: SessionStorage;
    readonly deviceStore?: DeviceStore;
  };
  readonly telemetry?: TelemetrySink;
  readonly authCallbackPath?: string;
  readonly children: ReactNode;
}

function BootstrappedProvider(props: BootstrappedProviderProps): JSX.Element {
  const instances = useMemo(() => {
    const authClient: AuthClient =
      props.overrides?.authClient ??
      new CognitoAuthClient({
        region: props.cognitoConfig.region,
        userPoolId: props.cognitoConfig.userPoolId,
        userPoolClientId: props.cognitoConfig.userPoolClientId,
        ...(props.cognitoConfig.hostedUiDomain
          ? { hostedUiDomain: props.cognitoConfig.hostedUiDomain }
          : {}),
      });
    const sessionStorage: SessionStorage =
      props.overrides?.sessionStorage ?? defaultSessionStorage();
    const deviceStore: DeviceStore = props.overrides?.deviceStore ?? new InMemoryDeviceStore();
    const tokenManager = new TokenManager({ authClient, storage: sessionStorage });
    const apiClient = new AccesslyApiClient({
      baseUrl: props.apiUrl,
      getIdToken: () => tokenManager.getValidIdToken(),
      appId: props.appId,
      ...(props.telemetry ? { telemetry: props.telemetry } : {}),
    });
    const endpoints = new AccesslyEndpoints(apiClient);
    return { authClient, sessionStorage, deviceStore, tokenManager, endpoints };
  }, [
    props.apiUrl,
    props.cognitoConfig.region,
    props.cognitoConfig.userPoolId,
    props.cognitoConfig.userPoolClientId,
    props.overrides?.authClient,
    props.overrides?.sessionStorage,
    props.overrides?.deviceStore,
    props.telemetry,
  ]);

  const [status, setStatus] = useState<AuthStatus>(() => initialStatus(instances.sessionStorage));
  const [username, setUsername] = useState<string | null>(() =>
    initialUsername(instances.sessionStorage),
  );
  const mountedRef = useRef(true);

  const refreshStatus = useCallback(async (): Promise<void> => {
    const next = await instances.tokenManager.getStatus();
    const tokens = await Promise.resolve(instances.sessionStorage.load());
    if (mountedRef.current) {
      setStatus(next);
      setUsername(tokens?.username ?? null);
    }
  }, [instances]);

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
      apiUrl: props.apiUrl,
      cognitoConfig: {
        region: props.cognitoConfig.region,
        userPoolId: props.cognitoConfig.userPoolId,
        userPoolClientId: props.cognitoConfig.userPoolClientId,
        ...(props.cognitoConfig.hostedUiDomain
          ? { hostedUiDomain: props.cognitoConfig.hostedUiDomain }
          : {}),
      },
      authClient: instances.authClient,
      sessionStorage: instances.sessionStorage,
      tokenManager: instances.tokenManager,
      endpoints: instances.endpoints,
      deviceStore: instances.deviceStore,
      status,
      username,
      refreshStatus,
      ...(props.authCallbackPath ? { authCallbackPath: props.authCallbackPath } : {}),
    }),
    [
      props.appId,
      props.env,
      props.apiUrl,
      props.cognitoConfig.region,
      props.cognitoConfig.userPoolId,
      props.cognitoConfig.userPoolClientId,
      props.cognitoConfig.hostedUiDomain,
      props.authCallbackPath,
      instances,
      status,
      username,
      refreshStatus,
    ],
  );

  return <AcceslyContext.Provider value={value}>{props.children}</AcceslyContext.Provider>;
}

function initialStatus(storage: SessionStorage): AuthStatus {
  const tokens = storage.load();
  if (tokens instanceof Promise) return 'bootstrapping';
  if (!tokens) return 'anonymous';
  return Date.now() + 5 * 60 * 1000 >= tokens.expiresAt ? 'expired' : 'authenticated';
}

function initialUsername(storage: SessionStorage): string | null {
  const tokens = storage.load();
  if (tokens instanceof Promise) return null;
  return tokens?.username ?? null;
}

function DefaultLoadingFallback(): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '3rem',
        color: '#9ca3af',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '14px',
      }}
    >
      Cargando configuración…
    </div>
  );
}

function DefaultErrorFallback({ err }: { err: Error }): JSX.Element {
  return (
    <div
      style={{
        padding: '2rem',
        margin: '2rem auto',
        maxWidth: '32rem',
        borderRadius: '12px',
        border: '1px solid #fecaca',
        background: '#fef2f2',
        color: '#991b1b',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h2 style={{ fontWeight: 700, marginBottom: '0.5rem' }}>
        Accesly: configuración incompleta
      </h2>
      <p style={{ fontSize: '14px', lineHeight: 1.5 }}>{err.message}</p>
    </div>
  );
}
