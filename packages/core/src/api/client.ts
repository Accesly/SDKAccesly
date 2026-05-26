/**
 * Typed HTTP client for the Accesly backend.
 *
 * - Auto-injects `Authorization: <idToken>` (no `Bearer ` prefix — the backend
 *   API Gateway REST v1 + Cognito Authorizer expects the raw JWT, see the
 *   handoff doc gotcha).
 * - Retries idempotent requests on 5xx / network errors with exponential
 *   backoff + jitter.
 * - Emits structured telemetry events the consumer can hook into.
 */

import { AccesslyApiError, NetworkError, errorForResponse } from './errors.js';

export type IdTokenProvider = () => string | null | Promise<string | null>;

export type TelemetryEvent =
  | { kind: 'request'; method: string; url: string; attempt: number }
  | {
      kind: 'response';
      method: string;
      url: string;
      status: number;
      durationMs: number;
      attempt: number;
    }
  | {
      kind: 'error';
      method: string;
      url: string;
      error: string;
      attempt: number;
    }
  | { kind: 'retry'; method: string; url: string; attempt: number; delayMs: number };

export type TelemetrySink = (event: TelemetryEvent) => void;

export interface AccesslyApiClientOptions {
  readonly baseUrl: string;
  /** Returns the current idToken, or null if the caller is anonymous. */
  readonly getIdToken?: IdTokenProvider;
  /** Override the global `fetch`. Tests only. */
  readonly fetchImpl?: typeof fetch;
  /** Max retries for idempotent requests on 5xx / network errors. Default 3. */
  readonly maxRetries?: number;
  /** Request timeout in ms. Default 30_000. */
  readonly timeoutMs?: number;
  /** Telemetry sink. Default no-op. */
  readonly telemetry?: TelemetrySink;
  /**
   * Override the backoff delay calculator (ms by attempt index, 1-based).
   * Tests only. Default: 500 * 2^(attempt-1) ± 20% jitter.
   */
  readonly backoffMs?: (attempt: number) => number;
}

export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [k: string]: Json };

export interface RequestOptions {
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
  readonly query?: Record<string, string | number | boolean | undefined>;
  /** If `false`, the request will NOT be retried. Default `true` for GET. */
  readonly retry?: boolean;
}

/** HTTP methods the client supports. */
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

const IDEMPOTENT_METHODS: ReadonlySet<HttpMethod> = new Set(['GET']);

export class AccesslyApiClient {
  private readonly baseUrl: string;
  private readonly getIdToken: IdTokenProvider | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly telemetry: TelemetrySink;
  private readonly backoffMs: (attempt: number) => number;

  constructor(opts: AccesslyApiClientOptions) {
    if (!opts.baseUrl) throw new TypeError('AccesslyApiClient: baseUrl is required');
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.getIdToken = opts.getIdToken;
    // `?? fetch` keeps a reference even after globalThis.fetch is reassigned
    // in tests, so users get the fetch they had when constructing the client.
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.maxRetries = opts.maxRetries ?? 3;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.telemetry = opts.telemetry ?? (() => undefined);
    this.backoffMs = opts.backoffMs ?? defaultBackoff;
  }

  get<T>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, undefined, opts);
  }

  post<T>(path: string, body?: Json, opts?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, body, opts);
  }

  put<T>(path: string, body?: Json, opts?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', path, body, opts);
  }

  delete<T>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, undefined, opts);
  }

  patch<T>(path: string, body?: Json, opts?: RequestOptions): Promise<T> {
    return this.request<T>('PATCH', path, body, opts);
  }

  private async request<T>(
    method: HttpMethod,
    path: string,
    body: Json | undefined,
    opts: RequestOptions | undefined,
  ): Promise<T> {
    const url = this.buildUrl(path, opts?.query);
    const shouldRetry = opts?.retry ?? IDEMPOTENT_METHODS.has(method);
    const idToken = this.getIdToken ? await this.getIdToken() : null;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...opts?.headers,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idToken) {
      // NOTE: API Gateway REST v1 + Cognito Authorizer expects the bare JWT,
      // NOT `Bearer <jwt>`. See CloudServices-accesly/docs/Handoff_Fase3.md.
      headers['Authorization'] = idToken;
    }

    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);

    let attempt = 0;
    let lastError: unknown;
    const maxAttempts = shouldRetry ? this.maxRetries + 1 : 1;

    while (attempt < maxAttempts) {
      attempt += 1;
      this.telemetry({ kind: 'request', method, url, attempt });
      const startedAt = Date.now();
      const ac = new AbortController();
      const timeoutId = setTimeout(() => ac.abort(), this.timeoutMs);
      const signal = combineSignals(opts?.signal, ac.signal);
      try {
        const res = await this.fetchImpl(url, { ...init, signal });
        const durationMs = Date.now() - startedAt;
        this.telemetry({
          kind: 'response',
          method,
          url,
          status: res.status,
          durationMs,
          attempt,
        });
        clearTimeout(timeoutId);

        if (res.status >= 500 && shouldRetry && attempt < maxAttempts) {
          const delay = this.backoffMs(attempt);
          this.telemetry({ kind: 'retry', method, url, attempt, delayMs: delay });
          await sleep(delay);
          continue;
        }

        return await this.handleResponse<T>(res);
      } catch (err) {
        clearTimeout(timeoutId);
        if (err instanceof AccesslyApiError) {
          // Already shaped — bubble up without retrying.
          throw err;
        }
        const description = describeError(err);
        this.telemetry({ kind: 'error', method, url, error: description, attempt });
        lastError = err;
        if (shouldRetry && attempt < maxAttempts) {
          const delay = this.backoffMs(attempt);
          this.telemetry({ kind: 'retry', method, url, attempt, delayMs: delay });
          await sleep(delay);
          continue;
        }
        throw new NetworkError(`fetch failed: ${description}`, { cause: err });
      }
    }

    // Unreachable, but TS needs an explicit throw.
    throw new NetworkError('retries exhausted', { cause: lastError });
  }

  private async handleResponse<T>(res: Response): Promise<T> {
    const requestId =
      res.headers.get('x-amzn-RequestId') ?? res.headers.get('x-request-id') ?? undefined;
    if (res.ok) {
      if (res.status === 204) return undefined as unknown as T;
      const text = await res.text();
      if (text.length === 0) return undefined as unknown as T;
      try {
        return JSON.parse(text) as T;
      } catch (err) {
        throw new NetworkError('response is not valid JSON', { cause: err, requestId });
      }
    }
    // Non-2xx: try to parse a JSON body for the error shape.
    let parsed: unknown;
    try {
      const text = await res.text();
      parsed = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    throw errorForResponse(res.status, parsed, requestId);
  }

  private buildUrl(path: string, query?: RequestOptions['query']): string {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(this.baseUrl + cleanPath);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined) continue;
        url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }
}

function defaultBackoff(attempt: number): number {
  const base = 500 * 2 ** (attempt - 1);
  const jitter = base * 0.2 * (Math.random() * 2 - 1); // ±20%
  return Math.max(0, Math.floor(base + jitter));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function combineSignals(a: AbortSignal | undefined, b: AbortSignal): AbortSignal {
  if (!a) return b;
  if (a.aborted) return a;
  if (b.aborted) return b;
  const ac = new AbortController();
  const onAbort = (): void => ac.abort();
  a.addEventListener('abort', onAbort, { once: true });
  b.addEventListener('abort', onAbort, { once: true });
  return ac.signal;
}
