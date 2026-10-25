/**
 * `@accesly/core/payments` — cobros por uso con x402 sobre Stellar.
 *
 * - Cliente: `AcceslyExactStellarScheme` + `createAcceslyX402Fetch` pagan un
 *   402 firmando la auth entry del Smart Account (MPC 2-de-3 o session key).
 * - Servidor: `priceEndpoint` + `createAcceslyResourceServer` le ponen precio
 *   a un endpoint y liquidan vía facilitador.
 *
 * `@x402/core`, `@x402/fetch` y `@x402/stellar` son peer deps opcionales:
 * solo se cargan si se usa este subpath.
 */

export {
  AcceslyExactStellarScheme,
  STELLAR_PUBNET_CAIP2,
  STELLAR_TESTNET_CAIP2,
  USDC_BY_NETWORK,
  X402PaymentError,
  X402PolicyRejectedError,
  X402_POLICY_ERRORS,
  authorizeSmartAccountEntry,
  parseContractErrorCode,
  type AcceslyX402SchemeOptions,
  type AcceslyX402Signer,
} from './x402.js';

export {
  createAcceslyX402Fetch,
  mpcX402Signer,
  sessionKeyX402Signer,
  type MpcX402SignerParams,
  type SessionKeyX402SignerParams,
} from './client.js';

export {
  createAcceslyResourceServer,
  withX402Payment,
  priceEndpoint,
  type CreateResourceServerParams,
  type PriceEndpointParams,
} from './server.js';
