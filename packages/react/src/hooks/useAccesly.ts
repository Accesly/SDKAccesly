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
  buildPaymentTransaction,
  createWallet as coreCreateWallet,
  normalizeSecp256r1Pubkey,
  reconstructFromPlainAndEncrypted,
  signTransaction as coreSignTransaction,
  type AuthStatus,
  type CredentialRecord,
  type EncryptedEnvelope,
} from '@accesly/core';
import { AcceslyContext, type AcceslyContextValue } from '../context.js';

export interface AuthNamespace {
  readonly status: AuthStatus;
  readonly username: string | null;
  signUp(email: string, password: string): Promise<{ userSub: string; userConfirmed: boolean }>;
  confirmSignUp(email: string, code: string): Promise<void>;
  resendConfirmation(email: string): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /**
   * SEP-30 account recovery via ZK email proof. NOT AVAILABLE yet — throws
   * `RecoveryNotAvailableError`. Requires Track C (groth16 zkEmail circuit)
   * and backend `sep30Handler` Lambda to be deployed first. Tracked in
   * `CloudServices-accesly/docs/Pendientes_dev.md`.
   */
  recover(email: string): Promise<never>;
}

/**
 * Thrown by `auth.recover()` until the ZK email circuit (Track C) and the
 * backend `sep30Handler` Lambda ship. The SDK exposes the API now so consumer
 * code doesn't need to be restructured when recovery activates.
 */
export class RecoveryNotAvailableError extends Error {
  constructor() {
    super(
      'recover() is not available in this SDK release. It requires the ZK email ' +
        'circuit (Track C) and the backend sep30Handler — neither is deployed yet. ' +
        'Track status in CloudServices-accesly/docs/Pendientes_dev.md.',
    );
    this.name = 'RecoveryNotAvailableError';
  }
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
}

export interface CreatedWalletInfo {
  readonly walletAddress: string;
  readonly publicKey: Uint8Array;
}

export interface EnsureWalletResult {
  readonly walletAddress: string;
  /** True if this call created the wallet; false if it was already on-chain. */
  readonly createdNow: boolean;
  /** Present only when `createdNow === true` (the keypair we just generated). */
  readonly publicKey?: Uint8Array;
}

export interface RemoteWalletInfo {
  readonly walletAddress: string;
  readonly appId: string;
  readonly createdAt: string;
}

export interface WalletNamespace {
  /**
   * End-to-end wallet creation:
   *  1. Generate keypair + Shamir split + encrypt fragments (client-side).
   *  2. If `credentialId` + `prfSalt` were provided, persist a pending
   *     `CredentialRecord` to the `DeviceStore` BEFORE the network call —
   *     this is the crash-safety net that keeps the encrypted F1 + passkey
   *     metadata even if the POST never receives a response.
   *  3. POST /wallets with hex pubkeys + base64 fragments.
   *  4. On success, update the stored record with the confirmed
   *     `walletAddress` and return the deployed Smart Account address.
   *
   * The caller is responsible for the encryption-key derivation (typically
   * via WebAuthn PRF).
   */
  createWallet(input: CreateWalletInput): Promise<CreatedWalletInfo>;
  /**
   * Idempotent wallet bootstrap: GET /wallets first (cheap metadata read).
   * - If the backend already has a wallet for this Cognito user → returns
   *   `{ createdNow: false }` and skips the keypair generation entirely.
   * - If 404 → falls through to `createWallet(input)` and returns
   *   `{ createdNow: true }`.
   *
   * Recommended entry-point at the top of every authenticated session.
   */
  ensureWallet(input: CreateWalletInput): Promise<EnsureWalletResult>;
  /**
   * Reads the user's wallet metadata from the backend. Returns null if the
   * user has not yet created a wallet.
   */
  fetchRemote(): Promise<RemoteWalletInfo | null>;
  /** Returns the locally-stored credential record, if any. */
  getStoredCredential(username: string): Promise<CredentialRecord | null>;
  /**
   * Lists `CredentialRecord`s that were saved before the POST but whose
   * `walletAddress` is still `null` — i.e. the network call did not confirm
   * deployment. Diagnostic + recovery aid.
   */
  getPendingWallets(): Promise<readonly CredentialRecord[]>;
  /** Removes a stored credential. Useful after a failed pending wallet is reconciled. */
  clearStoredCredential(username: string): Promise<void>;
}

export interface SignPaymentInput {
  readonly sourceAddress: string;
  readonly destinationAddress: string;
  readonly asset: 'XLM' | { readonly code: string; readonly issuer: string };
  readonly amount: string;
  /** F1 (encoded share including index byte) AS PLAINTEXT — typically unlocked via WebAuthn PRF. */
  readonly fragmentF1Plain: Uint8Array;
  /** F2 envelope returned by the backend `/fragments/2` endpoint (already re-keyed). */
  readonly fragmentF2Envelope: EncryptedEnvelope;
  /** Symmetric key for the F2 envelope (derived from ECDH + HKDF). */
  readonly fragmentF2Key: Uint8Array;
  readonly expectedPublicKey?: Uint8Array;
  readonly memo?: string;
}

