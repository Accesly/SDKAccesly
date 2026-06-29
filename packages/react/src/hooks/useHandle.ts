'use client';

import { useCallback, useContext, useEffect, useState } from 'react';
import { AcceslyContext } from '../context.js';
import { useAccesly } from './useAccesly.js';

/**
 * Phase 10 (2026-06-29) — `useHandle()`.
 *
 * Devuelve el handle reservado por la wallet del usuario actual (o null si
 * no ha reservado). El lookup es contra `GET /handles/by-wallet/{walletAddress}`
 * que es público + cacheable, así que no requiere idToken.
 *
 * `reserve(handle)` reserva un handle nuevo. Lanza un error con `code === 409`
 * si el handle ya está tomado.
 */
export interface UseHandleResult {
  readonly handle: string | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
  refresh(): Promise<void>;
  reserve(handle: string): Promise<string>;
}

export function useHandle(walletAddress?: string | null): UseHandleResult {
  const ctx = useContext(AcceslyContext);
  if (!ctx) throw new Error('useHandle must be used inside <AcceslyProvider>');
  const { wallet, _internal } = useAccesly();
  const username = _internal.username;

  const [resolved, setResolved] = useState<string | null>(walletAddress ?? null);
  const [handle, setHandle] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Resolve walletAddress from DeviceStore if not provided.
  useEffect(() => {
    if (walletAddress) {
      setResolved(walletAddress);
      return;
    }
    if (!username) {
      setResolved(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const c = await wallet.getStoredCredential(username);
        if (!cancelled) setResolved(c?.walletAddress ?? null);
      } catch {
        if (!cancelled) setResolved(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [walletAddress, username, wallet]);

  const refresh = useCallback(async () => {
    if (!resolved) {
      setHandle(null);
      setIsLoading(false);
      return;
    }
    try {
      const h = await ctx.endpoints.lookupHandleByWallet(resolved);
      setHandle(h);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [ctx, resolved]);

  const reserve = useCallback(
    async (h: string): Promise<string> => {
      if (!resolved) throw new Error('No walletAddress yet — wallet still bootstrapping?');
      const cleaned = h.replace(/^@/, '').toLowerCase();
      const r = await ctx.endpoints.reserveHandle({ handle: cleaned, walletAddress: resolved });
      setHandle(r.handle);
      return r.handle;
    },
    [ctx, resolved],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { handle, isLoading, error, refresh, reserve };
}
