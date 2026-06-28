/**
 * Typed wrappers for the Accesly backend REST endpoints. One method per
 * route in `CloudServices-accesly/docs/openapi.yaml`.
 *
 * Each wrapper is a one-liner over `AccesslyApiClient` — the value is the
 * typed signature, which makes auto-complete + refactors safe.
 */

import type {
  AddTrustlineGSimulateRequest,
  AddTrustlineGSimulateResponse,
  AddTrustlineGSubmitRequest,
  AddTrustlineGSubmitResponse,
  CreateWalletRequest,
  CreateWalletResponse,
  FinalizeRecoveryRequest,
  FinalizeRecoveryResponse,
  GetFragment2Request,
  GetFragment2Response,
  GetFragment3Response,
  GetWalletResponse,
  HealthResponse,
  KycStartResponse,
  OrderRequest,
  OrderResponse,
  RegisterBankAccountRequest,
  RegisterBankAccountResponse,
  RecoveryOtpRequestInput,
  RecoveryOtpRequestResponse,
  RecoveryOtpVerifyInput,
  RecoveryOtpVerifyResponse,
  SimulateRotateSignerRequest,
  SimulateRotateSignerResponse,
  ActivateAssetSimulateRequest,
  BootstrapGSimulateResponse,
  BootstrapGSubmitRequest,
  BootstrapGSubmitResponse,
  SweepGSimulateResponse,
  SweepGSubmitRequest,
  SweepGSubmitResponse,
  SimulateSwapRequest,
  SimulateSwapResponse,
  SimulateSwapSdexResponse,
  SubmitSwapSdexRequest,
  SubmitSwapSdexResponse,
  FinalizeSwapSdexRequest,
  FinalizeSwapSdexResponse,
  SimulateTxRequest,
  SimulateTxResponse,
  SubmitTxRequest,
  SubmitTxResponse,
  WalletActivityResponse,
  WalletBalanceResponse,
  WalletHistoryRequestOptions,
  WalletHistoryResponse,
  WalletUpgradeSimulateRequest,
  WalletUpgradeSimulateResponse,
  WalletUpgradeSubmitRequest,
  WalletUpgradeSubmitResponse,
} from '../types/api.js';
import type { AppConfigResponse } from '../types/app-config.js';
import { NotFoundError } from './errors.js';
import type { AccesslyApiClient, Json } from './client.js';

export class AccesslyEndpoints {
  constructor(private readonly client: AccesslyApiClient) {}

  /** Public liveness check. No auth header sent. */
  health(): Promise<HealthResponse> {
    return this.client.get<HealthResponse>('/health');
  }

