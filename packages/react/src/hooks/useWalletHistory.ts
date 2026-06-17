/**
 * `useWalletHistory(walletAddress?, opts?)` — historial completo de la wallet
 * pre-decodificado desde Stellar Expert (indexer free, full retention).
 *
 * El backend de Accesly **proxea** las requests a Stellar Expert porque SE
 * bloquea CORS desde browsers (Cloudflare retorna 403 en cross-origin). El
 * proxy hace el call server-side, decodea topics + amounts, y devuelve items
 * tipados listos para renderizar.
 *
 * Features:
 *  - Cache en `localStorage` per-wallet con TTL 12h → render instantáneo en
 *    reloads + navegación.
 *  - Polling cada 30s para nuevos events. Pausa si tab oculta.
 *  - `BroadcastChannel` cross-tab para compartir fetches — solo UN tab hace
 *    el request, los demás escuchan el resultado vía canal.
 *  - Optimistic updates: el SDK inserta el item al instante cuando `tx.send`
 *    confirma, sin esperar el indexing de SE (~30-60s típico).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WalletHistoryItem } from '@accesly/core';
import { useAccesly } from './useAccesly.js';
import type { WalletActivityItem } from './walletSubscription.js';

const POLL_INTERVAL_MS = 30_000;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const CACHE_KEY_PREFIX = 'accesly:history:';
const BROADCAST_CHANNEL_PREFIX = 'accesly:history:';

function useStableRef<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

interface Cursors {
  readonly smartAccount: string | null;
  readonly transfers: string | null;
}

interface CacheEntry {
  readonly items: WalletHistoryItem[];
  readonly cursors: Cursors;
  readonly storedAt: number;
}

function loadCache(walletAddress: string): CacheEntry | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + walletAddress);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (Date.now() - parsed.storedAt > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCache(walletAddress: string, entry: CacheEntry): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CACHE_KEY_PREFIX + walletAddress, JSON.stringify(entry));
  } catch {
    /* quota / disabled — no-op */
  }
}

/* ── Optimistic update store ─────────────────────────────────────────────── */

const optimisticItems = new Map<string, WalletHistoryItem[]>();
const optimisticListeners = new Map<string, Set<(items: WalletHistoryItem[]) => void>>();

/**
 * Inyecta un item de history "optimistically" — útil cuando acabás de hacer
 * `tx.send` y querés que aparezca al instante sin esperar el indexing de SE.
 * El item queda hasta que el próximo fetch confirma que ya está en el feed.
 */
export function historyOptimisticPush(
  walletAddress: string,
  item: WalletHistoryItem | WalletActivityItem,
): void {
  const current = optimisticItems.get(walletAddress) ?? [];
  optimisticItems.set(walletAddress, [item as WalletHistoryItem, ...current]);
  const listeners = optimisticListeners.get(walletAddress);
  if (listeners) {
    for (const fn of listeners) fn(optimisticItems.get(walletAddress) ?? []);
  }
}

export function historyClearOptimistic(walletAddress: string): void {
  optimisticItems.delete(walletAddress);
  const listeners = optimisticListeners.get(walletAddress);
  if (listeners) {
    for (const fn of listeners) fn([]);
  }
}

function subscribeOptimistic(
  walletAddress: string,
  listener: (items: WalletHistoryItem[]) => void,
): () => void {
  let set = optimisticListeners.get(walletAddress);
  if (!set) {
    set = new Set();
    optimisticListeners.set(walletAddress, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) optimisticListeners.delete(walletAddress);
  };
}

/* ── Hook ─────────────────────────────────────────────────────────────────── */

export interface UseWalletHistoryOptions {
  /** Intervalo de poll para nuevos events (ms). Default 30s, 0 desactiva. */
  readonly pollIntervalMs?: number;
  /**
   * Cuántos transfers del XLM_SAC scan-ear por fetch. Default 50, max 500
   * (5 paginated calls). En testnet hay millones de transfers globalmente; si
   * tu wallet tiene pocos transfers, sube este número para encontrarlos.
   */
  readonly transferScanLimit?: number;
}

export interface UseWalletHistoryResult {
  readonly events: readonly WalletHistoryItem[];
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly hasMore: boolean;
  loadMore(): Promise<void>;
  refresh(): Promise<void>;
}

