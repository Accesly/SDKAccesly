/**
 * `useBalance(walletAddress?)` — devuelve los balances XLM y USDC del Smart
 * Account con push real-time vía SSE.
 *
 * Si SSE está configurado (env tiene `walletStreamUrl` y `EventSource` existe),
 * el hook se suscribe al canal `balance` del `wallet-stream` Lambda y se
 * actualiza instantáneamente cuando cambia el balance on-chain.
 *
 * Fallback automático a polling cada 30s si SSE no está disponible (entorno
 * que no lo soporta o backend self-hosteado sin el endpoint).
 *
 * El `walletAddress` se auto-resuelve desde el `DeviceStore` si no se pasa
 * (cubrir el caso "wallet del user actual sin tener que pasarla a mano").
 *
 * **Shared store (2.2.2+):** todas las instancias del hook con el mismo
 * `walletAddress` comparten UNA suscripción SSE + UN polling. Sin esto, 3
 * componentes que muestren balance disparaban 3 fetches HTTP cada 10s.
 *
 * **Multi-asset (1.4.0+):** además de `stroops`/`xlm` (XLM) ahora devuelve
 * `usdc` (formatted) y `usdcAtomic` (micro-USDC, 1e-7). Backwards compat:
 * apps en 1.3 que solo leen `stroops`/`xlm` siguen funcionando sin cambios.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccesly } from './useAccesly.js';
import { ENVIRONMENT_DEFAULTS } from '../config.js';
import { subscribeToWalletEvent } from './walletSubscription.js';
import type { AcceslyContextValue } from '../context.js';

const POLL_FALLBACK_MS = 30_000;

function useStableRef<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

export interface UseBalanceResult {
  /** XLM en stroops (string base-10). `null` mientras se carga o no hay address. */
  readonly stroops: string | null;
  /** XLM formatted (sin trailing zeros). `null` mientras se carga. */
  readonly xlm: string | null;
  /** USDC formatted (sin trailing zeros). `null` mientras se carga o si el SAC nunca registró la cuenta. */
  readonly usdc: string | null;
  /** USDC en unidades atómicas (1e-7 USDC). `null` mientras se carga. */
  readonly usdcAtomic: string | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
  /** Fuerza fetch HTTP inmediato (útil tras una operación del user). */
  refresh(): Promise<void>;
}

/* ── Module-level shared store por walletAddress ──────────────────────────── */

interface BalanceState {
  stroops: string | null;
  xlm: string | null;
  usdc: string | null;
  usdcAtomic: string | null;
  isLoading: boolean;
  error: Error | null;
}

interface BalanceStore {
  state: BalanceState;
  refCount: number;
  intervalId: ReturnType<typeof setInterval> | null;
  unsubscribeSse: (() => void) | null;
  visibilityHandler: (() => void) | null;
  inFlight: Promise<void> | null;
  listeners: Set<(s: BalanceState) => void>;
}

const balanceStores = new Map<string, BalanceStore>();

const INITIAL_STATE: BalanceState = {
  stroops: null,
  xlm: null,
  usdc: null,
  usdcAtomic: null,
  isLoading: true,
  error: null,
};

function getBalanceStore(walletAddress: string): BalanceStore {
  let s = balanceStores.get(walletAddress);
  if (!s) {
    s = {
      state: { ...INITIAL_STATE },
      refCount: 0,
      intervalId: null,
      unsubscribeSse: null,
      visibilityHandler: null,
      inFlight: null,
      listeners: new Set(),
    };
    balanceStores.set(walletAddress, s);
  }
  return s;
}

function setState(store: BalanceStore, patch: Partial<BalanceState>) {
  store.state = { ...store.state, ...patch };
  for (const fn of store.listeners) fn(store.state);
}

async function fetchBalance(
  walletAddress: string,
  ctx: AcceslyContextValue,
): Promise<void> {
  const s = getBalanceStore(walletAddress);
  if (s.inFlight) return s.inFlight;
  s.inFlight = (async () => {
    try {
      const res = await ctx.endpoints.walletBalance(walletAddress);
      setState(s, {
        stroops: res.xlm.atomic ?? res.xlm.stroops ?? null,
        xlm: res.xlm.formatted ?? res.xlm.xlm ?? null,
        usdc: res.usdc?.formatted ?? null,
        usdcAtomic: res.usdc?.atomic ?? null,
        error: null,
        isLoading: false,
      });
    } catch (err) {
      setState(s, { error: err as Error, isLoading: false });
    } finally {
      s.inFlight = null;
    }
  })();
  return s.inFlight;
}

