/**
 * Accesly backend API types — handwritten mirror of
 * `CloudServices-accesly/docs/openapi.yaml`.
 *
 * Kept in sync with the backend OpenAPI spec by hand for Hito 3. Once the
 * backend repo publishes its spec at a stable URL, `scripts/gen-api-types.mjs`
 * will regenerate `api.generated.ts` from it. Until then, edits here are the
 * source of truth on the SDK side — when the backend spec changes, update
 * this file in the same PR.
 *
 * @see CloudServices-accesly/docs/openapi.yaml (Accesly Backend API v0.1.0)
 */

/** Base64-encoded byte string. */
export type Base64String = string;

/** Hexadecimal-encoded byte string (lowercase). */
export type HexString = string;

export interface HealthResponse {
  readonly status: 'ok';
  readonly stage: string;
}

export interface EncryptedFragmentWire {
  /** Base64 AES-GCM ciphertext with the 16-byte auth tag appended. */
  readonly ciphertext: Base64String;
  /** Base64 12-byte AES-GCM nonce. */
  readonly nonce: Base64String;
  /** AEAD algorithm identifier — always `aes-256-gcm` for this version. */
  readonly algo: 'aes-256-gcm';
}

export interface CreateWalletRequest {
  readonly appId: string;
  /** Hex 32 bytes — ed25519 public key derived from the client-side seed. */
  readonly pubkeyEd25519: HexString;
  /** Hex 32 bytes — `SHA256(email || salt)`. */
  readonly emailCommitment: HexString;
  /** Hex 65 bytes — passkey/WebAuthn uncompressed public key. */
  readonly secp256r1Pubkey: HexString;
  readonly fragmentF2: EncryptedFragmentWire;
  readonly fragmentF3: EncryptedFragmentWire;
  /**
   * F2 cifrado con `recoveryKey = PBKDF2(passwordCognito, recoverySalt, 600k)`.
   *
   * Recovery v2 (Fase 1, 2026-06-15). Necesario porque Shamir 2-de-3 requiere
   * DOS shares para reconstruir el seed; en recovery `F1` está perdido
   * (device gone) y `F2` cifrado con la PRF del passkey original no se puede
   * descifrar. Esta segunda copia de F2 cipher-bound a `recoveryKey` permite
   * que el cliente, con solo el password de Cognito, descifre F2 y F3 y
   * combine ambos via Shamir para reconstruir el seed.
   *
   * El backend almacena este blob junto a F3 (cipher-bound a la misma key).
   * Sin password el backend NO puede descifrar.
   *
   * Si se omite, el wallet se crea pero no será recuperable vía OTP.
   */
  readonly fragmentF2Recovery?: EncryptedFragmentWire;
  /**
   * Hex 32 bytes — `SHA256(email.toLowerCase().trim())`.
   *
   * El backend indexa este valor en el GSI `by-email-hash` de
   * `user_fragments`, lo que permite que la Lambda `recovery-otp` resuelva
   * `emailHash → userId` durante el flujo de recuperación.
   *
   * Recovery v2 (Fase 1, 2026-06-15). Si se omite, el wallet queda
   * imposible de recuperar vía OTP; los flows sin recovery (smoke tests)
   * lo dejan omitido y aceptan ese trade-off.
   */
  readonly emailHash?: HexString;
  /**
   * Base64 32 bytes — salt aleatorio para derivar `recoveryKey` con
   * `PBKDF2(passwordCognito, recoverySalt, 600k)`. Lo guarda el backend
   * junto con `fragmentF3`. En `/recovery/finalize` el SDK envía un nuevo
   * `recoverySalt`.
   *
   * Recovery v2. Si se omite, el flow de recovery no podrá descifrar F3.
   */
  readonly recoverySalt?: Base64String;
}

export interface CreateWalletResponse {
  /** Stellar contract address of the deployed Smart Account (starts with `C`). */
  readonly walletAddress: string;
  /** Transaction hash if the deploy already settled; null while pending. */
  readonly txHash: string | null;
}

/**
 * Response of `GET /wallets` — returns the user's already-deployed Smart
 * Account metadata, keyed by the Cognito JWT. The backend resolves to 404
 * with `{ error: 'no wallet registered for this user' }` if the user has not
 * yet completed `POST /wallets`.
 *
 * `onChain` is the live Soroban RPC status check the backend performs:
 *  - `true`  → contract is deployed and reachable
 *  - `false` → record exists but Soroban has no contract at that address
 *              (ghost wallet — POST landed but deploy did not)
 *  - `null`  → backend could not reach Soroban RPC; treat as unknown
 */
