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
  computeSmartAccountAddress,
  createWallet as coreCreateWallet,
  normalizeSecp256r1Pubkey,
  reconstructFromPlainAndEncrypted,
  signTransaction as coreSignTransaction,
  type AuthStatus,
  type CredentialRecord,
  type EncryptedEnvelope,
} from '@accesly/core';
import { AcceslyContext, type AcceslyContextValue } from '../context.js';
import { ENVIRONMENT_DEFAULTS } from '../config.js';

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

export interface WalletNamespace {
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
    }): Promise<string> => {
      const res = await c.endpoints.createWallet({
        appId: c.appId,
        pubkeyEd25519: hexFromBytes(params.pubkeyEd25519),
        emailCommitment: hexFromBytes(params.emailCommitment),
        secp256r1Pubkey: hexFromBytes(params.secp256r1Pubkey),
        fragmentF2: encodeFragmentToWire(params.fragmentF2),
        fragmentF3: encodeFragmentToWire(params.fragmentF3),
      });
      return res.walletAddress;
    };

    const statusFromOnChain = (onChain: boolean | null): WalletStatus => {
      if (onChain === true) return 'on-chain';
      if (onChain === false) return 'pending-deploy';
      return 'unknown';
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

        // Pre-compute the deterministic walletAddress. Same algorithm Stellar
        // Core / the backend will use — we can show it to the user before
        // any network round-trip and reconcile later.
        const predictedAddress = await computeSmartAccountAddress({
          ownerPubkey: created.publicKey,
          deployerAddress: stellarConfig.deployerAddress,
          networkPassphrase: stellarConfig.networkPassphrase,
        });

        // Crash-safety + retry capability: persist the full record BEFORE
        // hitting the backend. Includes all 3 encrypted fragments + pubkey
        // + emailCommitment so `wallet.retryDeploy(username)` can re-POST
        // without regenerating the keypair.
        const canPersist = Boolean(input.credentialId && input.prfSalt);
        if (canPersist) {
          await ctx.deviceStore.saveCredential({
            username: input.email,
            credentialId: input.credentialId!,
            secp256r1Pubkey: secp256r1Canonical,
            fragmentF1Encrypted: created.encryptedFragments[0],
            fragmentF2Encrypted: created.encryptedFragments[1],
            fragmentF3Encrypted: created.encryptedFragments[2],
            publicKey: created.publicKey,
            emailCommitment: created.emailCommitment,
            prfSalt: input.prfSalt!,
            fallbackKeyMaterial: new Uint8Array(0),
            walletAddress: predictedAddress,
            onChain: null,
            createdAt: Date.now(),
          });
        }

        const confirmedAddress = await postWallet({
          pubkeyEd25519: created.publicKey,
          emailCommitment: created.emailCommitment,
          secp256r1Pubkey: secp256r1Canonical,
          fragmentF2: created.encryptedFragments[1],
          fragmentF3: created.encryptedFragments[2],
        });

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
              onChain: existing.onChain ?? null, // unchanged until ensureWallet polls
            });
          }
        }

        return {
          walletAddress: confirmedAddress,
          publicKey: created.publicKey,
        };
      },

      async ensureWallet(input) {
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
              return {
                walletAddress: retried.walletAddress,
                status: retried.status,
                createdNow: false,
              };
            } catch {
              return {
                walletAddress: remote.walletAddress,
                status: 'pending-deploy',
                createdNow: false,
              };
            }
          }

          return {
            walletAddress: remote.walletAddress,
            status: statusFromOnChain(remote.onChain),
            createdNow: false,
          };
        }

        // 2. No wallet at the backend — first-time flow.
        const created = await this.createWallet(input);
        return {
          walletAddress: created.walletAddress,
          publicKey: created.publicKey,
          // POST succeeded but the next on-chain check needs another GET to
          // confirm; surface as pending-deploy until then.
          status: 'pending-deploy',
          createdNow: true,
        };
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
    };
  }, [ctx, hexFromBytes, stellarConfig]);

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
