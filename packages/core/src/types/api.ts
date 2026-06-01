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