export function useWalletHistory(
  walletAddress?: string | null,
  opts: UseWalletHistoryOptions = {},
): UseWalletHistoryResult {
  const { wallet, _internal } = useAccesly();
  const username = _internal.username;

  const [resolvedAddress, setResolvedAddress] = useState<string | null>(walletAddress ?? null);
  const [events, setEvents] = useState<WalletHistoryItem[]>([]);
  const [optimistic, setOptimistic] = useState<WalletHistoryItem[]>([]);
  const [cursors, setCursors] = useState<Cursors>({ smartAccount: null, transfers: null });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(true);

  // Resolver address.
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

  // Optimistic items.
  useEffect(() => {
    if (!resolvedAddress) return undefined;
    setOptimistic(optimisticItems.get(resolvedAddress) ?? []);
    return subscribeOptimistic(resolvedAddress, setOptimistic);
  }, [resolvedAddress]);

  // Cache + primer fetch.
  const endpointsRef = useStableRef(_internal.endpoints);
  // Default 1500 events scan (= 30 pages * 50). El XLM_SAC del testnet tiene
  // mucha actividad global, hay que scan-ear varios cientos para encontrar
  // transfers del wallet específico. Cap por Lambda budget ≈ 30s.
  const transferScanLimit = opts.transferScanLimit ?? 1500;

  useEffect(() => {
    if (!resolvedAddress) {
      setIsLoading(false);
      return undefined;
    }

    // Replay cache.
    const cached = loadCache(resolvedAddress);
    if (cached) {
      setEvents(cached.items);
      setCursors(cached.cursors);
      setIsLoading(false);
    }

    let cancelled = false;
    const channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(BROADCAST_CHANNEL_PREFIX + resolvedAddress)
        : null;

    if (channel) {
      channel.onmessage = (ev) => {
        const data = ev.data as CacheEntry | undefined;
        if (data && !cancelled) {
          setEvents(data.items);
          setCursors(data.cursors);
          setIsLoading(false);
        }
      };
    }

    void (async () => {
      try {
        const result = await endpointsRef.current.walletHistory(resolvedAddress, {
          transferScanLimit,
        });
        if (cancelled) return;
        const deduped = dedupItems(result.events as WalletHistoryItem[]);
        setEvents(deduped);
        setCursors(result.cursors);
        setIsLoading(false);
        setError(null);
        setHasMore(result.cursors.smartAccount !== null || result.cursors.transfers !== null);

        const entry: CacheEntry = {
          items: deduped,
          cursors: result.cursors,
          storedAt: Date.now(),
        };
        saveCache(resolvedAddress, entry);
        channel?.postMessage(entry);
      } catch (err) {
        if (!cancelled) {
          setError(err as Error);
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      channel?.close();
    };
  }, [resolvedAddress, transferScanLimit, endpointsRef]);

  // Polling.
  const interval = opts.pollIntervalMs ?? POLL_INTERVAL_MS;
  useEffect(() => {
    if (!resolvedAddress || interval === 0) return undefined;

    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const result = await endpointsRef.current.walletHistory(resolvedAddress, {
          transferScanLimit,
        });
        setEvents((prev) => mergeAndDedup(prev, result.events as WalletHistoryItem[]));
        // Limpiar optimistics ya confirmados.
        const realTxHashes = new Set(result.events.map((it) => it.eventToid));
        const current = optimisticItems.get(resolvedAddress) ?? [];
        const remaining = current.filter((it) => !realTxHashes.has(it.eventToid));
        if (remaining.length !== current.length) {
          optimisticItems.set(resolvedAddress, remaining);
          const listeners = optimisticListeners.get(resolvedAddress);
          if (listeners) for (const fn of listeners) fn(remaining);
        }
      } catch {
        /* silenciar errores del polling */
      }
    };

    const id = setInterval(tick, interval);
    return () => clearInterval(id);
  }, [resolvedAddress, interval, transferScanLimit, endpointsRef]);

  const loadMoreImpl = useCallback(async () => {
    if (!resolvedAddress) return;
    if (!cursors.smartAccount && !cursors.transfers) {
      setHasMore(false);
      return;
    }
    try {
      const result = await endpointsRef.current.walletHistory(resolvedAddress, {
        ...(cursors.smartAccount ? { smartAccountCursor: cursors.smartAccount } : {}),
        ...(cursors.transfers ? { transfersCursor: cursors.transfers } : {}),
        transferScanLimit,
      });
      setEvents((prev) => mergeAndDedup(prev, result.events as WalletHistoryItem[]));
      setCursors(result.cursors);
      setHasMore(result.cursors.smartAccount !== null || result.cursors.transfers !== null);
    } catch (err) {
      setError(err as Error);
    }
  }, [resolvedAddress, cursors, transferScanLimit, endpointsRef]);

  const refreshImpl = useCallback(async () => {
    if (!resolvedAddress) return;
    setIsLoading(true);
    try {
      const result = await endpointsRef.current.walletHistory(resolvedAddress, {
        transferScanLimit,
      });
      const deduped = dedupItems(result.events as WalletHistoryItem[]);
      setEvents(deduped);
      setCursors(result.cursors);
      setError(null);
      saveCache(resolvedAddress, {
        items: deduped,
        cursors: result.cursors,
        storedAt: Date.now(),
      });
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, [resolvedAddress, transferScanLimit, endpointsRef]);

  // Combinar optimistic items con events reales.
  const combined = [...optimistic, ...events];

  return {
    events: combined,
    isLoading,
    error,
    hasMore,
    loadMore: loadMoreImpl,
    refresh: refreshImpl,
  };
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function dedupItems(items: WalletHistoryItem[]): WalletHistoryItem[] {
  const seen = new Set<string>();
  const out: WalletHistoryItem[] = [];
  for (const item of items) {
    const key = `${item.type}:${item.eventToid}:${item.ledger}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  out.sort((a, b) => b.ledger - a.ledger);
  return out;
}

function mergeAndDedup(
  prev: readonly WalletHistoryItem[],
  fresh: readonly WalletHistoryItem[],
): WalletHistoryItem[] {
  return dedupItems([...fresh, ...prev]);
}
