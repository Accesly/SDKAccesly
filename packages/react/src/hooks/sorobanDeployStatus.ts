/**
 * Recognises backend `POST /wallets` failures that are KNOWN to leave the
 * wallet record on the backend (Soroban submit rejected the deploy — typical
 * after Soroban protocol v26 lowered the resource caps).
 *
 * In these cases the SDK does NOT throw: `wallet.createWallet` returns
 * `status: 'pending-deploy'` with the client-side-predicted address so the
 * app can render normally and call `wallet.retryDeploy` later (or wait for
 * the contracts team to slim the constructor and let the backend's
 * auto-retry land it).
 *
 * Recognised patterns (case-insensitive substring match against the error
 * message and code):
 *  - `txSorobanInvalid` — Soroban RPC rejected the envelope shape
 *  - `Soroban sendTransaction` — generic submit rejection
 *  - `soroban submit failed` — backend wrapper message
 *  - `scecExceededLimit` / `exceededLimit` — protocol v26 cap exceeded
 */

import { AccesslyApiError } from '@accesly/core';

export function isSorobanDeployPendingError(err: unknown): boolean {
  if (!(err instanceof AccesslyApiError)) return false;
  const haystack = `${err.message ?? ''} ${err.code ?? ''}`.toLowerCase();
  return (
    haystack.includes('txsorobaninvalid') ||
    haystack.includes('soroban sendtransaction') ||
    haystack.includes('soroban submit failed') ||
    haystack.includes('scecexceededlimit') ||
    haystack.includes('exceededlimit')
  );
}
