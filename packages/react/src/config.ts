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
    },
  },
};
