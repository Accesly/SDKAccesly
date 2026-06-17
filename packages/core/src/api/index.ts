/**
 * Accesly backend HTTP client. Typed wrappers for each endpoint, retry with
 * exponential backoff, telemetry events. Never touches key material.
 */

export {
  AccesslyApiClient,
  type AccesslyApiClientOptions,
  type IdTokenProvider,
  type Json,
  type RequestOptions,
  type TelemetryEvent,
  type TelemetrySink,
} from './client.js';

export { AccesslyEndpoints } from './endpoints.js';

export {
  AccesslyApiError,
  AuthError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ValidationError,
  errorForResponse,
  type AccesslyApiErrorOptions,
} from './errors.js';

export type {
  Base64String,
  CreateWalletRequest,
  CreateWalletResponse,
  EncryptedFragmentWire,
  FinalizeRecoveryRequest,
  FinalizeRecoveryResponse,
  GetFragment2Request,
  GetFragment2Response,
  GetFragment3Response,
  GetWalletResponse,
  HealthResponse,
  HexString,
  KycStartResponse,
  OrderAction,
  OrderRequest,
  OrderResponse,
  RecoveryOtpRequestInput,
  RecoveryOtpRequestResponse,
  RecoveryOtpVerifyInput,
  RecoveryOtpVerifyResponse,
  SimulateRotateSignerRequest,
  SimulateRotateSignerResponse,
  ActivatableAsset,
  ActivateAssetSimulateRequest,
  SimulateSwapRequest,
  SimulateSwapResponse,
  SimulateTxRequest,
  SimulateTxResponse,
  SubmitTxRequest,
  SubmitTxResponse,
  TransferAsset,
  WalletActivityEvent,
  WalletActivityResponse,
  WalletBalanceResponse,
  WalletHistoryItem,
  WalletHistoryRequestOptions,
  WalletHistoryResponse,
} from '../types/api.js';
