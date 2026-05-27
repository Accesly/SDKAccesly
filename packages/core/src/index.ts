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
  generateKeypair,
  signEd25519,
  verifyEd25519,
  withZeroize,
  zeroize,
  type Ed25519Keypair,
  type EncryptedEnvelope,
} from './crypto/index.js';

export {
  CognitoAuthClient,
  InMemorySessionStorage,
  TokenManager,
  type AuthClient,
  type AuthStatus,
  type AuthTokens,
  type CognitoConfig,
  type SessionStorage,
  type SignUpResult,
  type TokenManagerOptions,
} from './auth/index.js';

export {
  AccesslyApiClient,
  AccesslyApiError,
  AccesslyEndpoints,
  AuthError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ValidationError,
  type AccesslyApiClientOptions,
  type IdTokenProvider,
  type TelemetryEvent,
  type TelemetrySink,
} from './api/index.js';

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
  buildContractInvokeTransaction,
  buildPaymentTransaction,
  getBalances,
  getRecentOperations,
  signTransaction,
  type BalanceEntry,
  type BuildContractInvokeParams,
  type BuildPaymentParams,
  type OperationEntry,
  type SignTransactionParams,
  type SignTransactionResult,
  type StellarNetworkParams,
} from './stellar/index.js';