  /**
   * Public (no auth). Fetches the appConfig that the developer authored from
   * the `dev.accesly.xyz` dashboard. Cacheable 60s edge — the SDK reads this
   * at boot to pick supported trustlines, branding, auth providers and
   * policies.
   */
  appConfig(appId: string): Promise<AppConfigResponse> {
    return this.client.get<AppConfigResponse>(`/app-config/${encodeURIComponent(appId)}`);
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

  /**
   * Cognito-auth. Simula `XLM_SAC.transfer(from=smartAccount, to, amount)` y
   * devuelve los datos para que el SDK firme la auth entry client-side. NO
   * mueve fondos — solo prepara el material para `submitTx`.
   */
  simulateTx(req: SimulateTxRequest): Promise<SimulateTxResponse> {
    return this.client.post<SimulateTxResponse>('/tx/simulate', req as unknown as Json);
  }

  /**
   * Cognito-auth. Recibe la `SorobanAuthorizationEntry` firmada por el SDK +
   * el envelope que `simulateTx` devolvió. El backend re-simula con la firma
   * real, KMS-firma el envelope con `channels-fund` (developer-pays) y envía
   * a Soroban RPC. Devuelve el `txHash` para que la UI pueda mostrar el
   * resultado / link a explorer.
   */
  submitTx(req: SubmitTxRequest): Promise<SubmitTxResponse> {
    return this.client.post<SubmitTxResponse>('/tx/submit', req as unknown as Json);
  }

  /**
   * Cognito-auth. Simula `smart_account.add_context_rule(...)` para activar un
   * nuevo asset (e.g. USDC) en una wallet ya deployada. Caso típico: wallets
   * pre-1.4 que vienen con rule 0 = XLM solo y necesitan agregar rule N+1
   * para USDC sin re-deployar.
   *
   * Response shape idéntico a `simulateTx` — el SDK firma el `auth_digest` con
   * el mismo passkey contra la regla admin-cfg.
   */
  activateAssetSimulate(req: ActivateAssetSimulateRequest): Promise<SimulateTxResponse> {
    return this.client.post<SimulateTxResponse>(
      '/tx/activate-asset/simulate',
      req as unknown as Json,
    );
  }

  /**
   * Cognito-auth (Fase I, 1.10+). Simula el bootstrap on-chain de la G-address
   * bridge. Backend deriva la G, chequea si ya existe + tiene trustline USDC.
   * Si no, arma una tx classic con 4 ops sponsored por channels-fund. El SDK
   * firma con la seed reconstruida y submitea via `bootstrapGSubmit`.
   */
  bootstrapGSimulate(): Promise<BootstrapGSimulateResponse> {
    return this.client.post<BootstrapGSimulateResponse>('/wallets/bootstrap-g/simulate', {});
  }

  /** Cognito-auth (Fase I). Submit del bootstrap firmado. */
  bootstrapGSubmit(req: BootstrapGSubmitRequest): Promise<BootstrapGSubmitResponse> {
    return this.client.post<BootstrapGSubmitResponse>(
      '/wallets/bootstrap-g/submit',
      req as unknown as Json,
    );
  }

  /**
   * Cognito-auth (Fase 2, v1.16+). Sponsor a ChangeTrust(asset) on the
   * user's already-bootstrapped G-address. Backend validates the asset
   * against the TRUSTLINE_ALLOWLIST (USDC + EURC only).
   */
  addTrustlineGSimulate(req: AddTrustlineGSimulateRequest): Promise<AddTrustlineGSimulateResponse> {
    return this.client.post<AddTrustlineGSimulateResponse>(
      '/trustlines/g/add/simulate',
      req as unknown as Json,
    );
  }

  /** Cognito-auth (Fase 2). Submit del add-trustline firmado por el user. */
  addTrustlineGSubmit(req: AddTrustlineGSubmitRequest): Promise<AddTrustlineGSubmitResponse> {
    return this.client.post<AddTrustlineGSubmitResponse>(
      '/trustlines/g/add/submit',
      req as unknown as Json,
    );
  }

  /**
   * Cognito-auth (Fase III, 1.11+). Chequea balance USDC en la G del user. Si
   * hay, devuelve tx Soroban `USDC_SAC.transfer(G→SA)` sin firmar. El SDK
   * firma con la seed reconstruida y submitea via `sweepGSubmit`.
   */
  sweepGSimulate(): Promise<SweepGSimulateResponse> {
    return this.client.post<SweepGSimulateResponse>('/wallets/sweep-g/simulate', {});
  }

  /** Cognito-auth (Fase III). Submit del sweep firmado. */
  sweepGSubmit(req: SweepGSubmitRequest): Promise<SweepGSubmitResponse> {
    return this.client.post<SweepGSubmitResponse>(
      '/wallets/sweep-g/submit',
      req as unknown as Json,
    );
  }

  /** Cognito-auth. Submit del add_context_rule firmado (mismo shape que submitTx). */
  activateAssetSubmit(req: SubmitTxRequest): Promise<SubmitTxResponse> {
    return this.client.post<SubmitTxResponse>('/tx/activate-asset/submit', req as unknown as Json);
  }

  /**
   * Cognito-auth (Fase O backend, 2026-06-24). Simula
   * `smart_account.upgrade(wasm_hash, operator)` con el WASM hash resuelto
   * desde DDB `contract-versions[targetVersion]`. El SDK firma la auth entry
   * con admin-cfg.
   *
   * Errores típicos:
   *  - 404 `unknown-target-version` si `targetVersion` no está registrada.
   *  - 409 `version-not-deployable` si el status es deprecated/rolled-back.
   *  - 502 `wasm-not-on-chain` si la entry DDB miente vs el ledger.
   */
  walletUpgradeSimulate(req: WalletUpgradeSimulateRequest): Promise<WalletUpgradeSimulateResponse> {
    return this.client.post<WalletUpgradeSimulateResponse>(
      '/wallets/upgrade/simulate',
      req as unknown as Json,
    );
  }

  /**
   * Cognito-auth. Submit del upgrade firmado. Backend KMS-firma el envelope
   * con channels-fund y actualiza `user_fragments.contractVersion` post-éxito
   * (con `previousContractVersion` para rollback). Idempotency-Key dedup 24h.
   */
  walletUpgradeSubmit(req: WalletUpgradeSubmitRequest): Promise<WalletUpgradeSubmitResponse> {
    return this.client.post<WalletUpgradeSubmitResponse>(
      '/wallets/upgrade/submit',
      req as unknown as Json,
    );
  }

  /**
   * Cognito-auth. Cotiza un swap XLM↔USDC via Soroswap Aggregator y devuelve
   * el material para que el SDK firme la auth entry contra la regla
   * biometric-tx del asset de entrada.
   */
  swapSimulate(req: SimulateSwapRequest): Promise<SimulateSwapResponse> {
    return this.client.post<SimulateSwapResponse>('/tx/swap/simulate', req as unknown as Json);
  }

  /** Cognito-auth. Submit del swap firmado (mismo shape que submitTx). */
  swapSubmit(req: SubmitTxRequest): Promise<SubmitTxResponse> {
    return this.client.post<SubmitTxResponse>('/tx/swap/submit', req as unknown as Json);
  }

  /**
   * Cognito-auth (Fase H, 1.9+). Fallback de `swapSimulate` que va contra SDEX
   * classic con una G-account helper. Mismo input shape, response trae
   * `helperAddress` + `quote.destMinStroops` que el SDK debe re-enviar al
   * submit.
   */
  swapSdexSimulate(req: SimulateSwapRequest): Promise<SimulateSwapSdexResponse> {
    return this.client.post<SimulateSwapSdexResponse>(
      '/tx/swap-sdex/simulate',
      req as unknown as Json,
    );
  }

  /**
   * Cognito-auth (Fase H, 1.9+). Submit del swap SDEX firmado. El backend
   * orquesta tx1 (SDK auth) → tx2 (PathPayment helper KMS) → tx3 (helper→SA
   * KMS). Devuelve los 3 hashes para auditoría / explorer linking.
   */
  swapSdexSubmit(req: SubmitSwapSdexRequest): Promise<SubmitSwapSdexResponse> {
    return this.client.post<SubmitSwapSdexResponse>('/tx/swap-sdex/submit', req as unknown as Json);
  }

  /**
   * Cognito-auth (Fase IV.b, 1.13+). Finalize del swap SDEX paso 3 — backend
   * ejecuta tx3 (G→SA) fee-bumped por channels-fund.
   */
  swapSdexFinalize(req: FinalizeSwapSdexRequest): Promise<FinalizeSwapSdexResponse> {
    return this.client.post<FinalizeSwapSdexResponse>(
      '/tx/swap-sdex/finalize',
      req as unknown as Json,
    );
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

  /**
   * Cognito-auth. Registra una CLABE mexicana en el customer Etherfuse del
   * usuario. Requiere KYC pre-existente. Devuelve un `bankAccountId` que se
   * usa después en `offramp({ bankAccountId, ... })`.
   */
  registerBankAccount(req: RegisterBankAccountRequest): Promise<RegisterBankAccountResponse> {
    return this.client.post<RegisterBankAccountResponse>(
      '/kyc/bank-accounts',
      req as unknown as Json,
    );
  }

  /* ── v1.1.0: read-only wallet data ─────────────────────────────────────── */

  /**
   * Anónimo. Balance XLM del Smart Account (vía Soroban RPC, cached ~5s).
   * No requiere JWT — la address en sí es pública on-chain.
   */
  walletBalance(address: string): Promise<WalletBalanceResponse> {
    return this.client.get<WalletBalanceResponse>(
      `/wallets/${encodeURIComponent(address)}/balance`,
    );
  }

  /**
   * Anónimo. Últimos eventos on-chain del Smart Account (rotate_signer,
   * transfers, etc.). Cacheado ~15s. `limit` default 20, max 50.
   */
  walletActivity(address: string, limit?: number): Promise<WalletActivityResponse> {
    const qs = limit !== undefined ? `?limit=${encodeURIComponent(String(limit))}` : '';
    return this.client.get<WalletActivityResponse>(
      `/wallets/${encodeURIComponent(address)}/activity${qs}`,
    );
  }

  /**
   * Anónimo. Historial completo del wallet — pre-decodificado server-side desde
   * Stellar Expert (que en browser está bloqueado por CORS). Devuelve items
   * tipados: `wallet-created`, `signer-rotated`, `transfer-in`, `transfer-out`.
   *
   * Cursor-based: pasa `saCursor` y/o `txCursor` para paginar atrás. El primer
   * fetch (sin cursors) incluye un evento sintético `wallet-created` desde la
   * metadata del contrato.
   */
  walletHistory(
    address: string,
    opts: WalletHistoryRequestOptions = {},
  ): Promise<WalletHistoryResponse> {
    const params = new URLSearchParams();
    if (opts.smartAccountCursor) params.set('saCursor', opts.smartAccountCursor);
    if (opts.transfersCursor) params.set('txCursor', opts.transfersCursor);
    if (opts.transferScanLimit !== undefined) {
      params.set('scanLimit', String(opts.transferScanLimit));
    }
    const qs = params.toString();
    return this.client.get<WalletHistoryResponse>(
      `/wallets/${encodeURIComponent(address)}/history${qs ? '?' + qs : ''}`,
    );
  }

  /* ── Recovery v2 (Fase 1, 2026-06-15) ──────────────────────────────────── */

  /**
   * Anónimo. Pide al backend que mande un OTP de 6 dígitos al email.
   *
   * Rate-limited: el backend rechaza con 429 si pediste otro hace menos de
   * 60s o más de 3 en la última hora. Anti-enumeración: la respuesta es 200
   * OK aunque el email no exista.
   */
  requestRecoveryOtp(input: RecoveryOtpRequestInput): Promise<RecoveryOtpRequestResponse> {
    return this.client.post<RecoveryOtpRequestResponse>(
      '/recovery/otp/request',
      input as unknown as Json,
    );
  }

  /**
   * Anónimo. Verifica el OTP. Si OK, devuelve un `recoveryJwt` que
   * autoriza los dos endpoints siguientes (`getFragment3`,
   * `finalizeRecovery`) durante 5 min.
   */
  verifyRecoveryOtp(input: RecoveryOtpVerifyInput): Promise<RecoveryOtpVerifyResponse> {
    return this.client.post<RecoveryOtpVerifyResponse>(
      '/recovery/otp/verify',
      input as unknown as Json,
    );
  }

  /**
   * Anónimo + header `X-Recovery-Jwt`. Devuelve `{fragmentF3Encrypted,
   * recoverySalt}`. El SDK descifra F3 con la `recoveryKey` derivada
   * client-side (PBKDF2(password, recoverySalt, 600k)).
   */
  getFragment3(recoveryJwt: string): Promise<GetFragment3Response> {
    return this.client.get<GetFragment3Response>('/fragments/3', {
      headers: { 'X-Recovery-Jwt': recoveryJwt },
    });
  }

  /**
   * Anónimo + header `X-Recovery-Jwt`. El backend arma + simula la tx
   * `rotate_signer(newOwner, newSecp256r1, newEmailCommit)` contra el Smart
   * Account del usuario y devuelve el material que el SDK necesita para
   * firmar la `SorobanAuthorizationEntry` con la seed VIEJA (reconstruida
   * por Shamir(F2_recovery, F3)) contra la regla `admin-cfg`.
   */
  simulateRotateSigner(
    recoveryJwt: string,
    payload: SimulateRotateSignerRequest,
  ): Promise<SimulateRotateSignerResponse> {
    return this.client.post<SimulateRotateSignerResponse>(
      '/recovery/simulate-rotate-signer',
      payload as unknown as Json,
      {
        headers: { 'X-Recovery-Jwt': recoveryJwt },
      },
    );
  }

  /**
   * Anónimo + header `X-Recovery-Jwt`. Submitea la tx `rotate_signer` firmada
   * por el SDK con la seed reconstruida (F2+F3) y persiste las nuevas
   * F1'/F2'/F3' en DDB. Idempotente del lado backend.
   */
  finalizeRecovery(
    recoveryJwt: string,
    payload: FinalizeRecoveryRequest,
  ): Promise<FinalizeRecoveryResponse> {
    return this.client.post<FinalizeRecoveryResponse>(
      '/recovery/finalize',
      payload as unknown as Json,
      {
        headers: { 'X-Recovery-Jwt': recoveryJwt },
      },
    );
  }
}
