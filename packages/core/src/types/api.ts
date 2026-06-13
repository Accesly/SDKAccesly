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
export interface SimulateTxRequest {
  /** Base-10 string del monto en unidades base (XLM = stroops, 1 XLM = 1e7). */
  readonly amountStroops: string;
  /** G… o C… — el SAC `transfer` acepta ambos como destino. */
  readonly destinationAddress: string;
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

/* ── SEP-30 recovery (Phase 6) ────────────────────────────────────────────── */

/** Authentication method on a recovery identity (SEP-30 §3.2). */
export interface RecoveryAuthenticationMethod {
  /**
   * `accesly_zk_email`: ZK groth16 proof that the user controls the email
   * (verified on-chain by the `zk-email-verifier` Soroban contract).
   * `stellar_address`: standard SEP-30 SoroSign challenge with the user's
   * passkey.
   */
  readonly type: 'accesly_zk_email' | 'stellar_address';
  /**
   * For `accesly_zk_email`: hex sha256(email) matching the circuit's
   * `recipient_email_hash` public signal. For `stellar_address`: the
   * Stellar G... address that signs the challenge.
   */
  readonly value: HexString | string;
}

/** Identity authorized to initiate recovery on the wallet (sender). */
export interface RecoveryIdentity {
  /** SEP-30 role. Accesly currently only uses `sender`. */
  readonly role: 'sender' | 'receiver';
  readonly authentication_methods: readonly RecoveryAuthenticationMethod[];
}

/** Signer the backend will use to co-sign the recovery transaction. */
export interface RecoverySignerRequest {
  /** Stellar G... address derived from the KMS public key. */
  readonly key: string;
  /** ARN of the KMS key the backend uses for `kms:Sign`. */
  readonly kmsKeyArn: string;
}

/** Public response shape — `kmsKeyArn` is never exposed to the client. */
export interface RecoverySignerPublic {
  readonly key: string;
}

export interface ConfigureRecoveryRequest {
  readonly identities: readonly RecoveryIdentity[];
  readonly signers: readonly RecoverySignerRequest[];
}

export interface RecoveryConfigResponse {
  readonly address: string;
  readonly identities: readonly RecoveryIdentity[];
  readonly signers: readonly RecoverySignerPublic[];
  readonly verifier_mode: 'mock' | 'real';
  readonly created_at: string;
  readonly updated_at: string;
}

export interface RecoverySignRequest {
  /** Stellar transaction envelope (XDR base64) to be co-signed. */
  readonly transaction: string;
  readonly identity: RecoveryAuthenticationMethod;
  /** Optional hex hash that must appear in the `RecoveryAuthorized` event. */
  readonly recovery_command_hash?: HexString;
}

export interface RecoverySignResponse {
  readonly walletAddress: string;
  readonly signingAddress: string;
  readonly authorized: boolean;
  readonly verifierMode: 'mock' | 'real';
  /** Populated when the server signs with its KMS key; null until that wires. */
  readonly server_signed_transaction: string | null;
  readonly network_passphrase: string | null;
}

export interface RecoveryDeleteResponse {
  readonly walletAddress: string;
  readonly deleted: true;
}
