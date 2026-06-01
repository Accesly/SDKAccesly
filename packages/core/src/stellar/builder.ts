/**
 * Stellar transaction builders.
 *
 * `@stellar/stellar-sdk` is lazy-imported so apps that only authenticate
 * (without sending tx) don't pay the ~200 KB bundle cost.
 */

import { loadStellarSdk } from './loadSdk.js';

export interface StellarNetworkParams {
  /** Network passphrase. Use `'Test SDF Network ; September 2015'` for testnet. */
  readonly networkPassphrase: string;
  /** Horizon URL — used to fetch the source account's current sequence number. */
  readonly horizonUrl: string;
  /** Base fee in stroops. Defaults to 100 (`BASE_FEE` constant). */
  readonly baseFee?: string;
}

export interface BuildPaymentParams {
  readonly network: StellarNetworkParams;
  readonly sourceAddress: string;
  readonly destinationAddress: string;
  /** `'XLM'` for native, otherwise `{ code, issuer }`. */
  readonly asset: 'XLM' | { readonly code: string; readonly issuer: string };
  readonly amount: string;
  readonly memo?: string;
  /** Optional preconditions — e.g. minTime / maxTime for time-bound tx. */
  readonly timeoutSeconds?: number;
}

/**
 * Builds an unsigned Stellar payment transaction and returns its XDR. The
 * source account's sequence number is fetched fresh from Horizon.
 */
export async function buildPaymentTransaction(params: BuildPaymentParams): Promise<string> {
  const sdk = await loadStellarSdk();
  const { Asset, BASE_FEE, Horizon, Memo, Operation, TransactionBuilder } = sdk;

  const server = new Horizon.Server(params.network.horizonUrl);
  const sourceAccount = await server.loadAccount(params.sourceAddress);

  const asset =
    params.asset === 'XLM' ? Asset.native() : new Asset(params.asset.code, params.asset.issuer);

  const builder = new TransactionBuilder(sourceAccount, {
    fee: params.network.baseFee ?? BASE_FEE,
    networkPassphrase: params.network.networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination: params.destinationAddress,
        asset,
        amount: params.amount,
      }),
    )
    .setTimeout(params.timeoutSeconds ?? 180);

  if (params.memo) builder.addMemo(Memo.text(params.memo));

  return builder.build().toXDR();
}

export interface BuildContractInvokeParams {
  readonly network: StellarNetworkParams;
  readonly sourceAddress: string;
  readonly contractId: string;
  readonly method: string;
  /**
   * Pre-encoded ScVal arguments. Callers typically use
   * `sdk.nativeToScVal(value, opts)` to build these.
   */
  readonly args: readonly unknown[];
  readonly timeoutSeconds?: number;
}

/**
 * Builds an unsigned Soroban contract invocation transaction and returns its
 * XDR. Useful for Smart Account custom operations (`upgrade`, `add_signer`,
 * etc.) and for invoking apps the user is integrating with.
 */
export async function buildContractInvokeTransaction(
  params: BuildContractInvokeParams,
): Promise<string> {
  const sdk = await loadStellarSdk();
  const { BASE_FEE, Contract, Horizon, TransactionBuilder } = sdk;

  const server = new Horizon.Server(params.network.horizonUrl);
  const sourceAccount = await server.loadAccount(params.sourceAddress);

  const contract = new Contract(params.contractId);
  // Cast through `unknown` because the SDK's xdr.ScVal union is wide and
  // we accept whatever the caller pre-built.
  const callArgs = params.args as readonly never[];
  const builder = new TransactionBuilder(sourceAccount, {
    fee: params.network.baseFee ?? BASE_FEE,
    networkPassphrase: params.network.networkPassphrase,
  })
    .addOperation(contract.call(params.method, ...callArgs))
    .setTimeout(params.timeoutSeconds ?? 180);

  return builder.build().toXDR();
}
