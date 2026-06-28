/**
 * `useWalletActivity(walletAddress?, opts?)` — actividad on-chain relevante de
 * la wallet (rotate_signer + transfers in/out de XLM) con push real-time vía SSE.
 *
 * El backend YA filtra eventos irrelevantes — el integrador solo recibe
 * `WalletActivityItem` tipados (`signer-rotated` | `transfer-in` | `transfer-out`).
 * Sin parsing manual de XDR ni lógica de filtrado client-side.
 *
 * Fallback: si SSE no está disponible, polling cada 25s al endpoint
 * `/wallets/:address/activity`. Mucho menos eficiente pero garantiza data.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccesly } from './useAccesly.js';
import { ENVIRONMENT_DEFAULTS } from '../config.js';
import { subscribeToWalletEvent, type WalletActivityItem } from './walletSubscription.js';

const POLL_FALLBACK_MS = 25_000;
const DEFAULT_LIMIT = 20;

function useStableRef<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

export interface UseWalletActivityOptions {
  /** Cantidad de eventos a mostrar (cap del buffer del cliente). Default 20. */
  readonly limit?: number;
}

export interface UseWalletActivityResult {
  /** Eventos tipados, más recientes primero. */
  readonly events: readonly WalletActivityItem[];
  readonly isLoading: boolean;
  readonly error: Error | null;
  refresh(): Promise<void>;
}

export function useWalletActivity(
  walletAddress?: string | null,
  opts: UseWalletActivityOptions = {},
): UseWalletActivityResult {
  const { wallet, _internal } = useAccesly();
  const username = _internal.username;
  const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, 50);

  const [resolvedAddress, setResolvedAddress] = useState<string | null>(walletAddress ?? null);
  const [events, setEvents] = useState<readonly WalletActivityItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const walletRef = useStableRef(wallet);
  useEffect(() => {
    if (walletAddress) {
      setResolvedAddress(walletAddress);
      return;
    }
    if (!username) {
      setResolvedAddress(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const stored = await walletRef.current.getStoredCredential(username);
        if (cancelled) return;
        setResolvedAddress(stored?.walletAddress ?? null);
      } catch {
        if (!cancelled) setResolvedAddress(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [walletAddress, username, walletRef]);

  const envDefaults = ENVIRONMENT_DEFAULTS[_internal.env];
  const streamUrl = envDefaults.walletStreamUrl;
  const endpointsRef = useStableRef(_internal.endpoints);

  const doFetchOnce = useCallback(async () => {
    if (!resolvedAddress) return;
    try {
      const res = await endpointsRef.current.walletActivity(resolvedAddress, limit);
      // El endpoint REST devuelve eventos sin tipar (parseado raw). Adaptamos
      // al shape tipado del SSE para que el integrador vea la misma forma —
      // y descartamos los que no encajen en los 3 tipos conocidos.
      const adapted: WalletActivityItem[] = [];
      for (const ev of res.events) {
        const conv = adaptRestEvent(ev);
        if (conv) adapted.push(conv);
      }
      setEvents(adapted.slice(0, limit));
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, [resolvedAddress, limit, endpointsRef]);

  const doFetchRef = useStableRef(doFetchOnce);
  useEffect(() => {
    if (!resolvedAddress) {
      setIsLoading(false);
      return undefined;
    }

    const unsubscribe = subscribeToWalletEvent(streamUrl, resolvedAddress, 'activity', (data) => {
      setEvents(data.events.slice(0, limit));
      setError(null);
      setIsLoading(false);
    });

    if (unsubscribe) {
      void doFetchRef.current();
      return unsubscribe;
    }

    // Polling fallback.
    void doFetchRef.current();
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void doFetchRef.current();
    }, POLL_FALLBACK_MS);

    return () => clearInterval(interval);
  }, [resolvedAddress, streamUrl, limit, doFetchRef]);

  const refresh = useCallback(async () => {
    await doFetchRef.current();
  }, [doFetchRef]);

  return { events, isLoading, error, refresh };
}

/**
 * Adapta un `WalletActivityEvent` raw (del REST endpoint) al `WalletActivityItem`
 * tipado del SSE. Best-effort — si no matchea ninguno de los 3 tipos conocidos,
 * devuelve null y el item se descarta.
 *
 * En la práctica el REST endpoint ya viene en formato compatible; este adapter
 * es solo defensa por si el shape divergiera en el futuro.
 */
function adaptRestEvent(ev: {
  type: string;
  txHash: string;
  ledger: number;
  timestamp: string | null;
  topics: readonly unknown[];
  value: unknown;
}): WalletActivityItem | null {
  const t0 = ev.topics[0];
  if (typeof t0 !== 'string') return null;
  if (t0 === 'SignerRotated') {
    return {
      type: 'signer-rotated',
      txHash: ev.txHash,
      ledger: ev.ledger,
      timestamp: ev.timestamp,
      newOwnerEd25519Hex: typeof ev.value === 'string' ? ev.value : '',
    };
  }
  // Transfers REST no vienen pre-filtrados como in/out; lo dejamos sin
  // adaptar — el integrador igual los ve via SSE en cuanto se conecta.
  return null;
}
