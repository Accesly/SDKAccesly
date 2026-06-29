'use client';

import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AcceslyContext } from '../context.js';

/**
 * Phase 5 (2026-06-28) — wallet upgrade recommendation.
 *
 * Reads `GET /wallets/upgrade-recommendation`, which compares the wallet's
 * current `contractVersion` (persisted by `wallet-upgrade/submit`) with the
 * `wallet.targetVersion` the developer set on the dashboard. The host UI
 * uses this to render an "Update available" banner when
 * `upgradeAvailable === true`.
 *
 * The hook never auto-triggers the upgrade — `tx.swap` and friends keep
 * working on the current version. It's up to the integrator to decide when
 * to prompt, based on `rolloutStrategy`:
 *   - 'opt-in'        → show banner, let user click upgrade.
 *   - 'auto-propose'  → open modal immediately.
 *   - 'force'         → block actions until upgraded (rare).
 */
export interface UpgradeRecommendation {
  readonly walletAddress: string;
  readonly currentVersion: string | null;
  readonly targetVersion: string | null;
  readonly rolloutStrategy: 'opt-in' | 'auto-propose' | 'force';
  readonly upgradeAvailable: boolean;
}

export interface UseUpgradeRecommendationResult {
  readonly recommendation: UpgradeRecommendation | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
  refresh(): Promise<void>;
}

const REFETCH_INTERVAL_MS = 60_000;

export function useUpgradeRecommendation(): UseUpgradeRecommendationResult {
  const ctx = useContext(AcceslyContext);
  if (!ctx) {
    throw new Error('useUpgradeRecommendation must be used inside <AcceslyProvider>');
  }

  const [recommendation, setRecommendation] = useState<UpgradeRecommendation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const cancelledRef = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    // Requires an authenticated session — the endpoint is Cognito-protected.
    const idToken = await ctx.tokenManager.getValidIdToken().catch(() => null);
    if (!idToken) {
      if (!cancelledRef.current) {
        setRecommendation(null);
        setIsLoading(false);
      }
      return;
    }
    try {
      const result = await fetch(
        `${ctx.apiUrl.replace(/\/+$/, '')}/wallets/upgrade-recommendation`,
        { headers: { Authorization: idToken } },
      );
      if (!result.ok) {
        if (!cancelledRef.current) {
          setError(new Error(`HTTP ${result.status}`));
          setIsLoading(false);
        }
        return;
      }
      const json = (await result.json()) as UpgradeRecommendation;
      if (cancelledRef.current) return;
      setRecommendation(json);
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

  return { recommendation, isLoading, error, refresh };
}
