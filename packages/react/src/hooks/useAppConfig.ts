'use client';

import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { AppConfigResponse } from '@accesly/core';
import { AcceslyContext } from '../context.js';

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
 */
export function useAppConfig(): UseAppConfigResult {
  const ctx = useContext(AcceslyContext);
  if (!ctx) {
    throw new Error('useAppConfig must be used inside <AcceslyProvider>');
  }

  const [config, setConfig] = useState<AppConfigResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const cancelledRef = useRef(false);

  const fetcher = useCallback(async () => {
    try {
      const result = await ctx.endpoints.appConfig(ctx.appId);
      if (cancelledRef.current) return;
      setConfig(result);
      setError(null);
    } catch (err) {
      if (cancelledRef.current) return;
      setError(err instanceof Error ? err : new Error(String(err)));
      // Keep the last good config — don't blank the UI on transient errors.
    } finally {
      if (!cancelledRef.current) setIsLoading(false);
    }
  }, [ctx]);

  useEffect(() => {
    cancelledRef.current = false;
    void fetcher();

    const interval = window.setInterval(() => {
      void fetcher();
    }, REFETCH_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void fetcher();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelledRef.current = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetcher]);

  return { config, isLoading, error, refresh: fetcher };
}
