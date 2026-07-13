'use client';

import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  generateKeypair,
  generateX25519Keypair,
  getAppNetwork,
  reconstructFromPlainAndEncrypted,
  signSorobanAuthEntry,
  unwrapSessionFragment2,
  type EncryptedEnvelope,
} from '@accesly/core';
import { AcceslyContext } from '../context.js';
import { ENVIRONMENT_DEFAULTS } from '../config.js';
import { useAccesly } from './useAccesly.js';
import { useAppConfig } from './useAppConfig.js';

/**
 * Fase 18 (2026-07-12) — `useSessionKey`.
 *
 * Genera un keypair ed25519 client-side, lo agrega como rule `session-key` en
 * el Smart Account del user (via backend `POST /session-keys`), y persiste
 * automáticamente el keypair + ruleId en IndexedDB (DB `accesly-session-keys`,
 * store `session_keys`, keyed por `username`) para que `tx.sendWithSessionKey`
 * pueda usarlo sin passkey prompt.
 *
 * Uso típico: automatización sin passkey prompt (bots, subscriptions,
 * background signers). Después de `createSessionKey()`, futuras calls a
 * `tx.sendWithSessionKey({...sessionKey})` firman sin biometría hasta
 * `validUntilLedger`, respetando el spending limit configurado.
 *
 * No-custodial: el backend NUNCA ve la privateKey. El SDK la genera, la firma
 * con la rule admin-cfg (biometric prompt del owner), y solo persiste la
 * pubkey on-chain. El seed vive en IndexedDB del browser del user.
 *
 * Gating: la app debe tener `walletDefaults.sessionKeyEnabled=true` en su
 * appConfig (dashboard `/apps/[appId]/settings`). Sin ese flag el backend
 * responde 403 `SESSION_KEYS_DISABLED_FOR_APP`.
 */
export interface SessionKeyResult {
  /** Hex 32 bytes — pubkey ed25519 del session key (indexable on-chain). */
  readonly sessionPubkeyHex: string;
  /** 32 bytes — pubkey ed25519 (bytes). Se pasa a `tx.sendWithSessionKey`. */
  readonly sessionPubkey: Uint8Array;
  /** 32 bytes — secret seed del session key. Persistir donde quiera el caller. */
  readonly sessionPrivateSeed: Uint8Array;
  readonly txHash: string;
  readonly validUntilLedger: number;
  /** Cap de gasto del session key en stroops. */
  readonly spendingLimitStroops: string;
  readonly periodLedgers: number;
  /**
   * ID de la rule `session-key` on-chain. Se pasa a
   * `tx.sendWithSessionKey({ sessionKeyRuleId })` para que Soroban __check_auth
   * evalúe la rule correcta. Puede venir `null` si el backend no logró
   * resolverlo post-apply — el caller debe fetchearlo por otro método.
   */
  readonly sessionKeyRuleId: number | null;
  /** ISO timestamp de creación (para UX / debugging). */
  readonly createdAt: string;
}

export interface UseSessionKeyResult {
  readonly isCreating: boolean;
  readonly error: Error | null;
  /**
   * Session key activo persistido para el `auth.username` actual, si existe.
   * `null` mientras carga o si no hay session key registrado.
   */
  readonly active: SessionKeyResult | null;
  readonly isLoadingActive: boolean;
  /**
   * Crea un session-key on-chain. Dispara un passkey prompt del owner para
   * firmar el `add_context_rule("session-key")` contra la rule admin-cfg.
   * Persiste automáticamente en IndexedDB al terminar.
   */
  createSessionKey(): Promise<SessionKeyResult>;
  /**
   * Elimina el session key local. NO revoca la rule on-chain — para eso hace
   * falta llamar `wallet.removeContextRule(ruleId)` explícitamente. Sirve
   * cuando el user cambia de device o cierra sesión.
   */
  clearSessionKey(): Promise<void>;
}

