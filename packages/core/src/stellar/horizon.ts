/**
 * Read-only Horizon helpers — fetch balances, recent operations.
 *
 * `@stellar/stellar-sdk` is lazy-imported. These functions don't touch any
 * key material; they're listed under `stellar/` for ergonomic grouping only.
 */

import { loadStellarSdk } from './loadSdk.js';

export interface BalanceEntry {
  /** `XLM` for native, otherwise `{code, issuer}` for issued assets. */
  readonly asset: 'XLM' | { readonly code: string; readonly issuer: string };
  /** Human-readable amount (e.g. `'1234.5678901'`). */
  readonly amount: string;
  /** Required reserve for this trustline, in stroops. */
  readonly buyingLiabilities?: string;
  readonly sellingLiabilities?: string;
}

export interface OperationEntry {
  readonly id: string;
  readonly type: string;
  readonly createdAt: string;
  readonly hash: string;
  readonly raw: unknown;
}

/**
 * Fetches the current balances for `accountAddress`. Returns an empty array
 * if the account has not been funded yet (Horizon 404).
 */
export async function getBalances(
  horizonUrl: string,
  accountAddress: string,
): Promise<readonly BalanceEntry[]> {
  const sdk = await loadStellarSdk();
  const server = new sdk.Horizon.Server(horizonUrl);
  try {
    const account = await server.loadAccount(accountAddress);
    return account.balances.map(
      (b: {
        asset_type: string;
        balance: string;
        asset_code?: string;
        asset_issuer?: string;
        buying_liabilities?: string;
        selling_liabilities?: string;
      }) => {
        const asset =
          b.asset_type === 'native'
            ? ('XLM' as const)
            : { code: b.asset_code ?? '', issuer: b.asset_issuer ?? '' };
        return {
          asset,
          amount: b.balance,
          ...(b.buying_liabilities !== undefined
            ? { buyingLiabilities: b.buying_liabilities }
            : {}),
          ...(b.selling_liabilities !== undefined
            ? { sellingLiabilities: b.selling_liabilities }
            : {}),
        } satisfies BalanceEntry;
      },
    );
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
}

/**
 * Fetches the most recent operations for `accountAddress`. `limit` defaults
 * to 10, max 200 (Horizon's hard cap).
 */
export async function getRecentOperations(
  horizonUrl: string,
  accountAddress: string,
  limit = 10,
): Promise<readonly OperationEntry[]> {
  if (limit < 1 || limit > 200) {
    throw new RangeError(`getRecentOperations: limit must be 1..200, got ${limit}`);
  }
  const sdk = await loadStellarSdk();
  const server = new sdk.Horizon.Server(horizonUrl);
  try {
    const page = await server
      .operations()
      .forAccount(accountAddress)
      .order('desc')
      .limit(limit)
      .call();
    return page.records.map(
      (rec: { id: string; type: string; created_at: string; transaction_hash: string }) => ({
        id: rec.id,
        type: rec.type,
        createdAt: rec.created_at,
        hash: rec.transaction_hash,
        raw: rec,
      }),
    );
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
}

function isNotFound(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as { response?: { status?: number } };
    if (e.response?.status === 404) return true;
  }
  return false;
}
