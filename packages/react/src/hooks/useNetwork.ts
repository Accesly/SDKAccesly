import { getAppNetwork } from '@accesly/core';
import { useAppConfig } from './useAppConfig.js';

/**
 * Devuelve la Stellar network activa del app (`'testnet'` o `'mainnet'`) o
 * `undefined` mientras el appConfig está cargando.
 *
 * Uso típico: componentes del kit que ramifican UI según network:
 *  - `<WalletHome>` muestra `<NetworkBadge>` visible.
 *  - `<SwapFlow>` / `<SendFlow>` piden confirmación extra en mainnet.
 *  - explorer URLs se ajustan al explorer correcto.
 *
 * Custom UI de integradores puede usarlo directo:
 *   const network = useNetwork();
 *   if (network === 'mainnet') showBigWarning();
 */
export function useNetwork(): 'testnet' | 'mainnet' | undefined {
  const { config } = useAppConfig();
  if (!config) return undefined;
  return getAppNetwork(config);
}
