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

type Handler = (req: Request) => Promise<Response> | Response;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ResourceServer = any;

/**
 * Envuelve un handler de la Fetch API (`Request → Response`) con cobro x402.
 * Sirve en cualquier runtime con Request/Response estándar (Next.js app
 * router de cualquier versión, Hono, Bun, workers), a diferencia de
 * `@x402/next`, que exige Next ≥ 16.
 *
 * Ciclo, igual que el middleware oficial de Express:
 *   1. Sin pago → 402 con `PAYMENT-REQUIRED`.
 *   2. Con pago → verify en el facilitador; si falla, 402.
 *   3. Corre el handler. Si responde < 400, liquida (settle) y agrega
 *      `PAYMENT-RESPONSE`; si responde ≥ 400 o lanza, cancela y no cobra.
 */
export function withX402Payment(
  handler: Handler,
  route: RouteConfig,
  server: ResourceServer | Promise<ResourceServer>,
): (req: Request) => Promise<Response> {
  let http: Promise<ResourceServer> | undefined;
  const getHttp = () =>
    (http ??= (async () => {
      const [{ x402HTTPResourceServer }, resourceServer] = await Promise.all([
        import('@x402/core/server'),
        server,
      ]);
      const h = new x402HTTPResourceServer(resourceServer, route);
      await h.initialize();
      return h;
    })().catch((err) => {
      http = undefined;
      throw err;
    }));

  return async (req) => {
    const h = await getHttp();
    const url = new URL(req.url);
    const query = Object.fromEntries(url.searchParams.entries());
    const header = (name: string) => req.headers.get(name) ?? undefined;
    const body =
      req.method === 'GET' || req.method === 'HEAD'
        ? undefined
        : await req
            .clone()
            .json()
            .catch(() => undefined);
    const context = {
      adapter: {
        getHeader: header,
        getMethod: () => req.method,
        getPath: () => url.pathname,
        getUrl: () => req.url,
        getAcceptHeader: () => header('accept') ?? '',
        getUserAgent: () => header('user-agent') ?? '',
        getQueryParams: () => query,
        getQueryParam: (name: string) => query[name],
        getBody: () => body,
      },
      path: url.pathname,
      decodedPath: safeDecode(url.pathname),
      method: req.method,
      paymentHeader: header('payment-signature') ?? header('x-payment'),
    };

    const result = await h.processHTTPRequest(context);
    if (result.type === 'no-payment-required') return handler(req);
    if (result.type === 'payment-error') return toResponse(result.response);

    const {
      cancellationDispatcher,
      beforeHandlerSettlement,
      paymentPayload,
      paymentRequirements,
      declaredExtensions,
    } = result;
    let res: Response;
    try {
      res = await handler(req);
    } catch (error) {
      await cancellationDispatcher.cancel({ reason: 'handler_threw', error });
      return Response.json({ error: 'Internal Server Error' }, { status: 500 });
    }
    if (res.status >= 400) {
      await cancellationDispatcher.cancel({ reason: 'handler_failed', responseStatus: res.status });
      return res;
    }

    const responseBody = new Uint8Array(await res.arrayBuffer());
    const responseHeaders = Object.fromEntries(res.headers.entries());
    const settle = await h.processSettlement(
      paymentPayload,
      paymentRequirements,
      declaredExtensions,
      { request: context, responseBody, responseHeaders },
      undefined,
      beforeHandlerSettlement,
    );
    if (!settle.success) return toResponse(settle.response);

    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(settle.headers as Record<string, string>))
      headers.set(k, v);
    headers.set('Cache-Control', 'private, no-store');
    return new Response(responseBody, { status: res.status, headers });
  };
}

function toResponse(r: {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
  isHtml?: boolean;
}) {
  const headers = new Headers(r.headers);
  if (r.isHtml) {
    headers.set('Content-Type', 'text/html; charset=utf-8');
    return new Response(String(r.body ?? ''), { status: r.status, headers });
  }
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers });
}

function safeDecode(path: string) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
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
  const [{ x402ResourceServer, HTTPFacilitatorClient }, { ExactStellarScheme }] = await Promise.all(
    [import('@x402/core/server'), import('@x402/stellar/exact/server')],
  );
  const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: params.facilitatorUrl }));
  for (const network of params.networks ?? ['stellar:testnet']) {
    server.register(network as `${string}:${string}`, new ExactStellarScheme());
  }
  return server;
}