export function useBalance(walletAddress?: string | null): UseBalanceResult {
  const { wallet, _internal } = useAccesly();
  const username = _internal.username;

  const [resolvedAddress, setResolvedAddress] = useState<string | null>(walletAddress ?? null);

  // Resolver walletAddress si no fue pasado explícitamente.
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
  const ctxRef = useStableRef(_internal);

  // Snapshot del store + listener.
  const [snapshot, setSnapshot] = useState<BalanceState>(
    resolvedAddress ? getBalanceStore(resolvedAddress).state : INITIAL_STATE,
  );

  useEffect(() => {
    if (!resolvedAddress) {
      setSnapshot(INITIAL_STATE);
      return undefined;
    }

    const store = getBalanceStore(resolvedAddress);
    const listener = (next: BalanceState) => setSnapshot(next);
    store.listeners.add(listener);
    store.refCount += 1;

    // Sync inmediato si ya hay datos.
    listener(store.state);

    // Si somos el primer consumidor, arrancamos SSE + polling. Resto recibe
    // solo el snapshot del store.
    if (store.refCount === 1) {
      // Intentar SSE primero.
      const unsubscribe = subscribeToWalletEvent(
        streamUrl,
        resolvedAddress,
        'balance',
        (data: unknown) => {
          const d = data as Record<string, unknown>;
          const xlmField = d['xlm'];
          const patch: Partial<BalanceState> = { error: null, isLoading: false };
          if (xlmField && typeof xlmField === 'object') {
            const x = xlmField as { atomic?: string; formatted?: string };
            if (typeof x.atomic === 'string') patch.stroops = x.atomic;
            if (typeof x.formatted === 'string') patch.xlm = x.formatted;
          } else if (typeof xlmField === 'string') {
            patch.xlm = xlmField;
          }
          if (typeof d['stroops'] === 'string') patch.stroops = d['stroops'];
          const usdcField = d['usdc'];
          if (usdcField && typeof usdcField === 'object') {
            const u = usdcField as { atomic?: string; formatted?: string };
            if (typeof u.formatted === 'string') patch.usdc = u.formatted;
            if (typeof u.atomic === 'string') patch.usdcAtomic = u.atomic;
          }
          setState(store, patch);
        },
      );

      // Primer fetch HTTP — no esperar al primer push del SSE (puede tardar).
      void fetchBalance(resolvedAddress, ctxRef.current);

      if (unsubscribe) {
        store.unsubscribeSse = unsubscribe;
      } else {
        // SSE no disponible → polling cada 30s con visibility-aware skip.
        store.intervalId = setInterval(() => {
          if (typeof document !== 'undefined' && document.hidden) return;
          void fetchBalance(resolvedAddress, ctxRef.current);
        }, POLL_FALLBACK_MS);
        store.visibilityHandler = () => {
          if (typeof document !== 'undefined' && !document.hidden) {
            void fetchBalance(resolvedAddress, ctxRef.current);
          }
        };
        if (typeof document !== 'undefined') {
          document.addEventListener('visibilitychange', store.visibilityHandler);
        }
      }
    }

    return () => {
      store.listeners.delete(listener);
      store.refCount = Math.max(0, store.refCount - 1);
      if (store.refCount === 0) {
        if (store.unsubscribeSse) {
          store.unsubscribeSse();
          store.unsubscribeSse = null;
        }
        if (store.intervalId) {
          clearInterval(store.intervalId);
          store.intervalId = null;
        }
        if (store.visibilityHandler && typeof document !== 'undefined') {
          document.removeEventListener('visibilitychange', store.visibilityHandler);
          store.visibilityHandler = null;
        }
      }
    };
  }, [resolvedAddress, streamUrl, ctxRef]);

  const refresh = useCallback(async () => {
    if (!resolvedAddress) return;
    await fetchBalance(resolvedAddress, ctxRef.current);
  }, [resolvedAddress, ctxRef]);

  return {
    stroops: snapshot.stroops,
    xlm: snapshot.xlm,
    usdc: snapshot.usdc,
    usdcAtomic: snapshot.usdcAtomic,
    isLoading: snapshot.isLoading,
    error: snapshot.error,
    refresh,
  };
}
