'use client';

import { useCallback, useContext, useMemo, useState } from 'react';
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
 * el Smart Account del user (via backend `POST /session-keys`), y devuelve la
 * privateKey al caller para que la persista donde quiera (IndexedDB, LocalStorage,
 * subprocess memory).
 *
 * Uso típico: automatización sin passkey prompt (bots, subscriptions, background
 * signers). Después de `createSessionKey()`, el caller puede llamar
 * `tx.sendWithSessionKey({ sessionPrivateKey, ... })` en cualquier momento hasta
 * `validUntilLedger` sin biometría, respetando el spending limit configurado.
 *
 * No-custodial: el backend NUNCA ve la privateKey. El SDK la genera, la firma
 * con la rule admin-cfg (biometric prompt del owner), y solo persiste la pubkey
 * on-chain.
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
}

export interface UseSessionKeyResult {
  readonly isCreating: boolean;
  readonly error: Error | null;
  /**
   * Crea un session-key on-chain. Dispara un passkey prompt del owner para
   * firmar el `add_context_rule("session-key")` contra la rule admin-cfg.
   */
  createSessionKey(): Promise<SessionKeyResult>;
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
      // 1. Generamos el keypair session-key client-side. El backend NUNCA verá
      //    la privateKey — solo la pubkey.
      const sessionKeypair = generateKeypair();
      const sessionPubkeyHex = bytesToHex(sessionKeypair.publicKey);

      // 2. Passkey prompt del owner (biometric) para desbloquear el material
      //    F1/F2/ownerPubkey. Este es EL prompt del flow — después se firma
      //    off-line con el session-key sin biometría.
      const material = await wallet.unlockForSigning(auth.username);

      // 3. Backend simulate: arma `add_context_rule("session-key", ...)` +
      //    devuelve el placeholder auth entry para que firmemos con la seed
      //    del owner contra la rule admin-cfg.
      const sim = await ctx.endpoints.simulateSessionKey({ sessionPubkey: sessionPubkeyHex });

      // 4. Reconstruir la seed del owner via ECDH + Shamir (mismo flow que tx.send).
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

      // 5. Firmar la auth entry contra la rule admin-cfg (contextRuleIds vienen
      //    del simulate — usualmente [ruleId(admin-cfg)]).
      const { signedAuthEntryXdr } = await signSorobanAuthEntry({
        signaturePayloadHashBase64: sim.signaturePayloadHashBase64,
        contextRuleIds: [...sim.contextRuleIds],
        placeholderAuthEntryXdr: sim.placeholderAuthEntryXdr,
        ed25519Seed: reconstructed.privateSeed,
        ed25519VerifierAddress: stellarConfig.ed25519VerifierAddress,
        ownerPubkey: material.ownerPubkey,
      });

      // 6. Submit: backend re-simula con firma real + KMS-firma envelope +
      //    Soroban RPC submit + poll getTransaction hasta status='SUCCESS'.
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
      };
      return result;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      throw e;
    } finally {
      setIsCreating(false);
    }
  }, [ctx, auth.username, wallet, appConfig, stellarConfig]);

  return { isCreating, error, createSessionKey };
}

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