export interface GetWalletResponse {
  readonly walletAddress: string;
  readonly appId: string;
  readonly createdAt: string;
  readonly onChain: boolean | null;
}

export interface GetFragment2Request {
  /** Base64 32-byte client X25519 ephemeral public key. */
  readonly clientEphemeralPubkey: Base64String;
}

export interface GetFragment2Response {
  /** Base64 12-byte AES-GCM nonce. */
  readonly nonce: Base64String;
  /** Base64 AES-GCM ciphertext (does NOT include the auth tag). */
  readonly ciphertext: Base64String;
  /** Base64 16-byte AES-GCM auth tag. */
  readonly authTag: Base64String;
  /** Base64 32-byte server X25519 ephemeral public key. */
  readonly serverEphemeralPubkey: Base64String;
}

/**
 * `POST /tx/simulate` — fase 1 de mandar XLM desde un Smart Account de Accesly.
 *
 * El backend construye la invocación `XLM_SAC.transfer(from=smartAccount, to,
 * amount)`, simula contra Soroban RPC, y devuelve al SDK todo lo necesario
 * para firmar client-side la `SorobanAuthorizationEntry` del Smart Account.
 *
 * Premisa no-custodial: el backend NO firma como el Smart Account. La sig
 * ed25519 sobre el `auth_digest` la produce el SDK con la llave reconstruida
 * de F1+F2+F3.
 */
/** Assets soportados por `tx.send` (1.4+). USDC requiere wallet con rule 1 activado. */
export type TransferAsset = 'XLM' | 'USDC';

export interface SimulateTxRequest {
  /**
   * Base-10 string del monto en unidades atómicas (1e-7 para ambos XLM y USDC).
   * Ejemplo: `"12500000"` = 1.25 XLM o 1.25 USDC.
   */
  readonly amountStroops: string;
  /** G… o C… — el SAC `transfer` acepta ambos como destino. */
  readonly destinationAddress: string;
  /**
   * Asset a transferir. Default `'XLM'` cuando no se especifica — el backend
   * trata `undefined` como XLM para backwards compat con SDK <1.4.
   */
  readonly asset?: TransferAsset;
}

export interface SimulateTxResponse {
  /** Envelope con sorobanData + auth entry placeholder (signature = ScVoid). */
  readonly unsignedXdr: Base64String;
  /**
   * Hash de 32 bytes (base64) que Soroban host pasaría a `__check_auth` como
   * `signature_payload`. OZ Smart Account modifica ese digest así:
   *   `auth_digest = sha256(signature_payload || context_rule_ids.to_xdr())`
   * y el SDK firma `auth_digest`, no este valor crudo.
   */
  readonly signaturePayloadHashBase64: Base64String;
  /** Nonce asignado por la simulación. Reusable en la auth entry firmada. */
  readonly nonce: string;
  /** Ledger # de expiración de la firma. */
  readonly signatureExpirationLedger: number;
  /**
   * IDs de context rule del Smart Account, alineados por índice con los
   * auth_contexts del runtime. Para una transfer simple longitud = 1
   * (la regla `biometric-tx` para `CallContract(XLM_SAC)`).
   */
  readonly contextRuleIds: readonly number[];
  /** XDR base64 de la SorobanAuthorizationEntry placeholder (sin firma). */
  readonly placeholderAuthEntryXdr: Base64String;
  /** Estimado de resource fee en stroops — informativo para UI. */
  readonly resourceFeeStroops: string;
}

/**
 * `POST /tx/submit` — fase 2 de mandar XLM. Recibe la auth entry firmada por
 * el SDK + el envelope que `/tx/simulate` devolvió. El backend reemplaza la
 * auth placeholder, re-simula con la firma real para calcular bien los
 * resources (la primera simulación subestima porque no ejecuta __check_auth),
 * KMS-firma el envelope con `channels-fund` y manda a Soroban RPC.
 */
export interface SubmitTxRequest {
  readonly unsignedXdr: Base64String;
  readonly signedAuthEntryXdr: Base64String;
}

export interface SubmitTxResponse {
  readonly txHash: string;
  /** Soroban submit status: PENDING / TRY_AGAIN_LATER / ERROR / DUPLICATE. */
  readonly status: string;
}

export interface KycStartResponse {
  readonly customerId: string;
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly hostedUrl: string | null;
}

export type OrderAction = 'quote' | 'submit';

