'use client';

import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AcceslyContext } from '../context.js';

/**
 * Phase 6 (2026-06-29) — accesly platform health.
 *
 * Reads `GET /status`, which is public and cached 15s at the edge. The host
 * app or dashboard polls every 30s. Useful for:
 *  - Dashboard "Status" section (6 health dots with latency).
 *  - SDK consumers showing a degraded-mode banner when Soroban RPC is down.
 *
 * The endpoint never requires authentication, so this hook works pre-login.
 */
export type StatusHealth = 'ok' | 'warn' | 'down';

export interface ServiceCheck {
  readonly service: string;
  readonly status: StatusHealth;
  readonly latencyMs: number;
  readonly detail?: string;
}

export interface PlatformStatus {
  readonly status: StatusHealth;
  readonly checks: ReadonlyArray<ServiceCheck>;
  readonly checkedAt: string;
  readonly tookMs: number;
}

export interface UseStatusResult {
  readonly status: PlatformStatus | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
  refresh(): Promise<void>;
}

const REFETCH_INTERVAL_MS = 30_000;

export function useStatus(): UseStatusResult {
  const ctx = useContext(AcceslyContext);
  if (!ctx) {
    throw new Error('useStatus must be used inside <AcceslyProvider>');
  }

  const [status, setStatus] = useState<PlatformStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const cancelledRef = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${ctx.apiUrl.replace(/\/+$/, '')}/status`);
      if (!res.ok) {
        if (!cancelledRef.current) {
          setError(new Error(`HTTP ${res.status}`));
          setIsLoading(false);
        }
        return;
      }
      const json = (await res.json()) as PlatformStatus;
      if (cancelledRef.current) return;
      setStatus(json);
      setError(null);
    } catch (err) {
      if (cancelledRef.current) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (!cancelledRef.current) setIsLoading(false);
    }
  }, [ctx]);

  useEffect(() => {
    cancelledRef.current = false;
    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, REFETCH_INTERVAL_MS);
    return () => {
      cancelledRef.current = true;
      window.clearInterval(interval);
    };
  }, [refresh]);

  return { status, isLoading, error, refresh };
}
