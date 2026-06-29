/**
 * Fase 11 (2026-06-29) — Server-to-server REST client.
 *
 * Usado por backends del integrador (Node.js, Edge, lo que sea) que tengan
 * una API key del dashboard de Accesly. NO usar desde browser — los keys
 * son secrets server-side (si filtras uno, rotalo desde el dashboard).
 *
 * Uso:
 *   import { AcceslyRestClient } from '@accesly/core';
 *
 *   const accesly = new AcceslyRestClient({
 *     apiKey: process.env.ACCESLY_API_KEY!,
 *     baseUrl: 'https://api.accesly.xyz',  // o el URL del RestApi stack
 *   });
 *
 *   const wallet = await accesly.getWallet('CCG3...XBQU');
 *   await accesly.testWebhook({ event: 'wallet_created', userId: 'u_123' });
 */

export interface AcceslyRestClientOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  /** Fetch override (Node 18+, Bun, undici, etc.). */
  readonly fetch?: typeof fetch;
  /** Timeout per request (ms). Default 15s. */
  readonly timeoutMs?: number;
}

export interface ServerWalletInfo {
  readonly walletAddress: string;
  readonly appId: string;
  readonly createdAt: string;
  readonly bootstrapGComplete: boolean;
  readonly gAddress: string | null;
  readonly contractVersion: string | null;
}

export interface ServerTransactionsResponse {
  readonly walletAddress: string;
  readonly transactions: ReadonlyArray<unknown>;
  readonly note?: string;
}

export interface TestWebhookInput {
  /** AuditAction string ej `wallet_created` / `transaction_completed`. */
  readonly event?: string;
  readonly userId?: string;
  readonly metadata?: Record<string, string | number | boolean>;
}

export class AcceslyRestError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'AcceslyRestError';
    this.status = status;
    if (code !== undefined) this.code = code;
  }
}

export class AcceslyRestClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: AcceslyRestClientOptions) {
    if (!opts.apiKey) throw new Error('AcceslyRestClient: apiKey is required');
    if (!opts.baseUrl) throw new Error('AcceslyRestClient: baseUrl is required');
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.fetchFn = opts.fetch ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    if (!this.fetchFn) {
      throw new Error(
        'AcceslyRestClient: global `fetch` is not available — pass `opts.fetch`',
      );
    }
  }

  /** GET /v1/wallets/{address} */
  getWallet(address: string): Promise<ServerWalletInfo> {
    return this.request<ServerWalletInfo>('GET', `/v1/wallets/${encodeURIComponent(address)}`);
  }

  /** GET /v1/wallets/{address}/transactions */
  getTransactions(address: string): Promise<ServerTransactionsResponse> {
    return this.request<ServerTransactionsResponse>(
      'GET',
      `/v1/wallets/${encodeURIComponent(address)}/transactions`,
    );
  }

  /** POST /v1/webhooks/test — encola un webhook de prueba a tu URL configurada. */
  testWebhook(input: TestWebhookInput = {}): Promise<{ queued: true; note: string }> {
    return this.request<{ queued: true; note: string }>('POST', '/v1/webhooks/test', input);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const init: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Accesly-Api-Key': this.apiKey,
        },
        signal: controller.signal,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      };
      const res = await this.fetchFn(`${this.baseUrl}${path}`, init);
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text;
      }
      if (!res.ok) {
        const err = parsed as { error?: string; code?: string } | null;
        const msg = err?.error ?? `HTTP ${res.status}`;
        throw new AcceslyRestError(res.status, msg, err?.code);
      }
      return parsed as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
