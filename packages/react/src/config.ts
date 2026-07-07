/**
 * Per-environment defaults — currently the only public stage is `dev`. The
 * others are placeholders so the SDK API doesn't change when `staging`/`prod`
 * come online (Fase 7+ / Fase 10).
 */

import type { CognitoConfig, Environment } from '@accesly/core';

export interface EnvironmentDefaults {
  readonly apiUrl: string;
  /**
   * Lambda Function URL del `wallet-stream` Lambda — Server-Sent Events
   * que multiplexa status + balance + activity en una sola conexión.
   * Si está vacío, los hooks `useBalance` / `useWalletActivity` /
   * `useWalletStatus` caen al polling fallback (mucho menos eficiente).
   */
  readonly walletStreamUrl: string;
  readonly cognito: CognitoConfig;
  readonly stellar: StellarNetworkConfig;
  /**
   * Fase 14 (2026-07-05) — mismo backend puede servir apps mainnet + testnet.
   * Cuando el appConfig del user marca network=mainnet, el SDK usa esta
   * config en lugar de `stellar` para elegir el verifier, RPC y passphrase.
   */
  readonly stellarMainnet?: StellarNetworkConfig;
}

export interface StellarNetworkConfig {
  readonly networkPassphrase: string;
  readonly horizonUrl: string;
  readonly sorobanRpcUrl: string;
  /**
   * Stellar G-address of the account that invokes `CreateContract` for new
   * Smart Accounts. Same account the backend Lambda uses, so the wallet
   * address computed client-side via `wallet.computeAddress` matches
   * exactly what the backend will (or did) deploy.
   */
  readonly deployerAddress: string;
  /**
   * Address del contrato `ed25519-verifier` desplegado en la red. Necesario
   * cuando el SDK construye la entrada `Signer::External(verifier, pubkey)`
   * dentro del `AuthPayload` que firma — el Smart Account compara con la
   * misma address que tiene almacenada en su context rule.
   */
  readonly ed25519VerifierAddress: string;
}

export const ENVIRONMENT_DEFAULTS: Record<Environment, EnvironmentDefaults> = {
  dev: {
    apiUrl: 'https://w4kwws8fa6.execute-api.us-east-1.amazonaws.com/dev',
    walletStreamUrl: 'https://gg7bjuhugaviy44okbsxpuxhwa0zxleg.lambda-url.us-east-1.on.aws/',
    cognito: {
      // Fase 11.5 (2026-06-29) — Opción B: userPoolId + userPoolClientId se
      // leen del appConfig en runtime vía el Provider. Cada app tiene su
      // propio client. Estos defaults sólo aplican cuando el integrador pasa
      // un `cognitoConfig` override explícito (tests/custom setups).
      region: 'us-east-1',
      userPoolId: 'us-east-1_dVwWwpCos',
      userPoolClientId: '457lp8tpj3d1shrj9bh3k2131g',
      hostedUiDomain: 'https://accesly-dev.auth.us-east-1.amazoncognito.com',
    },
    stellar: {
      networkPassphrase: 'Test SDF Network ; September 2015',
      horizonUrl: 'https://horizon-testnet.stellar.org',
      sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
      // OZ Relayer channels-fund — see CloudServices-accesly/docs/Deployed_Resources_dev.md
      deployerAddress: 'GDRHSVLY3VCEHCHCSR5MZR2ALYLCERDDFT3ULCUIELGFVYHTZFCMNU4E',
      // accesly-contracts Phase 1 deploy on Stellar testnet.
      ed25519VerifierAddress: 'CALVIIGIOMODZMWTMKZLSD4PZFFEPWQBSYERHUFM6MH5FLWKCHW4E4G5',
    },
    // Fase 14 (2026-07-05) — apps mainnet en el mismo backend dev.
    // Contratos desplegados en Stellar Public el 2026-07-05.
    stellarMainnet: {
      networkPassphrase: 'Public Global Stellar Network ; September 2015',
      horizonUrl: 'https://horizon.stellar.org',
      sorobanRpcUrl: 'https://mainnet.sorobanrpc.com',
      deployerAddress: 'GDIVGZYBIIS33JHX36OUWGPQ4EP2SQW4YBNNGXDX4WCZRPQJCDBYONET',
      ed25519VerifierAddress: 'CCWNNXKR72N7NJ2QQTAVRXOOKQBTM2XWCLPJ5KF47TKY7GB7IJGHQOGK',
    },
  },
  staging: {
    apiUrl: 'https://api-staging.accesly.xyz',
    walletStreamUrl: '',
    cognito: {
      region: 'us-east-1',
      userPoolId: 'TBD-staging',
      userPoolClientId: 'TBD-staging',
    },
    stellar: {
      networkPassphrase: 'Test SDF Network ; September 2015',
      horizonUrl: 'https://horizon-testnet.stellar.org',
      sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
      deployerAddress: 'GDRHSVLY3VCEHCHCSR5MZR2ALYLCERDDFT3ULCUIELGFVYHTZFCMNU4E',
      ed25519VerifierAddress: 'CALVIIGIOMODZMWTMKZLSD4PZFFEPWQBSYERHUFM6MH5FLWKCHW4E4G5',
    },
  },
  prod: {
    apiUrl: 'https://api.accesly.xyz',
    walletStreamUrl: '',
    cognito: {
      region: 'us-east-1',
      userPoolId: 'TBD-prod',
      userPoolClientId: 'TBD-prod',
    },
    stellar: {
      networkPassphrase: 'Public Global Stellar Network ; September 2015',
      horizonUrl: 'https://horizon.stellar.org',
      sorobanRpcUrl: 'https://soroban-rpc.mainnet.stellar.org',
      deployerAddress: 'TBD-prod',
      ed25519VerifierAddress: 'TBD-prod',
    },
  },
};
