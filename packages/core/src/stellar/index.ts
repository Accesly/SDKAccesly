/**
 * Stellar transaction layer — builder, signer (allow-listed), Horizon reads.
 *
 * `@stellar/stellar-sdk` is lazy-imported by every function in this module so
 * apps that don't sign tx don't pay the ~200 KB bundle cost.
 */

export {
  buildContractInvokeTransaction,
  buildPaymentTransaction,
  type BuildContractInvokeParams,
  type BuildPaymentParams,
  type StellarNetworkParams,
} from './builder.js';

export {
  signTransaction,
  type SignTransactionParams,
  type SignTransactionResult,
} from './signer.js';

export {
  computeSmartAccountAddress,
  type ComputeSmartAccountAddressParams,
} from './contractAddress.js';

export {
  getBalances,
  getRecentOperations,
  type BalanceEntry,
  type OperationEntry,
} from './horizon.js';

export {
  signSorobanAuthEntry,
  type SignSorobanAuthEntryParams,
  type SignSorobanAuthEntryResult,
} from './sorobanAuth.js';

export {
  XLM_DECIMALS,
  accountExplorerUrl,
  isValidStellarAddress,
  shortAddress,
  stroopsToXlm,
  txExplorerUrl,
  walletExplorerUrl,
  xlmToStroops,
  type StellarNetwork,
} from './format.js';
