/**
 * `useAccesly()` — single hook with namespaces:
 *   - auth   — signUp / confirmSignUp / signIn / signOut / status
 *   - wallet — createWallet, getStoredWallet
 *   - tx     — sendPayment, signRawXdr
 *   - kyc    — start, status
 *
 * The hook returns stable references when the underlying SDK instances don't
 * change. Each namespace is built lazily (memoised) so apps that only use
 * `auth` don't bring `wallet` into their render.
 */

import { useContext, useMemo } from 'react';
import {
  computeSmartAccountAddress,
  createWallet as coreCreateWallet,
  decryptAesGcm,
  deriveRecoveryKey,
  emailHashBytes,
  encryptAesGcm,
  generateRecoverySalt,
  generateX25519Keypair,
  getRandomBytes,
  hkdfSha256,
  normalizeSecp256r1Pubkey,
  reconstructFromPlainAndEncrypted,
  reconstructKey,
  registerPasskey,
  sha256,
  signSorobanAuthEntry,
  signTransaction as coreSignTransaction,
  unlockPasskey,
  unwrapSessionFragment2,
  zeroize,
  type ActivatableAsset,
  type AuthStatus,
  type CredentialRecord,
  type EncryptedEnvelope,
  type OrderResponse,
  type RegisterBankAccountRequest,
  type RegisterBankAccountResponse,
  type TransferAsset,
} from '@accesly/core';
import { AcceslyContext, type AcceslyContextValue } from '../context.js';
import { ENVIRONMENT_DEFAULTS } from '../config.js';

// Recovery (ZK email) se removió en 1.0.0-pre.0 (2026-06-15). El nuevo modelo
// OTP-email + password de Cognito se introduce en 1.0.0 como un namespace
// `recovery` en este mismo hook. Ver docs/Plan_Final_v1.md §5.

