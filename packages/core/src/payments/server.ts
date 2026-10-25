/**
 * x402 del lado del agente: ponerle precio a un endpoint y cobrarlo en USDC
 * sobre Stellar.
 *
 * ```ts
 * import { withX402 } from '@x402/next';
 * import { createAcceslyResourceServer, priceEndpoint } from '@accesly/core/payments';
 *
 * const server = await createAcceslyResourceServer({ facilitatorUrl, network: 'stellar:testnet' });
 * export const POST = withX402(handler, priceEndpoint({ price: '$0.01', payTo, network }), server);
 * ```
 *
 * Usa el `ExactStellarScheme` oficial de `@x402/stellar` para construir los
 * payment requirements y un facilitador HTTP (`/verify`, `/settle`,
 * `/supported`) para liquidar.
 */

import type { RouteConfig } from '@x402/core/http';

export interface PriceEndpointParams {
  /** Precio en USD (`'$0.01'`) o en unidades del token. */
  readonly price: string;
  /** Cuenta que cobra (G-address o C-address). */
  readonly payTo: string;
  /** `stellar:testnet` o `stellar:pubnet`. */
  readonly network: string;
  /** Descripción que viaja en el 402. */
  readonly description?: string;
  /** Ventana para que el cliente firme, en segundos (default 60). */
  readonly maxTimeoutSeconds?: number;
}

/** Route config de x402 para un endpoint con precio fijo por llamada. */
export function priceEndpoint(params: PriceEndpointParams): RouteConfig {
  return {
    accepts: {
      scheme: 'exact',
      price: params.price,
      payTo: params.payTo,
      network: params.network as `${string}:${string}`,
      maxTimeoutSeconds: params.maxTimeoutSeconds ?? 60,
    },
    ...(params.description !== undefined ? { description: params.description } : {}),
    mimeType: 'application/json',
  };
}

export interface CreateResourceServerParams {
  /** URL base del facilitador x402. */
  readonly facilitatorUrl: string;
  /** Redes a registrar (default `['stellar:testnet']`). */
  readonly networks?: readonly string[];
}

/**
 * Crea un `x402ResourceServer` con el scheme "exact" de Stellar registrado.
 * Carga `@x402/core` y `@x402/stellar` en runtime (peer deps opcionales).
 */
export async function createAcceslyResourceServer(params: CreateResourceServerParams) {
  const [{ x402ResourceServer, HTTPFacilitatorClient }, { ExactStellarScheme }] = await Promise.all([
    import('@x402/core/server'),
    import('@x402/stellar/exact/server'),
  ]);
  const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: params.facilitatorUrl }));
  for (const network of params.networks ?? ['stellar:testnet']) {
    server.register(network as `${string}:${string}`, new ExactStellarScheme());
  }
  return server;
}
