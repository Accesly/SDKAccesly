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
  normalizeSecp256r1Pubkey,
  reconstructFromPlainAndEncrypted,
  signSorobanAuthEntry,
  signTransaction as coreSignTransaction,
  unwrapSessionFragment2,
  type AuthStatus,
  type CredentialRecord,
  type EncryptedEnvelope,
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
 * Input para `tx.send(...)` — manda XLM desde el Smart Account del usuario a
 * cualquier address Stellar (G… clásico o C… contrato).
 *
 * El SDK orquesta todo el flujo: simulate → ECDH F2 → reconstruct seed →
 * sign auth entry → submit. El caller solo entrega los inputs sensibles que
 * vienen de su flow de unlock (WebAuthn PRF + derivación de F2 key).
 */
export interface SendXlmInput {
  /** Destinatario. G… (clásico) o C… (contrato). */
  readonly destinationAddress: string;
  /** Monto en STROOPS (1 XLM = 10_000_000 stroops). Base-10 string para evitar precisión. */
  readonly amountStroops: string;
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
   * Cierra el flujo de recovery. Tras éxito el `walletAddress` rotó sus
   * signers on-chain y el dispositivo nuevo tiene los fragmentos
   * persistidos. Pasar el password de Cognito en plano (UTF-8).
   *
   * El caller es responsable de zeroizar `cognitoPassword` después.
   */
  finalize(input: {
    email: string;
    cognitoPassword: Uint8Array;
    recoveryJwt: string;
  }): Promise<{ walletAddress: string; txHash: string }>;
}

export interface AcceslyHook {
  readonly auth: AuthNamespace;
  readonly wallet: WalletNamespace;
  readonly tx: TxNamespace;
  readonly kyc: KycNamespace;
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

        // Recovery v2: si el caller pasó `cognitoPassword`, generamos
        // un recoverySalt y re-ciframos F3 con `recoveryKey =
        // PBKDF2(password, recoverySalt, 600k)`. Esa key vive SOLO en
        // cliente — el backend recibe { F3_enc, recoverySalt } y nunca
        // puede descifrar sin el password.
        //
        // Para conseguir el F3 plaintext partimos del envelope que
        // `coreCreateWallet` produjo (cifrado con `encryptionKeys[2]`)
        // y lo descifrado in-place; luego lo re-ciframos. Si después
        // queremos optimizar, exponemos un flag en coreCreateWallet
        // para devolver F3 ya en claro.
        let fragmentF3ToSend = created.encryptedFragments[2];
        let recoverySaltBase64: string | undefined;
        if (input.cognitoPassword) {
          const recoverySalt = generateRecoverySalt();
          const f3Plain = decryptAesGcm(created.encryptedFragments[2], input.encryptionKeys[2]);
          const recoveryKey = deriveRecoveryKey({
            password: input.cognitoPassword,
            salt: recoverySalt,
          });
          try {
            fragmentF3ToSend = encryptAesGcm(f3Plain, recoveryKey);
          } finally {
            // No leak: zeroize la key derivada y la plaintext de F3.
            for (let i = 0; i < recoveryKey.length; i += 1) recoveryKey[i] = 0;
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
        const sim = await ctx.endpoints.simulateTx({
          amountStroops: input.amountStroops,
          destinationAddress: input.destinationAddress,
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
      async finalize(_input) {
        // Stub: el orchestrator full lo construirá el example en PR-F.
        // Cuando exista, este método tomará { email, cognitoPassword,
        // recoveryJwt } y devolverá { walletAddress, txHash } después de
        // ejecutar el flujo completo. Por ahora marcamos como pendiente.
        throw new NotImplementedYetError('recovery', 'finalize');
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
  return { auth, wallet, tx, kyc, recovery, session, settings, yieldOps, _internal: ctx };
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