export interface AuthNamespace {
  readonly status: AuthStatus;
  readonly username: string | null;
  signUp(email: string, password: string): Promise<{ userSub: string; userConfirmed: boolean }>;
  confirmSignUp(email: string, code: string): Promise<void>;
  resendConfirmation(email: string): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

export interface CreateWalletInput {
  readonly email: string;
  readonly emailSalt: Uint8Array;
  readonly encryptionKeys: readonly [Uint8Array, Uint8Array, Uint8Array];
  readonly secp256r1Pubkey: Uint8Array;
  /**
   * Optional. When provided together with `prfSalt`, the SDK persists a
   * `CredentialRecord` to the configured `DeviceStore` BEFORE calling
   * `POST /wallets`. That way, if the network request fails (timeout, tab
   * close, etc.) the encrypted F1 shard + passkey metadata survive locally
   * and the wallet can be recovered via `wallet.ensureWallet` on the next
   * session (the backend dedupes by Cognito user → returns the same
   * walletAddress).
   *
   * Pass it. Omitting it means an orphaned wallet on POST failure is
   * unrecoverable without a server-side query.
   */
  readonly credentialId?: Uint8Array;
  /** Optional. See `credentialId`. */
  readonly prfSalt?: Uint8Array;
  /**
   * Password de Cognito en plano (`Uint8Array` codificado UTF-8).
   *
   * Recovery v2 (Fase 1, 2026-06-15): si se provee, el SDK deriva
   * `recoveryKey = PBKDF2(password, recoverySalt, 600k)` y la usa para
   * cifrar F3 antes de enviarlo al backend, en vez de usar
   * `encryptionKeys[2]`. El backend almacena F3 cifrado con esa key —
   * SOLO descifrable client-side con el mismo password.
   *
   * Sin esta prop el wallet se crea pero NO podrá recuperarse vía OTP
   * (F3 quedará cifrado con `encryptionKeys[2]`, igual que en 0.x).
   *
   * El caller es responsable de zeroizar este buffer tras `createWallet`
   * (el SDK no lo retiene en memoria).
   */
  readonly cognitoPassword?: Uint8Array;
  /**
   * 32-byte salt para HKDF — si se persiste en el `CredentialRecord`,
   * `wallet.unlockForSigning` lo recupera y re-deriva las mismas keys sin
   * intervención del caller. Si se omite, el SDK genera uno random y lo
   * persiste igualmente. Si la wallet ya existe en el `DeviceStore` con un
   * `encryptionSalt`, este input se ignora a favor del salt persistido (para
   * preservar la decriptabilidad de F1).
   */
  readonly encryptionSalt?: Uint8Array;
}

export interface CreatedWalletInfo {
  readonly walletAddress: string;
  readonly publicKey: Uint8Array;
  /**
   * `'on-chain'` if the backend confirmed deploy; `'pending-deploy'` if the
   * backend submitted to Soroban but the contract did not land (typically
   * because the Smart Account constructor exceeds Soroban v26 resource caps
   * — Phase 1 territory). When pending, the `walletAddress` is the
   * client-side-predicted address: same address that will be live once the
   * deploy succeeds (idempotent on the backend).
   */
  readonly status: WalletStatus;
  /** When `status === 'pending-deploy'`, the backend's reason if available. */
  readonly pendingReason?: string;
}

import { isSorobanDeployPendingError } from './sorobanDeployStatus.js';
export { isSorobanDeployPendingError } from './sorobanDeployStatus.js';

export type WalletStatus =
  /** Backend confirmed the contract is live on Soroban. Ready to use. */
  | 'on-chain'
  /**
   * Wallet record exists (locally and/or on backend) but the contract has NOT
   * been observed on Soroban yet. Either deploy is still in flight, or
   * landed in a ghost state. Re-run `wallet.ensureWallet` later (or call
   * `wallet.retryDeploy(username)`).
   */
  | 'pending-deploy'
  /**
   * Backend has the record but its Soroban RPC check did not respond — the
   * SDK treats the address as usable but flags the uncertainty.
   */
  | 'unknown';

export interface EnsureWalletResult {
  readonly walletAddress: string;
  readonly status: WalletStatus;
  /** True if this call generated a new keypair (first-time deploy path). */
  readonly createdNow: boolean;
  /** Present only when `createdNow === true`. */
  readonly publicKey?: Uint8Array;
}

export interface RemoteWalletInfo {
  readonly walletAddress: string;
  readonly appId: string;
  readonly createdAt: string;
  readonly onChain: boolean | null;
}

export interface RetryDeployResult {
  readonly walletAddress: string;
  readonly status: WalletStatus;
}

/**
 * Input para `wallet.bootstrap(...)` — el high-level "todo en uno" que cualquier
 * integrador típico va a llamar como entry point. Hace **TODO**:
 *
 *   1. `sha256(email)` → userId opaco para el RP.
 *   2. Genera `prfSalt` aleatorio (32 bytes).
 *   3. `registerPasskey(...)` con extensión PRF — pide huella/face/Hello.
 *   4. Genera `encryptionSalt` aleatorio (32 bytes).
 *   5. HKDF(prfOutput, encryptionSalt, "accesly-{f1,f2,f3}-encryption") → 3 keys AES.
 *   6. Genera `emailSalt` aleatorio (32 bytes).
 *   7. `wallet.ensureWallet(...)` — el flujo idempotente get-or-create.
 *   8. Persiste `encryptionSalt` en `CredentialRecord` para que `unlockForSigning`
 *      pueda re-derivar las mismas keys.
 *   9. Zeroiza `prfOutput`, `f1Key`, `f2Key`, `f3Key`, `cognitoPasswordBytes`.
 *
 * Después de `bootstrap`, llamá `tx.send(...)` directamente con
 * `wallet.unlockForSigning(email)` — no hace falta más wiring.
 */
export interface BootstrapWalletInput {
  readonly email: string;
  /**
   * Password de Cognito en plano. Usado para:
   *  - Re-cifrar F3 (y F2_recovery) con `recoveryKey = PBKDF2(password,
   *    recoverySalt, 600k)` para el flujo de Recovery v2.
   *
   * El SDK lo zeroiza tras el ensureWallet.
   */
  readonly password: string;
  /**
   * Overrides opcionales para el `registerPasskey` interno. Caso típico:
   * cambiar `rpName: 'MiApp'` para que el browser muestre tu marca en el
   * prompt biométrico. `rpId` por default = `window.location.hostname`.
   */
  readonly passkey?: {
    readonly rpId?: string;
    readonly rpName?: string;
  };
}

/**
 * Material reconstruido por `wallet.unlockForSigning(...)` y listo para pasar
 * a `tx.send(...)`. Las llaves se zeroizan tras la firma; el caller no debería
 * retenerlas más allá del round-trip.
 */
export interface UnlockedSigningMaterial {
  /** F1 share desencriptado (Shamir-encoded blob). Lo zero-iza `tx.send`. */
  readonly fragmentF1Plain: Uint8Array;
  /** AES key con la que el SDK desencripta el envelope F2 del backend. */
  readonly fragmentF2Key: Uint8Array;
  /** Pubkey ed25519 del owner del Smart Account (32 bytes). */
  readonly ownerPubkey: Uint8Array;
  /** Address C… del Smart Account (display only). */
  readonly walletAddress: string;
}

export interface WalletNamespace {
  /**
   * **Entry-point recomendado.** Registra passkey + deriva keys + crea-o-recupera
   * wallet en una sola llamada. Sustituye al patrón histórico de
   * `ensureWalletWithPasskey` que tenía que copiar-pegar cada integrador.
   *
   * Idempotente: si ya hay wallet en el backend para este Cognito user, devuelve
   * `{createdNow: false}` sin re-registrar passkey. Si no, hace el flow completo.
   */
  bootstrap(input: BootstrapWalletInput): Promise<EnsureWalletResult>;
  /**
   * **Helper para `tx.send`.** Lee la credencial del DeviceStore, abre el
   * passkey via WebAuthn (PIN/biométrico), re-deriva las AES keys con HKDF, y
   * descifra F1 local. Devuelve los 3 materiales que `tx.send` necesita.
   *
   * Lanza con mensaje claro si:
   *  - no hay credential local (el user tiene que correr `recovery.finalize`
   *    en este device);
   *  - el passkey no devolvió PRF (browser sin soporte);
   *  - el envelope F1 falla al descifrar (corrupto / passkey distinto).
   */
  unlockForSigning(username: string): Promise<UnlockedSigningMaterial>;
  /**
   * End-to-end wallet creation:
   *  1. Generate keypair + Shamir split + encrypt fragments (client-side).
   *  2. Compute the Smart Account address client-side from the ed25519
   *     pubkey + the env-configured deployer (deterministic — matches what
   *     the backend will deploy).
   *  3. If `credentialId` + `prfSalt` were provided, persist a full
   *     `CredentialRecord` (with all 3 encrypted fragments + computed
   *     walletAddress + `onChain: null`) to the `DeviceStore` BEFORE the
   *     network call — crash-safety + retry capability in one step.
   *  4. POST /wallets with hex pubkeys + base64 fragments.
   *  5. On success, mark the record `onChain: true` (cleared by the next
   *     `ensureWallet` call which queries Soroban via the backend).
   *
   * The caller is responsible for the encryption-key derivation (typically
   * via WebAuthn PRF).
   */
  createWallet(input: CreateWalletInput): Promise<CreatedWalletInfo>;
  /**
   * Idempotent wallet bootstrap. The recommended entry-point at the top of
   * every authenticated session:
   *
   *  - `GET /wallets` → if `onChain === true`, returns `{ status: 'on-chain' }`
   *    and skips keypair generation entirely.
   *  - `GET /wallets` → if `onChain === false`, calls `retryDeploy` to
   *    re-submit the existing record (idempotent on the backend) and
   *    returns `{ status: 'pending-deploy' }` if the retry didn't surface
   *    success yet.
   *  - `GET /wallets` → if `onChain === null` (Soroban RPC unreachable),
   *    returns `{ status: 'unknown' }` — the address is usable but the
   *    SDK couldn't confirm on-chain presence.
   *  - `GET /wallets` → 404 → runs the full `createWallet` flow and returns
   *    `{ status: 'pending-deploy', createdNow: true }`. Subsequent calls
   *    will upgrade to `'on-chain'` once the backend's Soroban check passes.
   */
  ensureWallet(input: CreateWalletInput): Promise<EnsureWalletResult>;
  /**
   * Re-submits `POST /wallets` for an existing local `CredentialRecord`. Used
   * to recover from ghost wallets (record exists but deploy did not land).
   * Requires the record to have been persisted with `fragmentF2Encrypted`,
   * `fragmentF3Encrypted`, `publicKey`, and `emailCommitment` (which
   * `createWallet` does automatically when `credentialId` + `prfSalt` are
   * provided).
   *
   * Backend dedupes by ownerPubkey — the returned address is guaranteed to
   * equal the one originally stored.
   */
  retryDeploy(username: string): Promise<RetryDeployResult>;
  /**
   * Reads the user's wallet metadata from the backend. Returns null if the
   * user has not yet created a wallet.
   */
  fetchRemote(): Promise<RemoteWalletInfo | null>;
  /**
   * Computes the deterministic Smart Account address that the backend will
   * (or did) deploy for the given ed25519 owner pubkey. Same algorithm
   * Stellar Core uses — pure client-side, no network call. Useful to show
   * the address to the user instantly before any POST.
   */
  computeAddress(ownerPubkey: Uint8Array): Promise<string>;
  /** Returns the locally-stored credential record, if any. */
  getStoredCredential(username: string): Promise<CredentialRecord | null>;
  /**
   * Lists `CredentialRecord`s whose `walletAddress` is still `null` OR whose
   * `onChain` flag is `false`. Diagnostic + recovery aid.
   */
  getPendingWallets(): Promise<readonly CredentialRecord[]>;
  /** Removes a stored credential. Useful after a failed pending wallet is reconciled. */
  clearStoredCredential(username: string): Promise<void>;
  /**
   * Testnet only — fondea el Smart Account con XLM via Stellar friendbot.
   *
   * Friendbot acepta directamente direcciones de contrato Soroban (`C…`):
   * internamente arma una tx `invokeContract(XLM_SAC.transfer, ...)` desde
   * la cuenta de la SDF y la submitea. Resultado: ~10,000 XLM testnet al
   * Smart Account, sin necesidad de un G-account intermediario.
   *
   * Idempotente: el primer call exitoso marca `testnetFunded: true` en el
   * `CredentialRecord` local; subsiguientes calls devuelven `alreadyFunded:
   * true` sin hacer otro round-trip a friendbot.
   *
   * En `env: 'mainnet'` la función es un no-op (no existe friendbot en
   * mainnet) y devuelve `{ funded: false, alreadyFunded: false, reason:
   * 'mainnet-not-supported' }`. La UI tiene que mostrar opciones de onramp
   * real (Etherfuse, MoonPay, transferencia externa).
   *
   * `ensureWallet` lo llama automáticamente fire-and-forget cuando el
   * status final es `'on-chain'` — el caller solo necesita llamarlo
   * explícitamente si quiere mostrar feedback en la UI durante el funding.
   */
  fundTestnet(walletAddress: string): Promise<FundTestnetResult>;
  /**
   * **Fase C (1.5+):** activa un asset adicional (e.g. USDC) en una wallet
   * ya deployada agregando un context rule `biometric-tx` para su SAC. Caso
   * típico: wallets pre-1.4 que vinieron con rule 0 = XLM solo y necesitan
   * habilitar USDC sin re-deployar.
   *
   * El flow firma con el mismo passkey biométrico (mismo signer ed25519 que
   * autoriza transfers) pero contra la regla `admin-cfg`. Idempotente: si el
   * rule ya existe, Soroban devuelve error y este método throwea — el caller
   * puede catchear y mostrar "ya está activado".
   *
   * Tras el éxito, futuros `tx.send({ asset: 'USDC' })` desde esta wallet
   * funcionan sin tocar `wallet.activateAsset` de nuevo.
   */
  activateAsset(input: ActivateAssetInput): Promise<ActivateAssetResult>;
}

export interface ActivateAssetInput {
  /** Asset a habilitar. Hoy solo `'USDC'`. */
  readonly asset: ActivatableAsset;
  /** F1 (Shamir share) en plano — desencriptado client-side via WebAuthn PRF. */
  readonly fragmentF1Plain: Uint8Array;
  /** Llave AES-256 con la que el SDK desencripta el F2 envelope. */
  readonly fragmentF2Key: Uint8Array;
  /** Pubkey ed25519 (32 bytes) del owner del Smart Account. */
  readonly ownerPubkey: Uint8Array;
}

export interface ActivateAssetResult {
  readonly txHash: string;
  readonly status: string;
  readonly explorerUrl: string;
}

export interface FundTestnetResult {
  /** `true` si esta llamada disparó friendbot y fondeó la wallet ahora. */
  readonly funded: boolean;
  /**
   * `true` si la wallet ya había sido fondeada antes (flag local o response
   * de friendbot indicando que la cuenta ya existe). Igualmente válido —
   * la UI puede mostrar "ya tienes XLM" sin pedir acción del user.
   */
  readonly alreadyFunded: boolean;
  /** Texto explicativo para no-op cases (mainnet, missing record, etc.). */
  readonly reason?: 'mainnet-not-supported' | 'friendbot-error' | 'already-funded' | 'funded-now';
}

/**
 * Input para `tx.send(...)` — manda XLM o USDC desde el Smart Account del
 * usuario a cualquier address Stellar (G… clásico o C… contrato).
 *
 * El SDK orquesta todo el flujo: simulate → ECDH F2 → reconstruct seed →
 * sign auth entry → submit. El caller solo entrega los inputs sensibles que
 * vienen de su flow de unlock (WebAuthn PRF + derivación de F2 key).
 */
export interface SendXlmInput {
  /** Destinatario. G… (clásico) o C… (contrato). */
  readonly destinationAddress: string;
  /**
   * Monto en unidades atómicas (1e-7 para ambos XLM y USDC). Base-10 string
   * para evitar precisión. Ejemplo: `"12500000"` = 1.25 XLM o 1.25 USDC.
   */
  readonly amountStroops: string;
  /**
   * Asset a transferir. Default `'XLM'` (backwards compat con apps <1.4 que
   * no pasaban este field). Para USDC el Smart Account debe tener el rule 1
   * (USDC_SAC tx_target) activado — si no, el backend devuelve 409 y la app
   * debe disparar el flow "Activar USDC".
   */
  readonly asset?: TransferAsset;
  /**
   * F1 (Shamir share encoded incluyendo el byte de índice) ya en plano —
   * típicamente desencriptado client-side via WebAuthn PRF antes de llamar.
   * El SDK lo zero-iza tras combinar con F2.
   */
  readonly fragmentF1Plain: Uint8Array;
  /**
   * Llave AES-256 con la que el SDK desencripta el F2 envelope que vino
   * del backend. La derivación de esta llave es responsabilidad del caller
   * (usualmente PBKDF2 sobre material derivado de credenciales del user).
   * Se zero-iza al terminar.
   */
  readonly fragmentF2Key: Uint8Array;
  /**
   * Pubkey ed25519 (32 bytes) del owner del Smart Account. Se usa para:
   *   1) Sanity-check de que la seed reconstruida deriva esta pubkey.
   *   2) Empaquetarla dentro del `Signer::External(verifier, pubkey)` del
   *      AuthPayload.
   */
  readonly ownerPubkey: Uint8Array;
}

export interface SendXlmResult {
  readonly txHash: string;
  readonly status: string;
  readonly explorerUrl: string;
}

/**
 * Input para `tx.swap(...)` — cambia XLM por USDC (o viceversa) usando Soroswap
 * Aggregator. El SDK firma la auth entry del Smart Account contra la regla
 * biometric-tx del asset de entrada.
 */
export interface SwapInput {
  /** Asset de entrada. */
  readonly fromAsset: TransferAsset;
  /** Asset de salida (debe diferir de `fromAsset`). */
  readonly toAsset: TransferAsset;
  /** Stroops del input (1e-7). Ejemplo: `"125000000"` = 12.5 XLM. */
  readonly amountIn: string;
  /** Tolerancia de slippage en basis points. Default 50 (0.5%). */
  readonly slippageBps?: number;
  /** F1 (Shamir share) en plano — zeroizado tras firmar. */
  readonly fragmentF1Plain: Uint8Array;
  /** Llave AES-256 para descifrar el F2 envelope. */
  readonly fragmentF2Key: Uint8Array;
  /** Pubkey ed25519 del owner del Smart Account. */
  readonly ownerPubkey: Uint8Array;
}

export interface SwapResult {
  readonly txHash: string;
  readonly status: string;
  readonly explorerUrl: string;
  /**
   * Quote summary que cotizó Soroswap. La UI puede mostrar
   * `recibiste ${amountOut} ${toAsset}` después del success.
   */
  readonly quote: {
    readonly fromAsset: TransferAsset;
    readonly toAsset: TransferAsset;
    readonly amountIn: string;
    readonly amountOut: string;
    readonly minAmountOut: string;
    readonly priceImpactPct: string;
    readonly platform: string;
  };
}

export interface TxNamespace {
  /**
   * End-to-end XLM transfer desde el Smart Account del user.
   *
   * Flujo interno (no-custodial):
   *   1) `POST /tx/simulate` con `{ amountStroops, destinationAddress }`.
   *   2) Genera X25519 keypair efímero + `POST /fragments/2` con la pubkey.
   *      Backend devuelve F2 wrapped en una capa session-key. El SDK la
   *      descifra con ECDH + HKDF — la session key NO persiste en disco.
   *   3) Desencripta el F2 envelope interno con `fragmentF2Key` → F2 plain.
   *   4) Combina F1 + F2 vía Shamir → ed25519 seed (32 bytes).
   *   5) Computa `auth_digest = sha256(signature_payload || rule_ids_xdr)`
   *      y lo firma con la seed → 64-byte ed25519 sig.
   *   6) Empaqueta el `AuthPayload {signers, context_rule_ids}` ScVal,
   *      reemplaza `credentials.address.signature` en la placeholder entry.
   *   7) `POST /tx/submit` con `{ unsignedXdr, signedAuthEntryXdr }`.
   *   8) Devuelve `{ txHash, status, explorerUrl }`.
   *
   * Toda llave plana sale de scope tras la firma. Lanza si:
   *   - El backend rechaza simulate/submit.
   *   - La reconstrucción Shamir falla (fragmentos no compatibles).
   *   - La pubkey derivada de la seed no matchea `ownerPubkey`.
   */
  send(input: SendXlmInput): Promise<SendXlmResult>;
  /**
   * **Fase D (1.6+):** swap XLM↔USDC vía Soroswap Aggregator. El backend hace
   * el round-trip a la API de Soroswap (`/quote` + `/quote/build`), procesa el
   * XDR resultante, y devuelve el material para que el SDK firme con el
   * mismo passkey que `tx.send`.
   *
   * Auth: la auth entry del Smart Account se firma contra la regla
   * biometric-tx del `fromAsset` (rule 0 para XLM, rule 1 para USDC). Si la
   * wallet no tiene la regla del `fromAsset` (pre-1.4 sin USDC), el backend
   * devuelve 409 — el caller debe disparar `wallet.activateAsset` primero.
   *
   * Returns `txHash` + `quote` summary con `amountOut` y `priceImpactPct` para
   * que la UI muestre "Recibiste X USDC".
   */
  swap(input: SwapInput): Promise<SwapResult>;