export function useSessionKey(): UseSessionKeyResult {
  const ctx = useContext(AcceslyContext);
  if (!ctx) {
    throw new Error('useSessionKey must be used inside <AcceslyProvider>');
  }
  const { auth, wallet } = useAccesly();
  const { config: appConfig } = useAppConfig();

  const stellarConfig = useMemo(() => {
    const envDefaults = ENVIRONMENT_DEFAULTS[ctx.env];
    if (!appConfig) return envDefaults.stellar;
    try {
      const net = getAppNetwork(appConfig);
      if (net === 'mainnet' && envDefaults.stellarMainnet) {
        return envDefaults.stellarMainnet;
      }
    } catch {
      // network ambiguo — cae al default.
    }
    return envDefaults.stellar;
  }, [appConfig, ctx.env]);

  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [active, setActive] = useState<SessionKeyResult | null>(null);
  const [isLoadingActive, setIsLoadingActive] = useState(true);

  // Load persisted session key al mount / cuando cambia username.
  useEffect(() => {
    let cancelled = false;
    if (!auth.username) {
      setActive(null);
      setIsLoadingActive(false);
      return;
    }
    setIsLoadingActive(true);
    loadPersistedSessionKey(auth.username)
      .then((sk) => {
        if (!cancelled) {
          setActive(sk);
          setIsLoadingActive(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setActive(null);
          setIsLoadingActive(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [auth.username]);

  const createSessionKey = useCallback(async (): Promise<SessionKeyResult> => {
    if (!auth.username) {
      const err = new Error('useSessionKey: no authenticated session — sign in first.');
      setError(err);
      throw err;
    }
    const walletDefaults = (appConfig as { walletDefaults?: { sessionKeyEnabled?: boolean } } | null)
      ?.walletDefaults;
    if (!walletDefaults?.sessionKeyEnabled) {
      const err = new Error(
        'useSessionKey: session keys are not enabled for this app. ' +
          'Enable them in the dashboard: /apps/[appId]/settings → Wallet defaults.',
      );
      setError(err);
      throw err;
    }

    setIsCreating(true);
    setError(null);

    try {
      const sessionKeypair = generateKeypair();
      const sessionPubkeyHex = bytesToHex(sessionKeypair.publicKey);

      const material = await wallet.unlockForSigning(auth.username);

      const sim = await ctx.endpoints.simulateSessionKey({ sessionPubkey: sessionPubkeyHex });

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
        fragmentF1Plain: material.fragmentF1Plain,
        fragmentF2: { envelope: fragmentF2Envelope, key: material.fragmentF2Key },
      });

      const { signedAuthEntryXdr } = await signSorobanAuthEntry({
        signaturePayloadHashBase64: sim.signaturePayloadHashBase64,
        contextRuleIds: [...sim.contextRuleIds],
        placeholderAuthEntryXdr: sim.placeholderAuthEntryXdr,
        ed25519Seed: reconstructed.privateSeed,
        ed25519VerifierAddress: stellarConfig.ed25519VerifierAddress,
        ownerPubkey: material.ownerPubkey,
      });

      const submit = await ctx.endpoints.submitSessionKey({
        unsignedXdr: sim.unsignedXdr,
        signedAuthEntryXdr,
        sessionPubkey: sessionPubkeyHex,
      });

      const result: SessionKeyResult = {
        sessionPubkeyHex,
        sessionPubkey: sessionKeypair.publicKey,
        sessionPrivateSeed: sessionKeypair.privateSeed,
        txHash: submit.txHash,
        validUntilLedger: sim.validUntilLedger,
        spendingLimitStroops: submit.spendingLimitStroops,
        periodLedgers: submit.periodLedgers,
        sessionKeyRuleId: submit.sessionKeyRuleId ?? null,
        createdAt: new Date().toISOString(),
      };

      // Auto-persist en IndexedDB para que sobreviva reloads del browser.
      try {
        await persistSessionKey(auth.username, result);
      } catch {
        // No-fatal: el session key ya está on-chain. Sin persist el user
        // tendría que recrearlo tras un reload; loggeamos y seguimos.
      }
      setActive(result);
      return result;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      throw e;
    } finally {
      setIsCreating(false);
    }
  }, [ctx, auth.username, wallet, appConfig, stellarConfig]);

  const clearSessionKey = useCallback(async (): Promise<void> => {
    if (!auth.username) return;
    try {
      await deletePersistedSessionKey(auth.username);
    } finally {
      setActive(null);
    }
  }, [auth.username]);

  return { isCreating, error, active, isLoadingActive, createSessionKey, clearSessionKey };
}

// ─── IndexedDB persistence ──────────────────────────────────────────────────
//
// DB separada de la de credentials (`accesly` / `credentials`) para no romper
// migraciones existentes. Store `session_keys` keyed por `username`.

const SK_DB_NAME = 'accesly-session-keys';
const SK_DB_VERSION = 1;
const SK_STORE = 'session_keys';

interface PersistedRecord {
  readonly username: string;
  readonly sessionPubkeyHex: string;
  readonly sessionPubkey: Uint8Array;
  readonly sessionPrivateSeed: Uint8Array;
  readonly txHash: string;
  readonly validUntilLedger: number;
  readonly spendingLimitStroops: string;
  readonly periodLedgers: number;
  readonly sessionKeyRuleId: number | null;
  readonly createdAt: string;
}

async function persistSessionKey(username: string, sk: SessionKeyResult): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openSkDb();
  try {
    const record: PersistedRecord = {
      username,
      sessionPubkeyHex: sk.sessionPubkeyHex,
      sessionPubkey: sk.sessionPubkey,
      sessionPrivateSeed: sk.sessionPrivateSeed,
      txHash: sk.txHash,
      validUntilLedger: sk.validUntilLedger,
      spendingLimitStroops: sk.spendingLimitStroops,
      periodLedgers: sk.periodLedgers,
      sessionKeyRuleId: sk.sessionKeyRuleId,
      createdAt: sk.createdAt,
    };
    await runSkTx(db, 'readwrite', (store) => store.put(record));
  } finally {
    db.close();
  }
}

async function loadPersistedSessionKey(username: string): Promise<SessionKeyResult | null> {
  if (typeof indexedDB === 'undefined') return null;
  const db = await openSkDb();
  try {
    const raw = await runSkTx<PersistedRecord | undefined>(db, 'readonly', (store) =>
      store.get(username),
    );
    if (!raw) return null;
    return {
      sessionPubkeyHex: raw.sessionPubkeyHex,
      sessionPubkey: raw.sessionPubkey,
      sessionPrivateSeed: raw.sessionPrivateSeed,
      txHash: raw.txHash,
      validUntilLedger: raw.validUntilLedger,
      spendingLimitStroops: raw.spendingLimitStroops,
      periodLedgers: raw.periodLedgers,
      sessionKeyRuleId: raw.sessionKeyRuleId,
      createdAt: raw.createdAt,
    };
  } finally {
    db.close();
  }
}

async function deletePersistedSessionKey(username: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openSkDb();
  try {
    await runSkTx(db, 'readwrite', (store) => store.delete(username));
  } finally {
    db.close();
  }
}

function openSkDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SK_DB_NAME, SK_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SK_STORE)) {
        db.createObjectStore(SK_STORE, { keyPath: 'username' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

function runSkTx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(SK_STORE, mode);
    const store = tx.objectStore(SK_STORE);
    const request = op(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}

// ─── Utility helpers ────────────────────────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += (bytes[i] ?? 0).toString(16).padStart(2, '0');
  }
  return hex;
}

function base64FromBytes(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
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
