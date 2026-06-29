'use client';

import { useMemo } from 'react';
import type {
  AppConfigAuth,
  AppConfigPolicies,
  AppConfigResponse,
  AuthProvider,
} from '@accesly/core';
import { useAppConfig } from './useAppConfig.js';

/**
 * Phase 4 hooks — read-only views over the appConfig that the SDK and host
 * UI use to enforce dev-authored policy. All three return safe defaults
 * while `useAppConfig` is still loading, so the host can render the auth
 * form / send form without waiting for the config round-trip.
 */

const DEFAULT_PROVIDERS: ReadonlyArray<AuthProvider> = ['email', 'google'];

export interface UseAuthProvidersResult {
  readonly providers: ReadonlyArray<AuthProvider>;
  readonly phoneRegion: string | null;
  readonly webauthnEnabled: boolean;
  readonly isLoading: boolean;
}

/**
 * Returns the auth providers the developer enabled on `dev.accesly.xyz`.
 * UI should branch on `providers.includes(...)` to render only allowed
 * sign-in buttons.
 */
export function useAuthProviders(): UseAuthProvidersResult {
  const { config, isLoading } = useAppConfig();
  const auth = config?.auth as AppConfigAuth | undefined;
  return useMemo(
    () => ({
      providers: auth?.providers ?? DEFAULT_PROVIDERS,
      phoneRegion: auth?.phoneRegion ?? null,
      webauthnEnabled: auth?.webauthnEnabled ?? true,
      isLoading,
    }),
    [auth?.providers, auth?.phoneRegion, auth?.webauthnEnabled, isLoading],
  );
}

export interface UseKycPolicyResult {
  readonly enabled: boolean;
  readonly requiredFor: ReadonlyArray<'onramp' | 'offramp'>;
  readonly thresholdUsd: number | null;
  readonly minLevel: 'KYC1' | 'KYC2' | 'KYC3' | null;
  readonly isLoading: boolean;
}

/**
 * Returns the KYC requirement that the dev enabled for this app. The fiat
 * onramp/offramp flows check `enabled` + `requiredFor` before opening the
 * flow; over `thresholdUsd` they prompt the verification even for already-
 * verified users.
 */
export function useKycPolicy(): UseKycPolicyResult {
  const { config, isLoading } = useAppConfig();
  const kyc = (config?.policies as AppConfigPolicies | undefined)?.kyc;
  return useMemo(
    () => ({
      enabled: kyc?.enabled ?? false,
      requiredFor: kyc?.requiredFor ?? [],
      thresholdUsd: kyc?.thresholdUsd ?? null,
      minLevel: kyc?.minLevel ?? null,
      isLoading,
    }),
    [kyc?.enabled, kyc?.requiredFor, kyc?.thresholdUsd, kyc?.minLevel, isLoading],
  );
}

export interface UseSpendingPolicyResult {
  /** Per-tx cap in stroops for the configured asset, or null if no cap. */
  readonly perTxStroops: string | null;
  /** Asset the cap applies to ('USDC', 'XLM', etc.), or null if no cap. */
  readonly perTxAsset: string | null;
  /** Max number of submitted tx per UTC day, or null if uncapped. */
  readonly txPerDayCount: number | null;
  /**
   * Addresses the dev blacklisted via dev.accesly.xyz. tx.send and tx.swap
   * pre-check `to` against this list and short-circuit before the network
   * call.
   */
  readonly blacklist: ReadonlyArray<string>;
  readonly isLoading: boolean;
}

/**
 * Returns the spending policy + blacklist that the dev authored for this
 * app. The SDK uses these for early-fail client-side checks in `tx.send`
 * and `tx.swap`; the backend re-validates on every submit so a stale
 * client can't bypass them.
 */
export function useSpendingPolicy(): UseSpendingPolicyResult {
  const { config, isLoading } = useAppConfig();
  const policies = config?.policies as AppConfigPolicies | undefined;
  return useMemo(() => {
    const spending = policies?.spending;
    return {
      perTxStroops: spending?.perTxAmountCap?.stroops ?? null,
      perTxAsset: spending?.perTxAmountCap?.asset ?? null,
      txPerDayCount: spending?.txPerDayCount ?? null,
      blacklist: policies?.blacklistAddresses ?? [],
      isLoading,
    };
  }, [
    policies?.spending?.perTxAmountCap?.stroops,
    policies?.spending?.perTxAmountCap?.asset,
    policies?.spending?.txPerDayCount,
    policies?.blacklistAddresses,
    isLoading,
  ]);
}

/**
 * Validates an outgoing transfer against the dev's policy. Returns either
 * `{ ok: true }` or a typed reason. The host UI calls this before invoking
 * `tx.send` so it can surface a meaningful message instead of letting the
 * backend reject with HTTP 400.
 *
 * The backend re-validates on submit-tx — this is purely a UX optimisation,
 * never a security boundary.
 */
export type PolicyCheckResult =
  | { ok: true }
  | { ok: false; reason: 'destination-blacklisted'; address: string }
  | {
      ok: false;
      reason: 'per-tx-cap-exceeded';
      asset: string;
      capStroops: string;
      attemptedStroops: string;
    };

export function checkTransferPolicy(
  policy: UseSpendingPolicyResult,
  params: {
    readonly destinationAddress: string;
    readonly asset: string;
    readonly amountStroops: string;
  },
): PolicyCheckResult {
  if (policy.blacklist.includes(params.destinationAddress)) {
    return {
      ok: false,
      reason: 'destination-blacklisted',
      address: params.destinationAddress,
    };
  }
  if (
    policy.perTxStroops &&
    policy.perTxAsset === params.asset &&
    BigInt(params.amountStroops) > BigInt(policy.perTxStroops)
  ) {
    return {
      ok: false,
      reason: 'per-tx-cap-exceeded',
      asset: params.asset,
      capStroops: policy.perTxStroops,
      attemptedStroops: params.amountStroops,
    };
  }
  return { ok: true };
}

// Re-export the AppConfigResponse type for callers that want to type derived
// state without importing from core directly.
export type { AppConfigResponse };
