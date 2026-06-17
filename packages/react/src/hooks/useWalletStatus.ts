/**
 * `useWalletStatus()` — status on-chain del Smart Account del user actual con
 * push real-time vía SSE.
 *
 * Reemplaza el polling cada 30s del legacy. Comportamiento:
 *
 *   1. SSE-first: si `walletStreamUrl` está configurado y `EventSource` existe,
 *      se suscribe al canal `status` del `wallet-stream` Lambda. Cero polling.
 *   2. Fallback a polling backoff (1s → 30s) si SSE no está disponible.
 *   3. Pausa cuando `document.hidden`, retoma al volver.
 *   4. `refresh()` fuerza fetch HTTP inmediato.
 *
 * El status del Smart Account vive en DDB (lo que el backend reporta de su
 * verificación contra Soroban). El backend push-ea cambios cuando los detecta
 * (cada 5s en el loop del wallet-stream).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccesly } from './useAccesly.js';
import { ENVIRONMENT_DEFAULTS } from '../config.js';
import { subscribeToWalletEvent } from './walletSubscription.js';

export type WalletStatusValue = 'on-chain' | 'pending-deploy' | 'unknown' | 'no-wallet';

const POLL_BACKOFF_MS = [2000, 5000, 10_000, 20_000, 30_000];
const STALE_THRESHOLD_MS = 60_000;

function useStableRef<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

export interface UseWalletStatusResult {
  readonly status: WalletStatusValue;
  readonly walletAddress: string | null;
  readonly onChain: boolean | null;
  readonly isStale: boolean;
  refresh(): Promise<void>;
}

function deriveStatus(onChain: boolean | null): WalletStatusValue {
  if (onChain === true) return 'on-chain';
  if (onChain === false) return 'pending-deploy';
  return 'unknown';
}

export function useWalletStatus(): UseWalletStatusResult {
  const { wallet, _internal } = useAccesly();
  const username = _internal.username;

  const [status, setStatus] = useState<WalletStatusValue>('unknown');
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [onChain, setOnChain] = useState<boolean | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<number>(0);
  const [isStale, setIsStale] = useState(false);

  const envDefaults = ENVIRONMENT_DEFAULTS[_internal.env];
  const streamUrl = envDefaults.walletStreamUrl;
  const walletRef = useStableRef(wallet);

  const doFetch = useCallback(async (): Promise<WalletStatusValue | null> => {
    if (!username) return null;
    try {
      const remote = await walletRef.current.fetchRemote();
      if (!remote) {
        setStatus('no-wallet');
        setWalletAddress(null);
        setOnChain(null);
        setLastSuccessAt(Date.now());
        setIsStale(false);
        return 'no-wallet';
      }
      const next = deriveStatus(remote.onChain);
      setStatus(next);
      setWalletAddress(remote.walletAddress);
      setOnChain(remote.onChain);
      setLastSuccessAt(Date.now());
      setIsStale(false);
      return next;
    } catch {
      return null;
    }
  }, [username, walletRef]);

  const doFetchRef = useStableRef(doFetch);

  useEffect(() => {
    if (!username) {
      setStatus('unknown');
      return undefined;
    }

    // Primer fetch HTTP para resolver walletAddress + status inicial.
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let backoffIndex = 0;

    const schedulePoll = (delayMs: number) => {
      if (cancelled) return;
      pollTimer = setTimeout(async () => {
        if (cancelled) return;
        if (typeof document !== 'undefined' && document.hidden) return;
        const next = await doFetchRef.current();
        if (next === 'on-chain' || next === 'no-wallet') return;
        backoffIndex = Math.min(backoffIndex + 1, POLL_BACKOFF_MS.length - 1);
        schedulePoll(POLL_BACKOFF_MS[backoffIndex]!);
      }, delayMs);
    };

    void (async () => {
      const initial = await doFetchRef.current();
      if (cancelled) return;
      if (initial === 'on-chain' || initial === 'no-wallet') return;

      // Intentar SSE.
      if (walletAddress) {
        unsubscribe = subscribeToWalletEvent(streamUrl, walletAddress, 'status', (data) => {
          setWalletAddress(data.walletAddress);
          setOnChain(data.onChain);
          setStatus(deriveStatus(data.onChain));
          setLastSuccessAt(Date.now());
          setIsStale(false);
        });
      }
      if (!unsubscribe) {
        // SSE no disponible → polling con backoff.
        backoffIndex = 0;
        schedulePoll(POLL_BACKOFF_MS[0]!);
      }
    })();

    const onVisibilityChange = () => {
      if (typeof document === 'undefined') return;
      if (!document.hidden && !unsubscribe) {
        void doFetchRef.current();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    const staleTimer = setInterval(() => {
      if (Date.now() - lastSuccessAt > STALE_THRESHOLD_MS && lastSuccessAt > 0) {
        setIsStale(true);
      }
    }, 30_000);

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
      if (pollTimer) clearTimeout(pollTimer);
      clearInterval(staleTimer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, streamUrl, walletAddress]);

  const refresh = useCallback(async () => {
    await doFetchRef.current();
  }, [doFetchRef]);

  return { status, walletAddress, onChain, isStale, refresh };
}
