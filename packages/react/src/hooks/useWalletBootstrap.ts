'use client';

import { useContext, useEffect, useState } from 'react';
import { AcceslyContext } from '../context.js';
import { ENVIRONMENT_DEFAULTS } from '../config.js';
import {
  subscribeToWalletEvent,
  type WalletStreamBootstrapPayload,
} from './walletSubscription.js';
import { useAppConfig } from './useAppConfig.js';
import { getAppNetwork } from '@accesly/core';

/**
 * `useWalletBootstrap` — Fase 17 (2026-07-11).
 *
 * Devuelve el estado del bootstrap de la wallet actual del user. Post-Fase 17
 * el POST /wallets responde 202 con `status: 'bootstrapping'` — la wallet
 * está deployada pero el bootstrap corre en el worker asíncrono. Este hook
 * suscribe al `wallet-stream` SSE y expone el status en tiempo real.
 *
 * Estados:
 *   - `'unknown'`: aún no sabemos, la wallet no está registrada, o SSE no
 *     está disponible (SSR / cliente sin EventSource). Fallback: asumir
 *     ready si `wallet.address` existe (compat con wallets pre-Fase-17).
 *   - `'bootstrapping'`: worker en proceso. UI debe mostrar spinner.
 *   - `'ready'`: bootstrap aplicado. Wallet lista para firmar.
 *
 * Uso típico en el kit `<CreateWalletFlow>`:
 *
 *   const { status, txHash } = useWalletBootstrap(walletAddress);
 *   if (status === 'bootstrapping') return <ConfiguringSpinner />;
 *   if (status === 'ready') return <WalletHome />;
 *
 * Integradores custom pueden gatear cualquier operación de firma (send,
 * swap, activate-asset) hasta que este hook devuelva `'ready'`.
 */
export interface UseWalletBootstrapResult {
  readonly status: 'unknown' | 'bootstrapping' | 'ready';
  /** Hash del bootstrap tx cuando `status === 'ready'`. */
  readonly txHash?: string;
  /** Cuántos intentos hizo el worker (útil para métricas / debug). */
  readonly attemptCount?: number;
}

export function useWalletBootstrap(
  walletAddress: string | null | undefined,
): UseWalletBootstrapResult {
  const ctx = useContext(AcceslyContext);
  const { config: appConfig } = useAppConfig();
  const [state, setState] = useState<UseWalletBootstrapResult>({ status: 'unknown' });

  useEffect(() => {
    if (!walletAddress || !ctx) return;

    // Detectar la stream URL activa (igual patrón que useWalletStatus).
    const envDefaults = ENVIRONMENT_DEFAULTS[ctx.env];
    const network = appConfig ? getAppNetwork(appConfig) : 'testnet';
    const streamUrl =
      network === 'mainnet' && envDefaults.stellarMainnet
        ? envDefaults.walletStreamUrl
        : envDefaults.walletStreamUrl;

    const cleanup = subscribeToWalletEvent(
      streamUrl,
      walletAddress,
      'bootstrap',
      (payload: WalletStreamBootstrapPayload) => {
        setState({
          status: payload.status,
          ...(payload.txHash ? { txHash: payload.txHash } : {}),
          ...(payload.attemptCount !== undefined
            ? { attemptCount: payload.attemptCount }
            : {}),
        });
      },
    );

    return () => {
      if (cleanup) cleanup();
    };
  }, [walletAddress, ctx, appConfig]);

  return state;
}
