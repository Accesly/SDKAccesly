/**
 * Shape of `GET /app-config/{appId}` — the configuration the developer
 * authored from `dev.accesly.xyz` and the SDK consumes at runtime to drive
 * branding, supported trustlines, auth providers and policies.
 *
 * Stays close to the schema in `DashboardAcceslyDev/Docs/PLAN.md §3`. All
 * fields except `appId`, `developerId` and `schemaVersion` are optional —
 * older app configs that pre-date Phase 1 may not have everything yet, and
 * the SDK applies safe defaults.
 */

export type AppEnvironment = 'dev' | 'staging' | 'prod';
export type AuthProvider = 'email' | 'google' | 'phone';
export type TrustlineCode = 'XLM' | 'USDC' | 'EURC';
export type RolloutStrategy = 'opt-in' | 'auto-propose' | 'force';
export type RolloutCohort = 'stable' | 'canary';
export type FeeStrategy = 'developer-pays' | 'user-pays' | 'hybrid' | 'user-pays-token';
export type AppPlan = 'free' | 'pro' | 'enterprise' | 'growth' | 'scale';
export type AppStatus = 'sandbox' | 'production';
export type KycLevel = 'KYC1' | 'KYC2' | 'KYC3';
export type FiatOnrampMethod = 'spei' | 'card' | 'oxxo';

export interface AppConfigBranding {
  readonly displayName?: string;
  readonly logoUrl?: string;
  readonly colors?: {
    readonly primary?: string;
    readonly secondary?: string;
    readonly accent?: string;
    readonly ink?: string;
    readonly danger?: string;
    readonly success?: string;
  };
  readonly primaryColor?: string;
  /**
   * Color secundario del brand (segundo stop del gradient). Si se omite,
   * el SDK usa su mint default `#45C9A8`.
   */
  readonly secondaryColor?: string;
  readonly fontFamily?: string;
  readonly darkModeDefault?: 'light' | 'dark' | 'auto';
  /**
   * Copy de la Landing/login. Soporta `{appName}` → `displayName`. Si el
   * dev no setea estos campos, los integrators caen al default Accesly.
   * Límites validados server-side: 40 / 30 / 160 chars respectivamente.
   */
  readonly landingTitle?: string;
  readonly landingHighlight?: string;
  readonly landingSubtitle?: string;
  /**
   * Texto del botón launcher cuando el user NO está autenticado. Soporta
   * `{appName}`. Default: 'Iniciar sesión'. Validación backend: max 30 chars.
   */
  readonly loginButtonText?: string;
}

export interface AppConfigAuth {
  readonly providers: ReadonlyArray<AuthProvider>;
  readonly phoneRegion?: string;
  readonly mfa?: 'required' | 'optional' | 'off';
  readonly webauthnEnabled?: boolean;
  readonly sessionTimeoutMinutes?: number;
  readonly reAuthOnSensitive?: boolean;
}

export interface AppConfigNetworks {
  readonly testnet: boolean;
  readonly mainnet: boolean;
}

export interface AppConfigTrustline {
  readonly code: TrustlineCode;
  readonly isNative?: boolean;
  readonly enabled: boolean;
  readonly displayName?: string;
}

export interface AppConfigWallet {
  readonly targetVersion: string;
  readonly rolloutStrategy: RolloutStrategy;
  readonly rolloutCohort: RolloutCohort;
  readonly recoveryEnabled: boolean;
}

export interface AppConfigPolicies {
  readonly spending?: {
    readonly perTxAmountCap?: { asset: string; stroops: string };
    readonly txPerDayCount?: number;
  };
  readonly blacklistAddresses?: ReadonlyArray<string>;
  readonly kyc?: {
    readonly enabled: boolean;
    readonly requiredFor?: ReadonlyArray<'onramp' | 'offramp'>;
    readonly thresholdUsd?: number;
    readonly provider?: 'etherfuse';
    readonly minLevel?: KycLevel;
  };
  readonly fees?: {
    readonly strategy: FeeStrategy;
    readonly userMarginBps?: number;
  };
}

export interface AppConfigWebhook {
  readonly event:
    | 'wallet.created'
    | 'wallet.upgraded'
    | 'tx.completed'
    | 'tx.failed'
    | 'kyc.approved'
    | 'recovery.completed';
  readonly url: string;
}

export interface AppConfigFeatures {
  readonly fiatOnramp?: { enabled: boolean; methods: ReadonlyArray<FiatOnrampMethod> };
  readonly addressBook?: boolean;
  readonly handles?: boolean;
}

export interface AppConfigResponse {
  readonly appId: string;
  readonly developerId: string;
  readonly schemaVersion?: number;
  readonly ownership?: {
    readonly ownerDeveloperId: string;
    readonly createdAt: string;
    readonly environment: AppEnvironment;
  };
  readonly branding?: AppConfigBranding;
  readonly auth?: AppConfigAuth;
  readonly networks?: AppConfigNetworks;
  readonly trustlines?: ReadonlyArray<AppConfigTrustline>;
  readonly wallet?: AppConfigWallet;
  readonly policies?: AppConfigPolicies;
  readonly webhooks?: ReadonlyArray<AppConfigWebhook>;
  readonly features?: AppConfigFeatures;
  /** Legacy field (pre-Phase 1). New consumers should read `branding.primaryColor`. */
  readonly plan?: AppPlan;
  readonly status?: AppStatus;
  /** Legacy field replaced by `trustlines` in schema v1. Older app configs still expose it. */
  readonly assets?: ReadonlyArray<{ readonly code: string; readonly issuer: string }>;
}
