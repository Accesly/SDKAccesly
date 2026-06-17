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
  readonly stellar: {
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
  };
}

export const ENVIRONMENT_DEFAULTS: Record<Environment, EnvironmentDefaults> = {
  dev: {
    apiUrl: 'https://3fki7eiio5.execute-api.us-east-1.amazonaws.com/dev',
    walletStreamUrl: 'https://ajlmn37thw7fxen3oyykbfmlrm0eecue.lambda-url.us-east-1.on.aws/',
    cognito: {
      region: 'us-east-1',
      userPoolId: 'us-east-1_K2Nag1tB1',
      userPoolClientId: '6r64diep7pne50sender4557jt',
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
