'use client';

import { useContext, useEffect, useState } from 'react';
import type { AppConfigResponse } from '@accesly/core';
import { AcceslyContext, type AcceslyContextValue } from '../context.js';

/**
 * Polling interval for `useAppConfig`. Matches the `Cache-Control: max-age=60`
 * header the backend serves. Branding / trustlines / policies updates the
 * developer makes from `dev.accesly.xyz` propagate to running clients in
 * at most this many milliseconds.
 */
const REFETCH_INTERVAL_MS = 60_000;

export interface UseAppConfigResult {
  readonly config: AppConfigResponse | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
  refresh(): Promise<void>;
}

/* ── Module-level shared store ────────────────────────────────────────────── */
/**
 * Cache compartido por `appId`. Si 5 componentes del árbol llaman
 * `useAppConfig()` (directa o vía hooks derivados: `useBranding`,
 * `useAuthProviders`, `useKycPolicy`, `useSpendingPolicy`), todos
 * comparten un único polling + un único snapshot.
 *
 * Sin esto, cada hook crea su propio `setInterval(60s)` y dispara
 * fetches independientes — bloating de tráfico que se vuelve visible
 * apenas la UI mete 3+ pantallas que dependen del config.
 */
interface AppConfigStore {
  config: AppConfigResponse | null;
  isLoading: boolean;
  error: Error | null;
  refCount: number;
  intervalId: ReturnType<typeof setInterval> | null;
  inFlight: Promise<void> | null;
  visibilityHandler: (() => void) | null;
  listeners: Set<(s: AppConfigStore) => void>;
}

const stores = new Map<string, AppConfigStore>();

function getStore(appId: string): AppConfigStore {
  let s = stores.get(appId);
  if (!s) {
    s = {
      config: null,
      isLoading: true,
      error: null,
      refCount: 0,
      intervalId: null,
      inFlight: null,
      visibilityHandler: null,
      listeners: new Set(),
    };
    stores.set(appId, s);
  }
  return s;
}

function notify(s: AppConfigStore) {
  for (const fn of s.listeners) fn(s);
}

async function doFetch(appId: string, ctx: AcceslyContextValue): Promise<void> {
  const s = getStore(appId);
  if (s.inFlight) return s.inFlight;
  s.inFlight = (async () => {
    try {
      const result = await ctx.endpoints.appConfig(appId);
      s.config = result;
      s.error = null;
    } catch (err) {
      // Preservamos el último config bueno — la UI no parpadea por errores
      // transientes (rate limit, RPC blip, etc.).
      s.error = err instanceof Error ? err : new Error(String(err));
    } finally {
      s.isLoading = false;
      s.inFlight = null;
      notify(s);
    }
  })();
  return s.inFlight;
}

/**
 * Phase 1 (2026-06-28) — reads the appConfig that the developer authored
 * from `dev.accesly.xyz`. Refetches every 60s and on `visibilitychange:visible`
 * so a developer flipping a toggle on the dashboard sees it on the running
 * client within the minute.
 *
 * Returns `null` config while the first fetch is in flight; consumers should
 * branch on `isLoading` for the initial state. On error, the previous config
 * (if any) is kept so the UI doesn't flicker — the SDK can fall back to its
 * own defaults via the `branding` / `trustlines` getters in derived hooks.
 *
 * El hook usa un store module-level por `appId` — todas las instancias del
 * componente que llamen este hook (o derivados) comparten un único polling
 * y un único snapshot.
 */
export function useAppConfig(): UseAppConfigResult {
  const ctx = useContext(AcceslyContext);
  if (!ctx) {
    throw new Error('useAppConfig must be used inside <AcceslyProvider>');
  }

  const s = getStore(ctx.appId);
  const [snapshot, setSnapshot] = useState({
    config: s.config,
    isLoading: s.isLoading,
    error: s.error,
  });

  useEffect(() => {
    const store = getStore(ctx.appId);
    const listener = (next: AppConfigStore) => {
      setSnapshot({ config: next.config, isLoading: next.isLoading, error: next.error });
    };
    store.listeners.add(listener);
    store.refCount += 1;

    // Primer fetch: solo si todavía no hay config cargada. Re-mounts no disparan
    // un fetch extra; reciben el snapshot actual del store.
    if (!store.config && !store.inFlight) {
      void doFetch(ctx.appId, ctx);
    } else {
      // Sync inmediato del estado actual al snapshot local (puede haber datos del store ya cargados).
      listener(store);
    }

    // Único polling para todo el árbol — solo lo arrancamos cuando aparece
    // el primer consumidor.
    if (store.refCount === 1 && !store.intervalId) {
      store.intervalId = setInterval(() => {
        void doFetch(ctx.appId, ctx);
      }, REFETCH_INTERVAL_MS);
      store.visibilityHandler = () => {
        if (document.visibilityState === 'visible') void doFetch(ctx.appId, ctx);
      };
      document.addEventListener('visibilitychange', store.visibilityHandler);
    }

    return () => {
      store.listeners.delete(listener);
      store.refCount = Math.max(0, store.refCount - 1);
      // Si nadie está suscrito, detenemos el polling y liberamos los handlers
      // — el snapshot queda en memoria por si vuelve a montarse, evitando un
      // fetch extra en navegación rápida.
      if (store.refCount === 0) {
        if (store.intervalId) {
          clearInterval(store.intervalId);
          store.intervalId = null;
        }
        if (store.visibilityHandler) {
          document.removeEventListener('visibilitychange', store.visibilityHandler);
          store.visibilityHandler = null;
        }
      }
    };
  }, [ctx]);

  return {
    config: snapshot.config,
    isLoading: snapshot.isLoading,
    error: snapshot.error,
    refresh: async () => {
      await doFetch(ctx.appId, ctx);
    },
  };
}