export interface OrderRequest {
  readonly action: OrderAction;
  readonly amount: string;
  readonly walletAddress: string;
  readonly appId: string;
  /** Required for `offramp` `submit`: SPEI destination CLABE. */
  readonly clabe?: string;
  /** Required for `submit`: quote id returned by the previous `quote` call. */
  readonly quoteId?: string;
}

export interface OrderResponse {
  readonly quoteId?: string;
  readonly orderId?: string;
  readonly status: string;
  readonly amount: string;
  readonly fxRate?: string;
  readonly expiresAt?: string;
}

/* ── Recovery v2 (OTP-email + password de Cognito, Fase 1) ────────────────── */

/** `POST /recovery/otp/request` body. */
export interface RecoveryOtpRequestInput {
  /** Email del usuario en plano. El backend solo persiste `sha256(email)`. */
  readonly email: string;
}

export interface RecoveryOtpRequestResponse {
  /**
   * Segundos hasta poder pedir otro OTP. El SDK debe mostrar countdown en
   * el botón de "Reenviar".
   */
  readonly cooldownSeconds: number;
  /** Segundos hasta que el OTP guardado expire (default 600 = 10min). */
  readonly expiresInSeconds: number;
}

/** `POST /recovery/otp/verify` body. */
export interface RecoveryOtpVerifyInput {
  readonly email: string;
  /** 6 dígitos en string. */
  readonly code: string;
}

export interface RecoveryOtpVerifyResponse {
  /**
   * Token opaco. El SDK lo envía en el header `X-Recovery-Jwt` a
   * `/fragments/3` y `/recovery/finalize`. TTL 5min.
   */
  readonly recoveryJwt: string;
  /** Epoch ms en el que el JWT expira (informativo). */
  readonly expiresAt: number;
}

/** `GET /fragments/3` response. */
export interface GetFragment3Response {
  /**
   * F2 cifrado con la misma `recoveryKey` que F3. El backend lo guarda
   * desde `createWallet` (campo `fragmentF2Recovery` del request). Junto
   * con F3, el cliente reconstruye el seed con Shamir 2-de-3.
   *
   * Puede venir `null` para wallets viejas (creadas antes de Fase 1) que
   * no tienen F2 cipher-bound a recoveryKey.
   */
  readonly fragmentF2Recovery: EncryptedFragmentWire | null;
  /** F3 cifrado con la `recoveryKey` derivada del password de Cognito. */
  readonly fragmentF3Encrypted: EncryptedFragmentWire;
  /** Base64 32 bytes — salt para re-derivar la `recoveryKey`. */
  readonly recoverySalt: Base64String;
}

/**
 * `POST /recovery/simulate-rotate-signer` body.
 *
 * Recovery v2 — paso intermedio entre `reconstructSeed` y `submitFinalize`:
 * el SDK pide al backend que arme + simule la tx `rotate_signer(newOwner,
 * newSecp256r1, newEmailCommit)` contra el Smart Account del usuario y
 * devuelva el material para firmar la `SorobanAuthorizationEntry` con la
 * seed VIEJA (reconstruida) contra la regla `admin-cfg`.
 */
export interface SimulateRotateSignerRequest {
  /** Hex 64 chars — nuevo ed25519 pubkey (derivado de la nueva seed). */
  readonly newOwnerEd25519Pubkey: HexString;
  /** Hex 130 chars — nueva passkey secp256r1 uncompressed. */
  readonly newSecp256r1Pubkey: HexString;
  /** Hex 64 chars — nuevo email commitment. */
  readonly newEmailCommitment: HexString;
}

export interface SimulateRotateSignerResponse {
  readonly unsignedXdr: Base64String;
  readonly signaturePayloadHashBase64: Base64String;
  readonly nonce: string;
  readonly signatureExpirationLedger: number;
  readonly contextRuleIds: readonly number[];
  readonly placeholderAuthEntryXdr: Base64String;
  readonly resourceFeeStroops: string;
  readonly walletAddress: string;
}

