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
  GetFragment2Request,
  GetFragment2Response,
  HealthResponse,
  HexString,
  KycStartResponse,
  OrderAction,
  OrderRequest,
  OrderResponse,
} from '../types/api.js';
