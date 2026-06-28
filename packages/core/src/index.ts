/**
 * @accesly/core — framework-agnostic non-custodial wallet primitives for Stellar.
 *
 * Modules:
 * - `@accesly/core/crypto` — keypair, Shamir SSS, AES-GCM, HKDF/PBKDF2, X25519, zeroize
 * - `@accesly/core/mpc`    — orchestration of split (create wallet) + combine (reconstruct key)
 * - `@accesly/core/api`    — HTTP client and typed wrappers for the Accesly backend
 *
 * NON-CUSTODY GUARANTEE
 * The master key never leaves the device. The SDK generates it client-side, splits with Shamir,
 * encrypts F2 and F3 before sending to the backend, and zeroes memory immediately after signing.
 * See docs/Trust_Model_SDK.md and ADR-006 of the smart contracts repository.
 */

export const SDK_VERSION = '0.0.0';

export type Environment = 'dev' | 'staging' | 'prod';

export interface AcceslyCoreConfig {
  readonly appId: string;
  readonly env: Environment;
  readonly apiUrl?: string;
}

// Re-export the most commonly used building blocks at the top level. Consumers
// who want a smaller bundle can import from the sub-paths instead.
export {
  createWallet,
  reconstructFromPlainAndEncrypted,
  reconstructKey,
  type CreateWalletParams,
  type CreateWalletResult,
  type EncryptedFragments,
  type EncryptedFragmentInput,
  type FragmentEncryptionKeys,
  type ReconstructFromPlainParams,
  type ReconstructKeyParams,
  type ReconstructKeyResult,
} from './mpc/index.js';

export {
  decryptAesGcm,
  deriveRecoveryKey,
  deriveRecoveryKeyFromPasswordString,
  emailHashBytes,
  encryptAesGcm,
  generateKeypair,
  generateRecoverySalt,
  generateX25519Keypair,
  getRandomBytes,
  hkdfSha256,
  pbkdf2Sha256,
  RECOVERY_KEY_BYTES,
  RECOVERY_SALT_BYTES,
  sha256,
  sha256Hex,
  signEd25519,
  unwrapSessionFragment2,
  verifyEd25519,
  withZeroize,
  zeroize,
  type DeriveRecoveryKeyParams,
  type Ed25519Keypair,
  type EncryptedEnvelope,
  type Pbkdf2Options,
  type SessionFragment2Response,
  type UnwrappedFragment2,
  type X25519Keypair,
} from './crypto/index.js';

export {
  CognitoAuthClient,
  defaultSessionStorage,
  InMemorySessionStorage,
  LocalStorageSessionStorage,
  TokenManager,
  type AuthClient,
  type AuthStatus,
  type AuthTokens,
  type CognitoConfig,
  type SessionStorage,
  type SignUpResult,
  type TokenManagerOptions,
} from './auth/index.js';

export { formatError, type FormatErrorLocale, type FormatErrorOptions } from './errors/index.js';

export {
  AccesslyApiClient,
  AccesslyApiError,
  AccesslyEndpoints,
  AuthError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  ServerError,
  GAddressNotBootstrappedError,
  ValidationError,
  WalletNotEnrolledError,
  type AccesslyApiClientOptions,
  type IdTokenProvider,
  type TelemetryEvent,
  type TelemetrySink,
  type ActivatableAsset,
  type ActivateAssetSimulateRequest,
  type BootstrapGSimulateResponse,
  type BootstrapGSubmitRequest,
  type BootstrapGSubmitResponse,
  type SweepGSimulateResponse,
  type SweepGSubmitRequest,
  type SweepGSubmitResponse,
  type OrderRequest,
  type OrderResponse,
  type RegisterBankAccountRequest,
  type RegisterBankAccountResponse,
  type SimulateSwapRequest,
  type SimulateSwapResponse,
  type SimulateSwapSdexResponse,
  type SubmitSwapSdexRequest,
  type SubmitSwapSdexResponse,
  type FinalizeSwapSdexRequest,
  type FinalizeSwapSdexResponse,
  type TransferAsset,
  type WalletActivityEvent,
  type WalletActivityResponse,
  type WalletBalanceResponse,
  type WalletHistoryItem,
  type WalletHistoryRequestOptions,
  type WalletHistoryResponse,
  type WalletUpgradeSimulateRequest,
  type WalletUpgradeSimulateResponse,
  type WalletUpgradeSubmitRequest,
  type WalletUpgradeSubmitResponse,
} from './api/index.js';

// Phase 1 (2026-06-28): appConfig — read by the SDK at boot.
export type {
  AppConfigResponse,
  AppConfigBranding,
  AppConfigAuth,
  AppConfigNetworks,
  AppConfigTrustline,
  AppConfigWallet,
  AppConfigPolicies,
  AppConfigWebhook,
  AppConfigFeatures,
  AppEnvironment,
  AuthProvider,
  TrustlineCode,
  RolloutStrategy,
  RolloutCohort,
  FeeStrategy,
  AppPlan,
  AppStatus,
  KycLevel,
  FiatOnrampMethod,
} from './types/app-config.js';

export {
  IndexedDbDeviceStore,
  InMemoryDeviceStore,
  normalizeSecp256r1Pubkey,
  registerPasskey,
  unlockPasskey,
  type CredentialRecord,
  type DeviceStore,
  type PasskeyDescriptor,
  type RegisterPasskeyParams,
  type RegisterPasskeyResult,
  type UnlockPasskeyParams,
  type UnlockPasskeyResult,
} from './webauthn/index.js';

export {
  XLM_DECIMALS,
  accountExplorerUrl,
  buildContractInvokeTransaction,
  buildPaymentTransaction,
  computeSmartAccountAddress,
  getBalances,
  getRecentOperations,
  isValidStellarAddress,
  shortAddress,
  signSorobanAuthEntry,
  signTransaction,
  stroopsToXlm,
  txExplorerUrl,
  walletExplorerUrl,
  xlmToStroops,
  type BalanceEntry,
  type BuildContractInvokeParams,
  type BuildPaymentParams,
  type ComputeSmartAccountAddressParams,
  type OperationEntry,
  type SignSorobanAuthEntryParams,
  type StellarNetwork,
  type SignSorobanAuthEntryResult,
  type SignTransactionParams,
  type SignTransactionResult,
  type StellarNetworkParams,
} from './stellar/index.js';

// Recovery via ZK email + `@accesly/zkemail` se removió en 1.0.0-pre.0 (2026-06-15).
// El nuevo modelo (OTP-email + password de Cognito) llega en `@accesly/react`
// como `recovery` namespace en 1.0.0 final.
// Ver SDKAccesly/docs/Plan_Final_v1.md §5 (Fase 1).