/** `POST /recovery/finalize` body. */
export interface FinalizeRecoveryRequest {
  /** XDR base64 de la tx `rotate_signer` (el `unsignedXdr` que devolvió simulate). */
  readonly unsignedXdr: string;
  /** XDR base64 de la `SorobanAuthorizationEntry` firmada por el SDK con la seed vieja. */
  readonly signedAuthEntryXdr: Base64String;
  /** Hex 64 chars — nuevo ed25519 pubkey (lo persiste en `user_fragments.pubkeyEd25519`). */
  readonly newOwnerEd25519Pubkey: HexString;
  /** Hex 130 chars — nueva passkey. */
  readonly newSecp256r1Pubkey: HexString;
  /** F1 cifrado con la nueva PRF (passkey-bound). */
  readonly newFragmentF1Encrypted: EncryptedFragmentWire;
  /** F2 cifrado con la PRF de la nueva passkey (sign normal). */
  readonly newFragmentF2Encrypted: EncryptedFragmentWire;
  /** F2 cifrado con la nueva recoveryKey (recovery path). */
  readonly newFragmentF2Recovery: EncryptedFragmentWire;
  /** F3 cifrado con la nueva recoveryKey. */
  readonly newFragmentF3Encrypted: EncryptedFragmentWire;
  /** Base64 32 bytes — nuevo recoverySalt (puede ser igual al viejo si no se rota). */
  readonly newRecoverySalt: Base64String;
  /** Hex 64 chars — `SHA256(email || newEmailSalt)`. */
  readonly newEmailCommitment: HexString;
}

export interface FinalizeRecoveryResponse {
  readonly walletAddress: string;
  readonly txHash: string;
  readonly status: string;
}

/* ── v1.1.0: read-only data endpoints (balance, activity) ───────────────── */

/**
 * Balance de un asset individual. `atomic` es la cantidad en unidades atómicas
 * (stroops para XLM, micro-USDC para USDC — ambos 1e-7). `formatted` es la
 * misma cantidad como string decimal sin trailing zeros ni notación científica
 * (e.g. `"12.345"`). Ambas son strings para soportar valores > 2^53.
 */
export interface AssetBalance {
  readonly atomic: string;
  readonly formatted: string;
}

/**
 * `GET /wallets/{address}/balance` — devuelve XLM + USDC en una sola llamada.
 *
 * Backwards compat con SDK <1.4: el `xlm` mantiene los campos legacy
 * `stroops` + `xlm` además del nuevo shape `atomic + formatted`. Apps en 1.3
 * siguen funcionando; apps en 1.4+ leen `atomic`/`formatted` para acceso
 * uniforme entre assets.
 */
export interface WalletBalanceResponse {
  readonly xlm: AssetBalance & {
    /** @deprecated usá `atomic` (mismo valor). Removido en 2.0. */
    readonly stroops: string;
    /** @deprecated usá `formatted` (mismo valor). Removido en 2.0. */
    readonly xlm: string;
  };
  readonly usdc: AssetBalance;
}

/**
 * Un evento on-chain del contrato del Smart Account. Decodificado por el
 * backend (topics + value vienen ya como native types — strings/numbers/
 * arrays/objects).
 */
export interface WalletActivityEvent {
  readonly type: string;
  readonly txHash: string;
  readonly ledger: number;
  readonly timestamp: string | null;
  readonly topics: readonly unknown[];
  readonly value: unknown;
}

/** `GET /wallets/{address}/activity?limit=N`. */
export interface WalletActivityResponse {
  readonly events: readonly WalletActivityEvent[];
  readonly cursor: string | null;
}

/** Item del history pre-decodificado por el backend proxy. */
export interface WalletHistoryItem {
  readonly type: 'wallet-created' | 'signer-rotated' | 'transfer-in' | 'transfer-out';
  /** Toid del evento específico (string para preservar precisión > 2^53). */
  readonly eventToid: string;
  /** Toid de la tx-level identifier. */
  readonly txToid: string;
  /** URL pre-armada a Stellar Expert con anchor — listo para renderizar. */
  readonly explorerUrl: string;
  readonly ledger: number;
  readonly timestamp: string;
  /** Solo para `signer-rotated`. */
  readonly newOwnerEd25519Hex?: string;
  /** Solo para `transfer-out`. */
  readonly to?: string;
  /** Solo para `transfer-in`. */
  readonly from?: string;
  /** Solo para transfers. */
  readonly amountStroops?: string;
  /**
   * Asset transferido (solo transfers). Default `'XLM'` cuando el backend no
   * lo manda — typical para audits pre-1.4 que loggeaban solo to/amount sin
   * asset. La UI debe tratar undefined como XLM para no romper.
   */
  readonly asset?: TransferAsset;
}

/** `GET /wallets/{address}/history?saCursor=&txCursor=&scanLimit=`. */
export interface WalletHistoryResponse {
  readonly events: readonly WalletHistoryItem[];
  readonly cursors: {
    readonly smartAccount: string | null;
    readonly transfers: string | null;
  };
}

export interface WalletHistoryRequestOptions {
  readonly smartAccountCursor?: string;
  readonly transfersCursor?: string;
  readonly transferScanLimit?: number;
}
