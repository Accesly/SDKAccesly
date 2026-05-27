/**
 * Typed wrappers for the Accesly backend REST endpoints. One method per
 * route in `CloudServices-accesly/docs/openapi.yaml`.
 *
 * Each wrapper is a one-liner over `AccesslyApiClient` — the value is the
 * typed signature, which makes auto-complete + refactors safe.
 */

import type {
  CreateWalletRequest,
  CreateWalletResponse,
  GetFragment2Request,
  GetFragment2Response,
  GetWalletResponse,
  HealthResponse,
  KycStartResponse,
  OrderRequest,
  OrderResponse,
} from '../types/api.js';
import { NotFoundError } from './errors.js';
import type { AccesslyApiClient, Json } from './client.js';

export class AccesslyEndpoints {
  constructor(private readonly client: AccesslyApiClient) {}

  /** Public liveness check. No auth header sent. */
  health(): Promise<HealthResponse> {
    return this.client.get<HealthResponse>('/health');
  }

  /** Cognito-auth. Deploys the user's Smart Account on Soroban. */
  createWallet(req: CreateWalletRequest): Promise<CreateWalletResponse> {
    return this.client.post<CreateWalletResponse>('/wallets', req as unknown as Json);
  }

  /**
   * Cognito-auth. Returns the user's already-deployed Smart Account metadata,
   * or `null` if the user has not yet completed `POST /wallets`.
   *
   * Idempotent — safe to call at the top of every authenticated session.
   * Cheap on the backend (metadata read, no KMS decrypt).
   */
  async getWallet(): Promise<GetWalletResponse | null> {
    try {
      return await this.client.get<GetWalletResponse>('/wallets');
    } catch (err) {
      if (err instanceof NotFoundError) return null;
      throw err;
    }
  }

  /** Cognito-auth. Returns F2 re-encrypted with a per-request session key. */
  getFragment2(req: GetFragment2Request): Promise<GetFragment2Response> {
    return this.client.post<GetFragment2Response>('/fragments/2', req as unknown as Json);
  }

  /** Cognito-auth. Starts a KYC verification with Etherfuse. */
  kycStart(): Promise<KycStartResponse> {
    return this.client.post<KycStartResponse>('/kyc');
  }

  /** Cognito-auth. Reads the current user's KYC status. */
  kycStatus(): Promise<KycStartResponse> {
    return this.client.get<KycStartResponse>('/kyc');
  }

  /** Cognito-auth. Quote or submit an MXN→USDC onramp order. */
  onramp(req: OrderRequest): Promise<OrderResponse> {
    return this.client.post<OrderResponse>('/onramp', req as unknown as Json);
  }

  /** Cognito-auth. Quote or submit a USDC→MXN offramp order. */
  offramp(req: OrderRequest): Promise<OrderResponse> {
    return this.client.post<OrderResponse>('/offramp', req as unknown as Json);
  }
}