  /**
   * Bajo nivel: firma un envelope Stellar ya construido con una seed ed25519
   * dada. Útil para flows custom que arman la tx fuera del SDK.
   */
  signRawXdr(input: {
    transactionXdr: string;
    ed25519Seed: Uint8Array;
    expectedPublicKey?: Uint8Array;
  }): Promise<{ signedXdr: string; publicKey: Uint8Array }>;
}

export interface KycNamespace {
  start(): Promise<{ customerId: string; status: string; hostedUrl: string | null }>;
  status(): Promise<{ customerId: string; status: string; hostedUrl: string | null }>;
}

/**
 * **Fase E.2+ (1.7+):** namespace high-level para operaciones MXN ⇄ USDC
 * vía Etherfuse. Envuelve los endpoints crudos `/kyc`, `/onramp`, `/offramp`,
 * `/kyc/bank-accounts` para que la app no tenga que armar `OrderRequest`
 * con `appId`/`walletAddress`/`action` cada vez — los toma del contexto.
 *
 * El integrador típicamente solo necesita estos métodos high-level. Para
 * casos avanzados (custom action shape, listado paginado, etc.) acceder a
 * `_internal.endpoints.{onramp, offramp, kycStart, ...}` directo.
 */
export interface FiatNamespace {
  /**
   * Inicia el KYC del user actual via Etherfuse hosted form. Devuelve la URL
   * presignada — la UI hace `window.open` y el user completa identidad +
   * documentos directamente en Etherfuse (Accesly nunca los ve).
   */
  startKyc(): Promise<{ customerId: string; status: string; hostedUrl: string | null }>;
  /** Status actual del KYC del user (pending/approved/rejected/not_started). */
  kycStatus(): Promise<{ customerId: string; status: string; hostedUrl: string | null }>;
  /**
   * Registra una CLABE mexicana en el customer Etherfuse del user. Requiere
   * KYC pre-existente (status='pending' o 'approved' alcanza). Devuelve el
   * `bankAccountId` que `fiat.quoteOfframp` necesita.
   */
  registerBankAccount(
    input: Omit<RegisterBankAccountRequest, never>,
  ): Promise<RegisterBankAccountResponse>;
  /**
   * Cotiza onramp MXN→USDC. La quote es válida ~60s. Devuelve `amountUsdc`
   * que el user recibe + `fxRate` aplicado.
   */
  quoteOnramp(input: { amountMxn: string }): Promise<OrderResponse>;
  /**
   * Ejecuta el onramp. El user hace una transferencia SPEI a la cuenta que
   * Etherfuse devuelve (out-of-band) y los USDC llegan al Smart Account
   * cuando el webhook `order_updated` confirma settlement.
   */
  submitOnramp(input: { quoteId: string }): Promise<OrderResponse>;
  /** Cotiza offramp USDC→MXN contra una bank account ya registrada. */
  quoteOfframp(input: {
    amountUsdc: string;
    bankAccountId: string;
  }): Promise<OrderResponse>;
  /** Ejecuta el offramp (USDC sale del SA, MXN llega a la CLABE registrada). */
  submitOfframp(input: { quoteId: string }): Promise<OrderResponse>;
}

export interface SessionNamespace {
  /** Create a temporary session key for unattended low-value tx (Soroban policy). */
  create(_opts: { readonly ttlSeconds: number; readonly maxAmountStroops: string }): Promise<never>;
  /** Revoke a previously-created session key. */
  revoke(_sessionKeyId: string): Promise<never>;
}

export interface SettingsNamespace {
  /** Add a new device's passkey to an existing wallet (multi-device). */
  addDevice(_secp256r1Pubkey: Uint8Array): Promise<never>;
  /** Remove a device's passkey from the wallet. */
  removeDevice(_secp256r1Pubkey: Uint8Array): Promise<never>;
  /** List all device passkeys registered for the wallet. */
  listDevices(): Promise<never>;
  /** Change the spending limit policy. */
  updateSpendingLimit(_opts: {
    readonly limitStroops: string;
    readonly perDayStroops?: string;
  }): Promise<never>;
}

export interface YieldNamespace {
  /** Invest USDC into CETES via Etherfuse (50/50 yield share with Accesly). */
  invest(_amountUsdc: string): Promise<never>;
  /** Redeem CETES tokens back into USDC. */
  redeem(_amountTokens: string): Promise<never>;
  /** Read the user's current yield position. */
  position(): Promise<never>;
}

/**
 * Stub thrown by every method in the `session`, `settings`, `yield`
 * namespaces. These features are designed but not implemented in v0.1.0 —
 * they unblock with the dashboard work in Fase 7 (`session`/`settings`) and
 * with Etherfuse activation (`yield`).
 */
export class NotImplementedYetError extends Error {
  constructor(namespace: string, method: string) {
    super(
      `${namespace}.${method}() is not implemented yet. This namespace ships in a later release; ` +
        'see docs/Handoff_Fase7.md for the roadmap.',
    );
    this.name = 'NotImplementedYetError';
  }
}

/**
 * Recovery v2 — OTP por email + password de Cognito (Fase 1, 2026-06-15).
 *
 * Flujo desde la UI:
 *   1. `recovery.requestOtp({ email })` → manda el OTP por SES.
 *   2. `recovery.verifyOtp({ email, code })` → devuelve `recoveryJwt`.
 *   3. `recovery.finalize({ email, password, recoveryJwt })` orquesta todo:
 *      - GET /fragments/3 con el JWT
 *      - Deriva recoveryKey con el password + recoverySalt del backend
 *      - Decifra F3
 *      - Decifra F2 (vía session key ECDH)
 *      - Combina F2+F3 → seed ed25519 reconstruida
 *      - Genera new passkey + new Shamir split (F1', F2', F3')
 *      - Re-cifra F3' con la misma recoveryKey + nuevo salt
 *      - Firma la tx `rotate_signer` localmente
 *      - POST /recovery/finalize con todo
 *      - Persiste new CredentialRecord local
 *      - Zero-iza la seed
 */
export interface ReconstructedSeed {
  /** 32-byte ed25519 seed reconstruida vía Shamir(F2_recovery + F3). CALLER ZEROIZE. */
  readonly privateSeed: Uint8Array;
  /** 32-byte ed25519 public key derivada. */
  readonly publicKey: Uint8Array;
  /** 32-byte recoveryKey derivada del password — útil para re-cifrar F2'/F3' nuevos. */
  readonly recoveryKey: Uint8Array;
  /** Base64 32-byte salt que vino del backend. */
  readonly recoverySalt: string;
}

/**
 * Input para `recovery.finalize(...)` — **orquestador end-to-end**. El integrador
 * solo provee email + password + recoveryJwt; el SDK hace TODO el resto:
 *
 *   1. `reconstructSeed(...)` con el password → seed VIEJA + recoveryKey.
 *   2. `registerPasskey(...)` con PRF → nuevo credentialId + secp256r1Pubkey + prfOutput.
 *   3. HKDF(prfOutput, encryptionSalt, "accesly-{f1,f2}-encryption") → newF1Key + newF2Key.
 *   4. Genera new ed25519 seed + Shamir 2-of-3 + cifra F1'/F2' con PRF keys, F3' con recoveryKey.
 *   5. `POST /recovery/simulate-rotate-signer` → backend arma + simula.
 *   6. Firma `SorobanAuthorizationEntry` con la SEED VIEJA contra `admin-cfg`.
 *   7. `POST /recovery/finalize` con auth entry firmada + new fragments.
 *   8. Persiste new `CredentialRecord` (con `encryptionSalt`) en `DeviceStore`.
 *   9. Zeroiza TODAS las llaves intermedias (privateSeed vieja, recoveryKey, PRF output, password).
 */
export interface FinalizeRecoveryInput {
  /** Email del usuario (case-insensitive, se normaliza). */
  readonly email: string;
  /**
   * Password de Cognito (string). El SDK lo encoda a UTF-8 internamente y lo
   * zeroiza tras la operación. No retengas referencias.
   */
  readonly password: string;
  /** Token KMS-HMAC que devolvió `verifyOtp()` — TTL 5min. */
  readonly recoveryJwt: string;
  /**
   * Overrides opcionales para el `registerPasskey` interno (mismo shape que
   * `wallet.bootstrap`). Caso típico: `rpName: 'MiApp'`.
   */
  readonly passkey?: {
    readonly rpId?: string;
    readonly rpName?: string;
  };
}

export interface FinalizeRecoveryResult {
  readonly walletAddress: string;
  readonly txHash: string;
  readonly status: string;
  /** Pubkey ed25519 NUEVA (32 bytes). Útil para UI confirmación. */
  readonly newPublicKey: Uint8Array;
  /** Link al explorer. */
  readonly explorerUrl: string;
}

export interface RecoveryNamespace {
  /** Pide OTP. Backend rate-limita; el caller debe respetar `cooldownSeconds`. */
  requestOtp(input: { email: string }): Promise<{
    cooldownSeconds: number;
    expiresInSeconds: number;
  }>;
  /** Verifica OTP. Devuelve `recoveryJwt` con TTL 5min. */
  verifyOtp(input: { email: string; code: string }): Promise<{
    recoveryJwt: string;
    expiresAt: number;
  }>;
  /**
   * Descarga `/fragments/3`, descifra F2_recovery + F3 con la `recoveryKey`
   * derivada del password y reconstruye la seed via Shamir.
   *
   * El caller DEBE zero-izar `result.privateSeed` y `result.recoveryKey`
   * tras firmar la rotación + cifrar las nuevas F1'/F2'/F3'.
   *
   * El caller también es responsable de zeroizar `cognitoPassword` después.
   */
  reconstructSeed(input: {
    cognitoPassword: Uint8Array;
    recoveryJwt: string;
  }): Promise<ReconstructedSeed>;
  /**
   * Orquestador completo de la rotación de signers para Recovery v2.
   * Ver `FinalizeRecoveryInput` para los pre-requisitos.
   */
  finalize(input: FinalizeRecoveryInput): Promise<FinalizeRecoveryResult>;
  /**
   * Bajo nivel: submitea la rotación al backend tras que el caller haya
   * armado el body manualmente. `finalize(...)` es el wrapper recomendado.
   */
  submitFinalize(input: {
    recoveryJwt: string;
    unsignedXdr: string;
    signedAuthEntryXdr: string;
    newOwnerEd25519Pubkey: string;
    newSecp256r1Pubkey: string;
    newFragmentF1Encrypted: EncryptedEnvelope;
    newFragmentF2Encrypted: EncryptedEnvelope;
    newFragmentF2Recovery: EncryptedEnvelope;
    newFragmentF3Encrypted: EncryptedEnvelope;
    newRecoverySalt: string;
    newEmailCommitment: string;
  }): Promise<{ walletAddress: string; txHash: string; status: string }>;
}

export interface AcceslyHook {
  readonly auth: AuthNamespace;
  readonly wallet: WalletNamespace;
  readonly tx: TxNamespace;
  readonly kyc: KycNamespace;
  readonly fiat: FiatNamespace;
  readonly recovery: RecoveryNamespace;
  readonly session: SessionNamespace;
  readonly settings: SettingsNamespace;
  readonly yieldOps: YieldNamespace;
  /** Raw context, for advanced use cases (custom telemetry, manual refresh). */
  readonly _internal: AcceslyContextValue;
}

export function useAccesly(): AcceslyHook {
  const ctx = useContext(AcceslyContext);
  if (!ctx) {
    throw new Error(
      'useAccesly: missing <AcceslyProvider>. Wrap your app with <AcceslyProvider appId env>.',
    );
  }

  const auth = useMemo<AuthNamespace>(
    () => ({
      status: ctx.status,
      username: ctx.username,
      async signUp(email, password) {
        return ctx.authClient.signUp(email, password);
      },
      confirmSignUp(email, code) {
        return ctx.authClient.confirmSignUp(email, code);
      },
      resendConfirmation(email) {
        return ctx.authClient.resendConfirmationCode(email);
      },
      async signIn(email, password) {
        const tokens = await ctx.authClient.signIn(email, password);
        await ctx.tokenManager.setTokens(tokens);
        await ctx.refreshStatus();
      },
      async signOut() {
        await ctx.tokenManager.signOut();
        await ctx.refreshStatus();
      },
    }),
    [ctx],
  );

  const { hexToBytes, hexFromBytes } = useMemo(() => coderHelpers(), []);

  const stellarConfig = ENVIRONMENT_DEFAULTS[ctx.env].stellar;

  const wallet = useMemo<WalletNamespace>(() => {
    // Capture the narrowed non-null context once, so the inner closures
    // don't trip TS's narrowing-through-function-declaration limitation.
    const c = ctx;

    /**
     * Sends the POST /wallets request given a fully-assembled record. Used
     * by both the first-time create flow and `retryDeploy`. Returns the
     * backend-confirmed walletAddress.
     */
    const postWallet = async (params: {
      pubkeyEd25519: Uint8Array;
      emailCommitment: Uint8Array;
      secp256r1Pubkey: Uint8Array;
      fragmentF2: EncryptedEnvelope;
      fragmentF3: EncryptedEnvelope;
      /** Recovery v2 — F2 cipher-bound a recoveryKey. */
      fragmentF2Recovery?: EncryptedEnvelope;
      /** Recovery v2 — `sha256(email)` en hex. Optional para compat. */
      emailHash?: string;
      /** Recovery v2 — base64 salt. Optional para compat. */
      recoverySalt?: string;
    }): Promise<string> => {
      const res = await c.endpoints.createWallet({
        appId: c.appId,
        pubkeyEd25519: hexFromBytes(params.pubkeyEd25519),
        emailCommitment: hexFromBytes(params.emailCommitment),
        secp256r1Pubkey: hexFromBytes(params.secp256r1Pubkey),
        fragmentF2: encodeFragmentToWire(params.fragmentF2),
        fragmentF3: encodeFragmentToWire(params.fragmentF3),
        ...(params.fragmentF2Recovery
          ? { fragmentF2Recovery: encodeFragmentToWire(params.fragmentF2Recovery) }
          : {}),
        ...(params.emailHash ? { emailHash: params.emailHash } : {}),
        ...(params.recoverySalt ? { recoverySalt: params.recoverySalt } : {}),
      });
      return res.walletAddress;
    };

    const statusFromOnChain = (onChain: boolean | null): WalletStatus => {
      if (onChain === true) return 'on-chain';
      if (onChain === false) return 'pending-deploy';
      return 'unknown';
    };

    /**
     * Testnet auto-funding implementation. Hits Stellar friendbot with the
     * Smart Account contract address — la SDF lo soporta directamente post
     * Soroban (internamente arma una invokeContract XLM_SAC.transfer desde
     * la cuenta de friendbot al contrato). Resultado: ~10,000 XLM testnet
     * acreditados al Smart Account.
     *
     * No-op si `env !== 'testnet'`. Idempotente via flag local — solo hace
     * el round-trip a friendbot la primera vez.
     */
    // Detect testnet via the network passphrase rather than `env` — `env` is
    // a deploy stage (`dev` | `staging` | `prod`), not a chain selector.
    // Pre-mainnet, both `dev` and `staging` point to Stellar testnet; only
    // `prod` flips to the public mainnet passphrase.
    const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
    const isTestnet = stellarConfig.networkPassphrase === TESTNET_PASSPHRASE;

    const fundTestnetIfNeeded = async (
      walletAddress: string,
      username: string | null,
      opts?: { readonly retries?: number; readonly retryDelayMs?: number },
    ): Promise<FundTestnetResult> => {
      if (!isTestnet) {
        return { funded: false, alreadyFunded: false, reason: 'mainnet-not-supported' };
      }

      // Check local idempotency flag
      const existing = username ? await c.deviceStore.loadCredential(username) : null;
      if (existing?.testnetFunded) {
        return { funded: false, alreadyFunded: true, reason: 'already-funded' };
      }

      // Retries: caller path (auto-fund post-create) pasa varios porque hay
      // una race entre POST /wallets OK y el contrato apareciendo on-chain
      // — friendbot necesita el C-address vivo para invocar XLM_SAC.transfer.
      // Manual button: 0 retries (mismo comportamiento de antes).
      const retries = opts?.retries ?? 0;
      const retryDelayMs = opts?.retryDelayMs ?? 5000;

      const url = `https://friendbot.stellar.org?addr=${encodeURIComponent(walletAddress)}`;
      let funded = false;
      let alreadyFunded = false;

      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const res = await fetch(url);
          if (res.ok) {
            funded = true;
            break;
          }
          if (res.status === 400) {
            // Friendbot 400 puede ser "ya fondeada" (éxito idempotente) o
            // "contrato no existe aún" (retry). El body trae el detalle.
            const body = await res.text().catch(() => '');
            const alreadyExists =
              /already|exist|funded/i.test(body) && !/destination|account.*not/i.test(body);
            if (alreadyExists) {
              alreadyFunded = true;
              break;
            }
            // Contract probably not yet on-chain — retry if possible.
            if (attempt < retries) {
              await new Promise((r) => setTimeout(r, retryDelayMs));
              continue;
            }
            return { funded: false, alreadyFunded: false, reason: 'friendbot-error' };
          }
          // Other status — retry if possible.
          if (attempt < retries) {
            await new Promise((r) => setTimeout(r, retryDelayMs));
            continue;
          }
          return { funded: false, alreadyFunded: false, reason: 'friendbot-error' };
        } catch {
          if (attempt < retries) {
            await new Promise((r) => setTimeout(r, retryDelayMs));
            continue;
          }
          return { funded: false, alreadyFunded: false, reason: 'friendbot-error' };
        }
      }

      // Persist the flag so we don't hit friendbot again on subsequent
      // ensureWallet calls. If there's no existing credential record
      // (different device, fresh browser), nothing to update — the next
      // session might try again, which is OK (friendbot will 400 with
      // "already funded" and we treat that as success).
      if (existing) {
        await c.deviceStore.saveCredential({ ...existing, testnetFunded: true });
      }

      return {
        funded,
        alreadyFunded,
        reason: funded ? 'funded-now' : 'already-funded',
      };
    };

    return {
      async computeAddress(ownerPubkey) {
        return computeSmartAccountAddress({
          ownerPubkey,
          deployerAddress: stellarConfig.deployerAddress,
          networkPassphrase: stellarConfig.networkPassphrase,
        });
      },

      async createWallet(input) {
        // Defense in depth: coerce the passkey pubkey to the canonical
        // 65-byte 0x04-prefixed form. The backend validator rejects anything
        // else with "secp256r1Pubkey must be hex 65 bytes (uncompressed)".
        const secp256r1Canonical = normalizeSecp256r1Pubkey(input.secp256r1Pubkey);
        const created = coreCreateWallet({
          emailBytes: new TextEncoder().encode(input.email),
          emailSalt: input.emailSalt,
          encryptionKeys: input.encryptionKeys,
        });

        // Recovery v2: si el caller pasó `cognitoPassword`, generamos un
        // recoverySalt y re-ciframos F2 + F3 con `recoveryKey =
        // PBKDF2(password, recoverySalt, 600k)`. Necesitamos AMBOS porque
        // Shamir 2-de-3 exige DOS shares para reconstruir el seed durante
        // recovery (F1 está perdido cuando el device se pierde).
        //
        // Esa key vive SOLO en cliente — el backend recibe `{F2_recovery,
        // F3, recoverySalt}` y nunca puede descifrar sin el password.
        let fragmentF3ToSend = created.encryptedFragments[2];
        let fragmentF2Recovery: EncryptedEnvelope | undefined;
        let recoverySaltBase64: string | undefined;
        if (input.cognitoPassword) {
          const recoverySalt = generateRecoverySalt();
          const f2Plain = decryptAesGcm(created.encryptedFragments[1], input.encryptionKeys[1]);
          const f3Plain = decryptAesGcm(created.encryptedFragments[2], input.encryptionKeys[2]);
          const recoveryKey = deriveRecoveryKey({
            password: input.cognitoPassword,
            salt: recoverySalt,
          });
          try {
            fragmentF2Recovery = encryptAesGcm(f2Plain, recoveryKey);
            fragmentF3ToSend = encryptAesGcm(f3Plain, recoveryKey);
          } finally {
            // No leak: zeroize la key + plaintexts.
            for (let i = 0; i < recoveryKey.length; i += 1) recoveryKey[i] = 0;
            for (let i = 0; i < f2Plain.length; i += 1) f2Plain[i] = 0;
            for (let i = 0; i < f3Plain.length; i += 1) f3Plain[i] = 0;
          }
          recoverySaltBase64 = base64FromBytes(recoverySalt);
        }

        // emailHash = sha256(email.toLowerCase().trim()) en hex. El backend
        // lo indexa en el GSI by-email-hash para resolver Recovery v2.
        const emailHashHex = hexFromBytes(emailHashBytes(input.email));

        // Pre-compute the deterministic walletAddress.
        const predictedAddress = await computeSmartAccountAddress({
          ownerPubkey: created.publicKey,
          deployerAddress: stellarConfig.deployerAddress,
          networkPassphrase: stellarConfig.networkPassphrase,
        });

        // Crash-safety: persist el record con F3 cifrado en su forma
        // recoverable (la que se envía al backend). Si el caller no provee
        // password, mantenemos el F3 viejo (compat).
        const canPersist = Boolean(input.credentialId && input.prfSalt);
        if (canPersist) {
          await ctx.deviceStore.saveCredential({
            username: input.email,
            credentialId: input.credentialId!,
            secp256r1Pubkey: secp256r1Canonical,
            fragmentF1Encrypted: created.encryptedFragments[0],
            fragmentF2Encrypted: created.encryptedFragments[1],
            fragmentF3Encrypted: fragmentF3ToSend,
            publicKey: created.publicKey,
            emailCommitment: created.emailCommitment,
            prfSalt: input.prfSalt!,
            fallbackKeyMaterial: new Uint8Array(0),
            walletAddress: predictedAddress,
            onChain: null,
            createdAt: Date.now(),
            ...(input.encryptionSalt ? { encryptionSalt: input.encryptionSalt } : {}),
          });
        }

        let confirmedAddress: string;
        let deployStatus: WalletStatus = 'unknown';
        let pendingReason: string | undefined;

        try {
          confirmedAddress = await postWallet({
            pubkeyEd25519: created.publicKey,
            emailCommitment: created.emailCommitment,
            secp256r1Pubkey: secp256r1Canonical,
            fragmentF2: created.encryptedFragments[1],
            fragmentF3: fragmentF3ToSend,
            emailHash: emailHashHex,
            ...(fragmentF2Recovery ? { fragmentF2Recovery } : {}),
            ...(recoverySaltBase64 ? { recoverySalt: recoverySaltBase64 } : {}),
          });
          // POST succeeded — leave status as 'unknown'; the next
          // ensureWallet GET will upgrade it to 'on-chain' once Soroban
          // confirms the deploy.
        } catch (err) {
          if (!isSorobanDeployPendingError(err)) throw err;
          // Soroban rejected the deploy (constructor too big, footprint
          // exceeded, etc). Treat as deferrable — the local record is
          // already persisted with the predicted address; the backend also
          // has the record by design. `wallet.retryDeploy` will land it
          // later once the contracts team slims the constructor.
          confirmedAddress = predictedAddress;
          deployStatus = 'pending-deploy';
          pendingReason = err instanceof Error ? err.message : String(err);
          console.warn(
            '[accesly] wallet deploy is pending — predicted address persisted, retry once Phase 1 destrabes the constructor',
            pendingReason,
          );
        }

        // Sanity check — predicted vs confirmed should always match. If not,
        // either the deployer address in env is wrong or the algorithm
        // drifted; either way the app should know about it.
        if (confirmedAddress !== predictedAddress) {
          console.warn('[accesly] computed walletAddress does not match backend response', {
            predicted: predictedAddress,
            confirmed: confirmedAddress,
          });
        }

        if (canPersist) {
          const existing = await ctx.deviceStore.loadCredential(input.email);
          if (existing) {
            await ctx.deviceStore.saveCredential({
              ...existing,
              walletAddress: confirmedAddress,
              onChain: deployStatus === 'pending-deploy' ? false : (existing.onChain ?? null),
            });
          }
        }

        return {
          walletAddress: confirmedAddress,
          publicKey: created.publicKey,
          status: deployStatus,
          ...(pendingReason !== undefined ? { pendingReason } : {}),
        };
      },

      async ensureWallet(input) {
        // Fire-and-forget auto-fund. Disparamos también con status='unknown'
        // (que es lo que regresa createWallet tras un POST exitoso, antes de
        // que el GET de confirmación marque on-chain). Friendbot necesita el
        // contrato vivo en Soroban para invocar XLM_SAC.transfer, así que
        // pasamos `retries` para esperar la race POST→on-chain (~5–10s).
        const maybeAutoFund = (result: EnsureWalletResult): EnsureWalletResult => {
          if (isTestnet && (result.status === 'on-chain' || result.status === 'unknown')) {
            fundTestnetIfNeeded(result.walletAddress, input.email, {
              retries: 6,
              retryDelayMs: 5000,
            }).catch(() => {
              /* friendbot a veces falla, no es crítico para el flow */
            });
          }
          return result;
        };

        // 1. Cheap idempotent metadata read.
        const remote = await ctx.endpoints.getWallet();

        if (remote) {
          // Update the local record's onChain mirror if we have one.
          const local = await ctx.deviceStore.loadCredential(input.email);
          if (local) {
            await ctx.deviceStore.saveCredential({
              ...local,
              walletAddress: remote.walletAddress,
              onChain: remote.onChain,
            });
          }

          if (
            remote.onChain === false &&
            local &&
            local.fragmentF2Encrypted &&
            local.fragmentF3Encrypted
          ) {
            // Ghost wallet — backend has the record but Soroban shows no
            // contract. Try a retry; if it still doesn't surface as on-chain
            // (constructor too big, RPC slow), surface pending-deploy.
            try {
              const retried = await this.retryDeploy(input.email);
              return maybeAutoFund({
                walletAddress: retried.walletAddress,
                status: retried.status,
                createdNow: false,
              });
            } catch {
              return maybeAutoFund({
                walletAddress: remote.walletAddress,
                status: 'pending-deploy',
                createdNow: false,
              });
            }
          }

          return maybeAutoFund({
            walletAddress: remote.walletAddress,
            status: statusFromOnChain(remote.onChain),
            createdNow: false,
          });
        }

        // 2. No wallet at the backend — first-time flow.
        const created = await this.createWallet(input);
        return maybeAutoFund({
          walletAddress: created.walletAddress,
          publicKey: created.publicKey,
          // Use whatever status createWallet inferred. POST OK ⇒ 'unknown'
          // (the next GET will upgrade to 'on-chain'); Soroban rejected the
          // deploy ⇒ 'pending-deploy' with the predicted address.
          status: created.status,
          createdNow: true,
        });
      },

      async retryDeploy(username) {
        const record = await ctx.deviceStore.loadCredential(username);
        if (!record) {
          throw new Error(
            `wallet.retryDeploy: no local CredentialRecord for "${username}". ` +
              'Call wallet.createWallet first (with credentialId + prfSalt).',
          );
        }
        if (
          !record.publicKey ||
          !record.emailCommitment ||
          !record.fragmentF2Encrypted ||
          !record.fragmentF3Encrypted
        ) {
          throw new Error(
            `wallet.retryDeploy: stored CredentialRecord for "${username}" is missing ` +
              'publicKey / emailCommitment / encrypted F2 / F3. ' +
              'Re-create the wallet from scratch.',
          );
        }
        const confirmed = await postWallet({
          pubkeyEd25519: record.publicKey,
          emailCommitment: record.emailCommitment,
          secp256r1Pubkey: record.secp256r1Pubkey,
          fragmentF2: record.fragmentF2Encrypted,
          fragmentF3: record.fragmentF3Encrypted,
        });
        // Re-query the backend to learn the up-to-date onChain status.
        const remote = await ctx.endpoints.getWallet();
        const onChain = remote?.onChain ?? null;
        await ctx.deviceStore.saveCredential({
          ...record,
          walletAddress: confirmed,
          onChain,
        });
        return { walletAddress: confirmed, status: statusFromOnChain(onChain) };
      },

      async fetchRemote() {
        const remote = await ctx.endpoints.getWallet();
        return remote;
      },
      getStoredCredential(username) {
        return ctx.deviceStore.loadCredential(username);
      },
      async getPendingWallets() {
        const all = await ctx.deviceStore.listCredentials();
        return all.filter((c) => c.walletAddress === null || c.onChain === false);
      },
      clearStoredCredential(username) {
        return ctx.deviceStore.deleteCredential(username);
      },
      fundTestnet(walletAddress) {
        // Username viene del context — coincide con el primary key del DeviceStore.
        return fundTestnetIfNeeded(walletAddress, c.username);
      },

      async activateAsset(input) {
        const networkPassphrase = stellarConfig.networkPassphrase;
        const verifierAddress = stellarConfig.ed25519VerifierAddress;
        const explorerBase =
          networkPassphrase === 'Public Global Stellar Network ; September 2015'
            ? 'https://stellar.expert/explorer/public/tx/'
            : 'https://stellar.expert/explorer/testnet/tx/';

        // 1. Backend simulate del add_context_rule.
        const sim = await ctx.endpoints.activateAssetSimulate({
          asset: input.asset,
        });

        // 2. ECDH para wrappear F2 con session key per-request.
        const ephemeral = generateX25519Keypair();
        const wrappedF2 = await ctx.endpoints.getFragment2({
          clientEphemeralPubkey: base64FromBytes(ephemeral.publicKey),
        });
        const sessionPlaintext = unwrapSessionFragment2(wrappedF2, ephemeral.privateKey).plaintext;
        const fragmentF2Wire = JSON.parse(new TextDecoder().decode(sessionPlaintext)) as {
          ciphertext: string;
          nonce: string;
          algo: string;
        };
        const fragmentF2Envelope: EncryptedEnvelope = {
          nonce: base64ToBytes(fragmentF2Wire.nonce),
          ciphertext: base64ToBytes(fragmentF2Wire.ciphertext),
        };

        // 3. Reconstruct seed (Shamir F1 plain + F2 envelope+key).
        const reconstructed = reconstructFromPlainAndEncrypted({
          fragmentF1Plain: input.fragmentF1Plain,
          fragmentF2: { envelope: fragmentF2Envelope, key: input.fragmentF2Key },
        });

        // 4. Firma la auth entry contra la regla admin-cfg (rule en el slot
        //    `deployedTxTargetsCount`). El backend ya nos pasó `contextRuleIds`
        //    que es exactamente el slot correcto para esta wallet.
        const { signedAuthEntryXdr } = await signSorobanAuthEntry({
          signaturePayloadHashBase64: sim.signaturePayloadHashBase64,
          contextRuleIds: [...sim.contextRuleIds],
          placeholderAuthEntryXdr: sim.placeholderAuthEntryXdr,
          ed25519Seed: reconstructed.privateSeed,
          ed25519VerifierAddress: verifierAddress,
          ownerPubkey: input.ownerPubkey,
        });

        // 5. Submit.
        const submit = await ctx.endpoints.activateAssetSubmit({
          unsignedXdr: sim.unsignedXdr,
          signedAuthEntryXdr,
        });

        return {
          txHash: submit.txHash,
          status: submit.status,
          explorerUrl: `${explorerBase}${submit.txHash}`,
        };
      },

      /**
       * Implementación del high-level entry point. Combina registración de
       * passkey + derivación HKDF + ensureWallet en una sola llamada.
       */
      async bootstrap(input) {
        // Forzar refresh del JWT antes de empezar — el bootstrap completo (passkey
        // register + Shamir + POST) puede tomar 30s+, suficiente para que un
        // token cerca de expirar quede inválido a mitad del flow. Pidiendo el
        // valid token ahora dispara el refresh automático si el token está
        // dentro del `refreshLeadTimeMs` (default 5 min antes de exp).
        try {
          await ctx.tokenManager.getValidIdToken();
        } catch {
          // Si el refresh falla, dejamos que el primer fetch del flow lo capture
          // y formatError lo mapeará a "sesión expirada".
        }

        const enc = new TextEncoder();
        const userIdHash = sha256(enc.encode(input.email));
        const prfSalt = getRandomBytes(32);

        const rpId =
          input.passkey?.rpId ??
          (typeof window !== 'undefined' ? window.location.hostname : 'localhost');
        const rpName = input.passkey?.rpName ?? 'Accesly';

        const passkey = await registerPasskey({
          rpId,
          rpName,
          userId: userIdHash,
          userName: input.email,
          prfSalt,
        });

        if (!passkey.prfSupported || !passkey.prfOutput) {
          throw new Error(
            'wallet.bootstrap: this authenticator does not support the WebAuthn PRF ' +
              'extension. Use Chrome 116+, Edge 116+, or Safari 18+ with a native ' +
              'OS passkey (Touch ID, Face ID, Windows Hello).',
          );
        }

        const encryptionSalt = getRandomBytes(32);
        const f1Key = hkdfSha256(
          passkey.prfOutput,
          encryptionSalt,
          enc.encode('accesly-f1-encryption'),
          32,
        );
        const f2Key = hkdfSha256(
          passkey.prfOutput,
          encryptionSalt,
          enc.encode('accesly-f2-encryption'),
          32,
        );
        const f3Key = hkdfSha256(
          passkey.prfOutput,
          encryptionSalt,
          enc.encode('accesly-f3-encryption'),
          32,
        );

        // prfOutput drained — zeroize lo antes posible.
        zeroize(passkey.prfOutput);

        const emailSalt = getRandomBytes(32);
        const cognitoPasswordBytes = enc.encode(input.password);

        try {
          const result = await this.ensureWallet({
            email: input.email,
            emailSalt,
            encryptionKeys: [f1Key, f2Key, f3Key] as const,
            secp256r1Pubkey: passkey.secp256r1Pubkey,
            credentialId: passkey.credentialId,
            prfSalt,
            cognitoPassword: cognitoPasswordBytes,
            encryptionSalt,
          });
          return result;
        } finally {
          zeroize(f1Key);
          zeroize(f2Key);
          zeroize(f3Key);
          zeroize(cognitoPasswordBytes);
        }
      },

      /**
       * Implementación del helper de unlock. Reemplaza al
       * `lib/unlockForSigning.ts` que cada integrador tenía que copiar.
       */
      async unlockForSigning(username) {
        const record = await ctx.deviceStore.loadCredential(username);
        if (!record) {
          throw new Error(
            `wallet.unlockForSigning: no local CredentialRecord for "${username}". ` +
              'Run recovery.finalize on this device or create a new wallet.',
          );
        }
        if (!record.publicKey) {
          throw new Error(
            'wallet.unlockForSigning: stored CredentialRecord has no publicKey. ' +
              'Legacy wallet — recreate it with wallet.bootstrap.',
          );
        }
        if (!record.fragmentF1Encrypted) {
          throw new Error(
            'wallet.unlockForSigning: stored CredentialRecord has no fragmentF1Encrypted.',
          );
        }

        const challenge = getRandomBytes(32);
        const rpId =
          typeof window !== 'undefined' ? window.location.hostname : 'localhost';
        const unlock = await unlockPasskey({
          rpId,
          credentialId: record.credentialId,
          challenge,
          prfSalt: record.prfSalt,
        });
        if (!unlock.prfOutput) {
          throw new Error(
            'wallet.unlockForSigning: authenticator did not return PRF output. ' +
              'Did you use the same browser/device where the wallet was created?',
          );
        }

        // Backwards compat: legacy CredentialRecords (pre-1.1.0) no tienen
        // `encryptionSalt`. Fallback al `prfSalt` — el flujo legacy del example
        // usaba un encryptionSalt separado pero que vive en otro store fuera
        // del SDK. Para nuevas wallets `wallet.bootstrap` siempre persiste el
        // encryptionSalt, así que este path solo aplica a wallets viejas.
        const salt = record.encryptionSalt ?? record.prfSalt;
        const enc = new TextEncoder();
        const f1Key = hkdfSha256(
          unlock.prfOutput,
          salt,
          enc.encode('accesly-f1-encryption'),
          32,
        );
        const fragmentF2Key = hkdfSha256(
          unlock.prfOutput,
          salt,
          enc.encode('accesly-f2-encryption'),
          32,
        );

        zeroize(unlock.prfOutput);

        let fragmentF1Plain: Uint8Array;
        try {
          fragmentF1Plain = decryptAesGcm(record.fragmentF1Encrypted, f1Key);
        } finally {
          zeroize(f1Key);
        }

        return {
          fragmentF1Plain,
          fragmentF2Key,
          ownerPubkey: record.publicKey,
          walletAddress: record.walletAddress ?? '',
        };
      },
    };
  }, [ctx, hexFromBytes, stellarConfig]);

  const tx = useMemo<TxNamespace>(
    () => ({
      async send(input) {
        const networkPassphrase = stellarConfig.networkPassphrase;
        const verifierAddress = stellarConfig.ed25519VerifierAddress;
        const explorerBase =
          networkPassphrase === 'Public Global Stellar Network ; September 2015'
            ? 'https://stellar.expert/explorer/public/tx/'
            : 'https://stellar.expert/explorer/testnet/tx/';

        // 1. Backend simulate → returns the placeholder envelope + payload to sign.
        //    `asset` default 'XLM' para backwards compat con apps que no migraron a 1.4.
        const sim = await ctx.endpoints.simulateTx({
          amountStroops: input.amountStroops,
          destinationAddress: input.destinationAddress,
          ...(input.asset ? { asset: input.asset } : {}),
        });

        // 2. ECDH key exchange → backend re-wraps F2 with a per-request key.
        const ephemeral = generateX25519Keypair();
        const ephemeralPubBase64 = base64FromBytes(ephemeral.publicKey);

        const wrappedF2 = await ctx.endpoints.getFragment2({
          clientEphemeralPubkey: ephemeralPubBase64,
        });

        // 3. Undo the session layer → recovers the original EncryptedFragment JSON.
        const sessionPlaintext = unwrapSessionFragment2(wrappedF2, ephemeral.privateKey).plaintext;
        const fragmentF2Wire = JSON.parse(new TextDecoder().decode(sessionPlaintext)) as {
          ciphertext: string;
          nonce: string;
          algo: string;
        };

        const fragmentF2Envelope: EncryptedEnvelope = {
          nonce: base64ToBytes(fragmentF2Wire.nonce),
          ciphertext: base64ToBytes(fragmentF2Wire.ciphertext),
        };

        // 4. Reconstruct ed25519 seed by combining F1 (plain) + F2 (decrypted with F2 key).
        const reconstructed = reconstructFromPlainAndEncrypted({
          fragmentF1Plain: input.fragmentF1Plain,
          fragmentF2: { envelope: fragmentF2Envelope, key: input.fragmentF2Key },
        });

        // 5. Sign the Soroban auth entry with the reconstructed seed. The helper
        //    zero-izes the seed even on throw.
        const { signedAuthEntryXdr } = await signSorobanAuthEntry({
          signaturePayloadHashBase64: sim.signaturePayloadHashBase64,
          contextRuleIds: [...sim.contextRuleIds],
          placeholderAuthEntryXdr: sim.placeholderAuthEntryXdr,
          ed25519Seed: reconstructed.privateSeed,
          ed25519VerifierAddress: verifierAddress,
          ownerPubkey: input.ownerPubkey,
        });

        // 6. Backend submit → wraps in fee-bump with channels-fund and submits.
        const submit = await ctx.endpoints.submitTx({
          unsignedXdr: sim.unsignedXdr,
          signedAuthEntryXdr,
        });

        // 7. Optimistic update — push el item al `useWalletHistory` cache para
        //    que aparezca al instante sin esperar el indexing de Stellar
        //    Expert (~30-60s típico). El próximo poll del hook lo va a
        //    descartar cuando confirme que ya está en el feed real.
        try {
          // walletAddress = computeSmartAccountAddress requeriría el deployer.
          // En vez de re-computar, los hooks que consumen optimistic resuelven
          // el wallet via DeviceStore; acá insertamos por ownerPubkey hex.
          const username = ctx.username;
          if (username) {
            const stored = await ctx.deviceStore.loadCredential(username);
            if (stored?.walletAddress) {
              const { historyOptimisticPush } = await import('./useWalletHistory.js');
              historyOptimisticPush(stored.walletAddress, {
                type: 'transfer-out',
                txHash: submit.txHash,
                ledger: Math.floor(Date.now() / 1000),
                timestamp: new Date().toISOString(),
                to: input.destinationAddress,
                amountStroops: input.amountStroops,
                ...(input.asset ? { asset: input.asset } : {}),
              });
            }
          }
        } catch {
          // Fire-and-forget — no rompemos el send si falla el optimistic push.
        }

        return {
          txHash: submit.txHash,
          status: submit.status,
          explorerUrl: `${explorerBase}${submit.txHash}`,
        };
      },
      async signRawXdr(input) {
        return coreSignTransaction({
          transactionXdr: input.transactionXdr,
          ed25519Seed: input.ed25519Seed,
          networkPassphrase: stellarConfig.networkPassphrase,
          ...(input.expectedPublicKey ? { expectedPublicKey: input.expectedPublicKey } : {}),
        });
      },

      async swap(input) {
        const networkPassphrase = stellarConfig.networkPassphrase;
        const verifierAddress = stellarConfig.ed25519VerifierAddress;
        const explorerBase =
          networkPassphrase === 'Public Global Stellar Network ; September 2015'
            ? 'https://stellar.expert/explorer/public/tx/'
            : 'https://stellar.expert/explorer/testnet/tx/';

        // 1. Backend simulate (hits Soroswap /quote + /quote/build internamente).
        const sim = await ctx.endpoints.swapSimulate({
          fromAsset: input.fromAsset,
          toAsset: input.toAsset,
          amountIn: input.amountIn,
          ...(input.slippageBps !== undefined ? { slippageBps: input.slippageBps } : {}),
        });

        // 2-4. Mismo flow ECDH + Shamir + reconstruct que tx.send.
        const ephemeral = generateX25519Keypair();
        const wrappedF2 = await ctx.endpoints.getFragment2({
          clientEphemeralPubkey: base64FromBytes(ephemeral.publicKey),
        });
        const sessionPlaintext = unwrapSessionFragment2(wrappedF2, ephemeral.privateKey).plaintext;
        const fragmentF2Wire = JSON.parse(new TextDecoder().decode(sessionPlaintext)) as {
          ciphertext: string;
          nonce: string;
          algo: string;
        };
        const fragmentF2Envelope: EncryptedEnvelope = {
          nonce: base64ToBytes(fragmentF2Wire.nonce),
          ciphertext: base64ToBytes(fragmentF2Wire.ciphertext),
        };
        const reconstructed = reconstructFromPlainAndEncrypted({
          fragmentF1Plain: input.fragmentF1Plain,
          fragmentF2: { envelope: fragmentF2Envelope, key: input.fragmentF2Key },
        });

        // 5. Firma la auth entry contra la regla biometric-tx del fromAsset.
        const { signedAuthEntryXdr } = await signSorobanAuthEntry({
          signaturePayloadHashBase64: sim.signaturePayloadHashBase64,
          contextRuleIds: [...sim.contextRuleIds],
          placeholderAuthEntryXdr: sim.placeholderAuthEntryXdr,
          ed25519Seed: reconstructed.privateSeed,
          ed25519VerifierAddress: verifierAddress,
          ownerPubkey: input.ownerPubkey,
        });

        // 6. Submit — backend re-inyecta sig, KMS-firma con channels-fund, submitea.
        const submit = await ctx.endpoints.swapSubmit({
          unsignedXdr: sim.unsignedXdr,
          signedAuthEntryXdr,
        });

        return {
          txHash: submit.txHash,
          status: submit.status,
          explorerUrl: `${explorerBase}${submit.txHash}`,
          quote: sim.quote,
        };
      },
    }),
    [ctx, stellarConfig],
  );

  const kyc = useMemo<KycNamespace>(
    () => ({
      async start() {
        return ctx.endpoints.kycStart();
      },
      async status() {
        return ctx.endpoints.kycStatus();
      },
    }),
    [ctx],
  );

  // ── Fiat (Etherfuse onramp/offramp/bank-accounts) ─────────────────────────
  const fiat = useMemo<FiatNamespace>(
    () => {
      const c = ctx;
      // Resuelve walletAddress del DeviceStore o tira con mensaje claro.
      async function resolveWalletAddress(): Promise<string> {
        if (!c.username) throw new Error('fiat: no authenticated user');
        const stored = await c.deviceStore.loadCredential(c.username);
        if (!stored?.walletAddress) {
          throw new Error('fiat: no wallet for current user (run wallet.bootstrap first)');
        }
        return stored.walletAddress;
      }

      return {
        async startKyc() {
          return c.endpoints.kycStart();
        },
        async kycStatus() {
          return c.endpoints.kycStatus();
        },
        async registerBankAccount(input) {
          return c.endpoints.registerBankAccount(input);
        },
        async quoteOnramp(input) {
          const walletAddress = await resolveWalletAddress();
          return c.endpoints.onramp({
            action: 'quote',
            amount: input.amountMxn,
            walletAddress,
            appId: c.appId,
          });
        },
        async submitOnramp(input) {
          const walletAddress = await resolveWalletAddress();
          return c.endpoints.onramp({
            action: 'submit',
            amount: '0', // ignorado en submit, el quote dicta
            quoteId: input.quoteId,
            walletAddress,
            appId: c.appId,
          });
        },
        async quoteOfframp(input) {
          const walletAddress = await resolveWalletAddress();
          return c.endpoints.offramp({
            action: 'quote',
            amount: input.amountUsdc,
            bankAccountId: input.bankAccountId,
            walletAddress,
            appId: c.appId,
          });
        },
        async submitOfframp(input) {
          const walletAddress = await resolveWalletAddress();
          return c.endpoints.offramp({
            action: 'submit',
            amount: '0',
            quoteId: input.quoteId,
            walletAddress,
            appId: c.appId,
          });
        },
      };
    },
    [ctx],
  );

  // ── Recovery v2 (Fase 1, 2026-06-15) ──────────────────────────────────────
  // Esta primera versión expone los wrappers thin de los 3 endpoints públicos
  // (`requestOtp`, `verifyOtp`, `finalize`). El `finalize` aquí solo manda el
  // body al backend tal cual lo arme el caller — el orchestration completo
  // (descifrar F3 con recoveryKey, reconstruir seed, registrar new passkey,
  // firmar rotate_signer, etc.) se hace en el componente de UI con los
  // helpers de @accesly/core (deriveRecoveryKey, decryptAesGcm, etc.).
  //
  // Razón: el flujo requiere navegar 2-3 pantallas (pedir password, registrar
  // new passkey vía navigator.credentials.create, esperar response del user)
  // y meterlo todo dentro de un solo `finalize()` programáticamente hace el
  // UX worse. El example app va a tener el orchestrator end-to-end.
  const recovery = useMemo<RecoveryNamespace>(
    () => ({
      async requestOtp(input) {
        return ctx.endpoints.requestRecoveryOtp(input);
      },
      async verifyOtp(input) {
        return ctx.endpoints.verifyRecoveryOtp(input);
      },
      async reconstructSeed(input) {
        // 1. Trae F2_recovery + F3 + recoverySalt del backend.
        const frag = await ctx.endpoints.getFragment3(input.recoveryJwt);
        if (!frag.fragmentF2Recovery) {
          throw new Error(
            'recovery.reconstructSeed: la wallet fue creada antes de Fase 1 y no tiene F2 cipher-bound a recoveryKey. No es recuperable vía OTP.',
          );
        }

        // 2. Decode salt + deriva recoveryKey con el password.
        const recoverySalt = base64ToBytes(frag.recoverySalt);
        const recoveryKey = deriveRecoveryKey({
          password: input.cognitoPassword,
          salt: recoverySalt,
        });

        // 3. Reconstruye seed via Shamir(F2, F3) ambos descifrados con
        //    recoveryKey. `reconstructKey` zeroiza las plaintexts internas.
        const f2Envelope: EncryptedEnvelope = {
          ciphertext: base64ToBytes(frag.fragmentF2Recovery.ciphertext),
          nonce: base64ToBytes(frag.fragmentF2Recovery.nonce),
        };
        const f3Envelope: EncryptedEnvelope = {
          ciphertext: base64ToBytes(frag.fragmentF3Encrypted.ciphertext),
          nonce: base64ToBytes(frag.fragmentF3Encrypted.nonce),
        };
        const seedResult = reconstructKey({
          fragments: [
            { envelope: f2Envelope, key: recoveryKey },
            { envelope: f3Envelope, key: recoveryKey },
          ],
        });

        return {
          privateSeed: seedResult.privateSeed,
          publicKey: seedResult.publicKey,
          recoveryKey,
          recoverySalt: frag.recoverySalt,
        };
      },
      async finalize(input) {
        const networkPassphrase = stellarConfig.networkPassphrase;
        const verifierAddress = stellarConfig.ed25519VerifierAddress;
        const explorerBase =
          networkPassphrase === 'Public Global Stellar Network ; September 2015'
            ? 'https://stellar.expert/explorer/public/tx/'
            : 'https://stellar.expert/explorer/testnet/tx/';

        const enc = new TextEncoder();
        const cognitoPasswordBytes = enc.encode(input.password);

        // 1. Reconstruct la seed VIEJA via Shamir(F2_recovery + F3). El SDK ya
        //    expone esto como `this.reconstructSeed` — reusamos.
        const seedResult = await this.reconstructSeed({
          cognitoPassword: cognitoPasswordBytes,
          recoveryJwt: input.recoveryJwt,
        });
        const oldReconstructedSeed = seedResult.privateSeed;
        const oldOwnerPubkey = seedResult.publicKey;
        const oldRecoveryKey = seedResult.recoveryKey;

        try {
          // 2. Registrar el NUEVO passkey con PRF.
          const userIdHash = sha256(enc.encode(input.email));
          const newPrfSalt = getRandomBytes(32);
          const rpId =
            input.passkey?.rpId ??
            (typeof window !== 'undefined' ? window.location.hostname : 'localhost');
          const rpName = input.passkey?.rpName ?? 'Accesly';
          const passkey = await registerPasskey({
            rpId,
            rpName,
            userId: userIdHash,
            userName: input.email,
            prfSalt: newPrfSalt,
          });
          if (!passkey.prfSupported || !passkey.prfOutput) {
            throw new Error(
              'recovery.finalize: the new authenticator did not return PRF output. ' +
                'Required by Accesly. Use Chrome 116+, Edge 116+, Safari 18+ with a native OS passkey.',
            );
          }

          // 3. Derivar las dos AES keys nuevas (F1' PRF-bound, F2' PRF-bound)
          //    + el encryptionSalt persistible.
          const encryptionSalt = getRandomBytes(32);
          const newF1Key = hkdfSha256(
            passkey.prfOutput,
            encryptionSalt,
            enc.encode('accesly-f1-encryption'),
            32,
          );
          const newF2Key = hkdfSha256(
            passkey.prfOutput,
            encryptionSalt,
            enc.encode('accesly-f2-encryption'),
            32,
          );
          zeroize(passkey.prfOutput);

          // 4. Genera NUEVA seed + new Shamir split. F3' se cifra con
          //    newRecoveryKey (PBKDF2(password, newRecoverySalt, 600k)).
          const newRecoverySalt = generateRecoverySalt();
          const newRecoveryKey = deriveRecoveryKey({
            password: cognitoPasswordBytes,
            salt: newRecoverySalt,
          });
          const newRecoverySaltBase64 = base64FromBytes(newRecoverySalt);
          const newEmailSalt = getRandomBytes(32);

          const created = coreCreateWallet({
            emailBytes: enc.encode(input.email),
            emailSalt: newEmailSalt,
            encryptionKeys: [newF1Key, newF2Key, newRecoveryKey] as const,
          });

          // 5. F2_recovery — derivar el envelope cifrado con newRecoveryKey.
          //    Descifra F2' (PRF-bound) → re-cifra con recoveryKey. La seed
          //    plaintext nunca se toca acá; solo el SHARE plaintext.
          const f2PlainShare = decryptAesGcm(created.encryptedFragments[1], newF2Key);
          let newFragmentF2Recovery: EncryptedEnvelope;
          try {
            newFragmentF2Recovery = encryptAesGcm(f2PlainShare, newRecoveryKey);
          } finally {
            zeroize(f2PlainShare);
          }

          const newSecp256r1Canonical = normalizeSecp256r1Pubkey(passkey.secp256r1Pubkey);
          const newOwnerHex = hexFromBytes(created.publicKey);
          const newSecpHex = hexFromBytes(newSecp256r1Canonical);
          const newEmailCommitHex = hexFromBytes(created.emailCommitment);

          // 6. POST /recovery/simulate-rotate-signer.
          const sim = await ctx.endpoints.simulateRotateSigner(input.recoveryJwt, {
            newOwnerEd25519Pubkey: newOwnerHex,
            newSecp256r1Pubkey: newSecpHex,
            newEmailCommitment: newEmailCommitHex,
          });

          // 7. Firmar la auth entry con la SEED VIEJA. signSorobanAuthEntry
          //    zero-iza la seed internamente.
          const { signedAuthEntryXdr } = await signSorobanAuthEntry({
            signaturePayloadHashBase64: sim.signaturePayloadHashBase64,
            contextRuleIds: [...sim.contextRuleIds],
            placeholderAuthEntryXdr: sim.placeholderAuthEntryXdr,
            ed25519Seed: oldReconstructedSeed,
            ed25519VerifierAddress: verifierAddress,
            ownerPubkey: oldOwnerPubkey,
          });

          // 8. POST /recovery/finalize.
          let finalizeResp;
          try {
            finalizeResp = await ctx.endpoints.finalizeRecovery(input.recoveryJwt, {
              unsignedXdr: sim.unsignedXdr,
              signedAuthEntryXdr,
              newOwnerEd25519Pubkey: newOwnerHex,
              newSecp256r1Pubkey: newSecpHex,
              newFragmentF1Encrypted: encodeFragmentToWire(created.encryptedFragments[0]),
              newFragmentF2Encrypted: encodeFragmentToWire(created.encryptedFragments[1]),
              newFragmentF2Recovery: encodeFragmentToWire(newFragmentF2Recovery),
              newFragmentF3Encrypted: encodeFragmentToWire(created.encryptedFragments[2]),
              newRecoverySalt: newRecoverySaltBase64,
              newEmailCommitment: newEmailCommitHex,
            });
          } finally {
            zeroize(newRecoveryKey);
          }

          // 9. Persistir el nuevo CredentialRecord (con encryptionSalt para que
          //    unlockForSigning pueda re-derivar las mismas keys).
          await ctx.deviceStore.saveCredential({
            username: input.email,
            credentialId: passkey.credentialId,
            secp256r1Pubkey: newSecp256r1Canonical,
            fragmentF1Encrypted: created.encryptedFragments[0],
            fragmentF2Encrypted: created.encryptedFragments[1],
            fragmentF3Encrypted: created.encryptedFragments[2],
            publicKey: created.publicKey,
            emailCommitment: created.emailCommitment,
            prfSalt: newPrfSalt,
            encryptionSalt,
            fallbackKeyMaterial: new Uint8Array(0),
            walletAddress: finalizeResp.walletAddress,
            onChain: true,
            createdAt: Date.now(),
          });

          // Zeroize key material que aún tenemos en mano.
          zeroize(newF1Key);
          zeroize(newF2Key);

          return {
            walletAddress: finalizeResp.walletAddress,
            txHash: finalizeResp.txHash,
            status: finalizeResp.status,
            newPublicKey: created.publicKey,
            explorerUrl: `${explorerBase}${finalizeResp.txHash}`,
          };
        } finally {
          // Zeroize TODO el material sensitive aunque algo truene a mitad.
          zeroize(cognitoPasswordBytes);
          zeroize(oldReconstructedSeed);
          zeroize(oldRecoveryKey);
        }
      },
      async submitFinalize(input) {
        return ctx.endpoints.finalizeRecovery(input.recoveryJwt, {
          unsignedXdr: input.unsignedXdr,
          signedAuthEntryXdr: input.signedAuthEntryXdr,
          newOwnerEd25519Pubkey: input.newOwnerEd25519Pubkey,
          newSecp256r1Pubkey: input.newSecp256r1Pubkey,
          newFragmentF1Encrypted: encodeFragmentToWire(input.newFragmentF1Encrypted),
          newFragmentF2Encrypted: encodeFragmentToWire(input.newFragmentF2Encrypted),
          newFragmentF2Recovery: encodeFragmentToWire(input.newFragmentF2Recovery),
          newFragmentF3Encrypted: encodeFragmentToWire(input.newFragmentF3Encrypted),
          newRecoverySalt: input.newRecoverySalt,
          newEmailCommitment: input.newEmailCommitment,
        });
      },
    }),
    [ctx, stellarConfig, hexFromBytes],
  );

  const session = useMemo<SessionNamespace>(
    () => ({
      async create() {
        throw new NotImplementedYetError('session', 'create');
      },
      async revoke() {
        throw new NotImplementedYetError('session', 'revoke');
      },
    }),
    [],
  );

  const settings = useMemo<SettingsNamespace>(
    () => ({
      async addDevice() {
        throw new NotImplementedYetError('settings', 'addDevice');
      },
      async removeDevice() {
        throw new NotImplementedYetError('settings', 'removeDevice');
      },
      async listDevices() {
        throw new NotImplementedYetError('settings', 'listDevices');
      },
      async updateSpendingLimit() {
        throw new NotImplementedYetError('settings', 'updateSpendingLimit');
      },
    }),
    [],
  );

  const yieldOps = useMemo<YieldNamespace>(
    () => ({
      async invest() {
        throw new NotImplementedYetError('yield', 'invest');
      },
      async redeem() {
        throw new NotImplementedYetError('yield', 'redeem');
      },
      async position() {
        throw new NotImplementedYetError('yield', 'position');
      },
    }),
    [],
  );

  // hexToBytes is reserved for future helpers.
  void hexToBytes;
  return { auth, wallet, tx, kyc, fiat, recovery, session, settings, yieldOps, _internal: ctx };
}

/* --------------------------------- helpers --------------------------------- */

function coderHelpers(): {
  hexToBytes: (hex: string) => Uint8Array;
  hexFromBytes: (bytes: Uint8Array) => string;
} {
  function hexFromBytes(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i < bytes.length; i += 1) {
      out += (bytes[i] ?? 0).toString(16).padStart(2, '0');
    }
    return out;
  }
  function hexToBytes(hex: string): Uint8Array {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    if (clean.length % 2 !== 0) throw new Error(`hexToBytes: odd length ${clean.length}`);
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i += 1) {
      out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }
  return { hexToBytes, hexFromBytes };
}

function encodeFragmentToWire(env: EncryptedEnvelope): {
  ciphertext: string;
  nonce: string;
  algo: 'aes-256-gcm';
} {
  return {
    ciphertext: base64FromBytes(env.ciphertext),
    nonce: base64FromBytes(env.nonce),
    algo: 'aes-256-gcm',
  };
}

function base64FromBytes(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  // Browser fallback
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i] ?? 0);
  return globalThis.btoa(bin);
}

function base64ToBytes(s: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
  const bin = globalThis.atob(s);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
  return arr;
}