export interface TxNamespace {
  /**
   * Builds + signs + returns the signed XDR. Does NOT submit — that's the
   * Relayer's job (Hito 6 will wire a `submit` helper that posts to the
   * Relayer via the backend).
   */
  signPayment(input: SignPaymentInput): Promise<{ signedXdr: string; publicKey: Uint8Array }>;
  /** Sign an arbitrary already-built XDR with a reconstructed seed. */
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

export interface AcceslyHook {
  readonly auth: AuthNamespace;
  readonly wallet: WalletNamespace;
  readonly tx: TxNamespace;
  readonly kyc: KycNamespace;
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
      async recover(_email) {
        throw new RecoveryNotAvailableError();
      },
    }),
    [ctx],
  );

  const { hexToBytes, hexFromBytes } = useMemo(() => coderHelpers(), []);

  const wallet = useMemo<WalletNamespace>(
    () => ({
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

        // Crash-safety: persist the encrypted F1 + passkey metadata BEFORE
        // hitting the backend so a network failure does not orphan the
        // wallet. Only possible when the caller passed credentialId + prfSalt
        // — otherwise the DeviceStore can't store a complete record.
        const canPersist = Boolean(input.credentialId && input.prfSalt);
        if (canPersist) {
          await ctx.deviceStore.saveCredential({
            username: input.email,
            credentialId: input.credentialId!,
            secp256r1Pubkey: secp256r1Canonical,
            fragmentF1Encrypted: created.encryptedFragments[0],
            prfSalt: input.prfSalt!,
            fallbackKeyMaterial: new Uint8Array(0),
            walletAddress: null, // pending
            createdAt: Date.now(),
          });
        }

        const res = await ctx.endpoints.createWallet({
          appId: ctx.appId,
          pubkeyEd25519: hexFromBytes(created.publicKey),
          emailCommitment: hexFromBytes(created.emailCommitment),
          secp256r1Pubkey: hexFromBytes(secp256r1Canonical),
          fragmentF2: encodeFragmentToWire(created.encryptedFragments[1]),
          fragmentF3: encodeFragmentToWire(created.encryptedFragments[2]),
        });

        // Confirm the pending record with the deployed walletAddress.
        if (canPersist) {
          const existing = await ctx.deviceStore.loadCredential(input.email);
          if (existing) {
            await ctx.deviceStore.saveCredential({
              ...existing,
              walletAddress: res.walletAddress,
            });
          }
        }

        return {
          walletAddress: res.walletAddress,
          publicKey: created.publicKey,
        };
      },
      async ensureWallet(input) {
        // 1. Cheap idempotent metadata read. Backend dedupes by Cognito user.
        const remote = await ctx.endpoints.getWallet();
        if (remote) {
          return { walletAddress: remote.walletAddress, createdNow: false };
        }
        // 2. No wallet yet → run the full createWallet flow.
        const created = await this.createWallet(input);
        return {
          walletAddress: created.walletAddress,
          publicKey: created.publicKey,
          createdNow: true,
        };
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
        return all.filter((c) => c.walletAddress === null);
      },
      clearStoredCredential(username) {
        return ctx.deviceStore.deleteCredential(username);
      },
    }),
    [ctx, hexFromBytes],
  );

  const tx = useMemo<TxNamespace>(
    () => ({
      async signPayment(input) {
        // Reconstruct seed locally: combine plain F1 + decrypted F2.
        const reconstructed = reconstructFromPlainAndEncrypted({
          fragmentF1Plain: input.fragmentF1Plain,
          fragmentF2: { envelope: input.fragmentF2Envelope, key: input.fragmentF2Key },
        });
        const networkPassphrase = passphraseForEnv(ctx.env);
        const horizonUrl = horizonForEnv(ctx.env);
        const xdr = await buildPaymentTransaction({
          network: { networkPassphrase, horizonUrl },
          sourceAddress: input.sourceAddress,
          destinationAddress: input.destinationAddress,
          asset: input.asset,
          amount: input.amount,
          ...(input.memo ? { memo: input.memo } : {}),
        });
        return coreSignTransaction({
          transactionXdr: xdr,
          ed25519Seed: reconstructed.privateSeed,
          networkPassphrase,
          ...(input.expectedPublicKey ? { expectedPublicKey: input.expectedPublicKey } : {}),
        });
      },
      async signRawXdr(input) {
        return coreSignTransaction({
          transactionXdr: input.transactionXdr,
          ed25519Seed: input.ed25519Seed,
          networkPassphrase: passphraseForEnv(ctx.env),
          ...(input.expectedPublicKey ? { expectedPublicKey: input.expectedPublicKey } : {}),
        });
      },
    }),
    [ctx],
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
  return { auth, wallet, tx, kyc, session, settings, yieldOps, _internal: ctx };
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

function passphraseForEnv(env: 'dev' | 'staging' | 'prod'): string {
  if (env === 'prod') return 'Public Global Stellar Network ; September 2015';
  return 'Test SDF Network ; September 2015';
}

function horizonForEnv(env: 'dev' | 'staging' | 'prod'): string {
  if (env === 'prod') return 'https://horizon.stellar.org';
  return 'https://horizon-testnet.stellar.org';
}
