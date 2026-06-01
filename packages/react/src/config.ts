/**
 * Per-environment defaults — currently the only public stage is `dev`. The
 * others are placeholders so the SDK API doesn't change when `staging`/`prod`
 * come online (Fase 7+ / Fase 10).
 */

import type { CognitoConfig, Environment } from '@accesly/core';

export interface EnvironmentDefaults {
  readonly apiUrl: string;
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
  };
}

export const ENVIRONMENT_DEFAULTS: Record<Environment, EnvironmentDefaults> = {
  dev: {
    apiUrl: 'https://3fki7eiio5.execute-api.us-east-1.amazonaws.com/dev',
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
    },
  },
  staging: {
    apiUrl: 'https://api-staging.accesly.xyz',
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
    },
  },
  prod: {
    apiUrl: 'https://api.accesly.xyz',
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
    },
  },
};
