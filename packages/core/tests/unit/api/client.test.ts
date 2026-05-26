import { describe, expect, it, vi } from 'vitest';
import {
  AccesslyApiClient,
  AuthError,
  NetworkError,
  ServerError,
  ValidationError,
  type TelemetryEvent,
} from '../../../src/api/index.js';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('api/client', () => {
  describe('happy paths', () => {
    it('GET returns parsed JSON', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: 'ok', stage: 'dev' }));
      const client = new AccesslyApiClient({ baseUrl: 'https://api.example.com/', fetchImpl });
      const out = await client.get<{ status: string; stage: string }>('/health');
      expect(out).toEqual({ status: 'ok', stage: 'dev' });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('POST sends JSON body + Content-Type', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ walletAddress: 'C...' }, 201));
      const client = new AccesslyApiClient({ baseUrl: 'https://api.example.com', fetchImpl });
      await client.post('/wallets', { appId: 'x' });
      const [, init] = fetchImpl.mock.calls[0]!;
      expect((init as RequestInit).method).toBe('POST');
      expect((init as RequestInit).body).toBe('{"appId":"x"}');
      const h = new Headers((init as RequestInit).headers as HeadersInit);
      expect(h.get('content-type')).toBe('application/json');
    });

    it('injects the idToken as raw Authorization header (no "Bearer ")', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
      const client = new AccesslyApiClient({
        baseUrl: 'https://api.example.com',
        getIdToken: () => 'jwt-abc',
        fetchImpl,
      });
      await client.get('/health');
      const [, init] = fetchImpl.mock.calls[0]!;
      const h = new Headers((init as RequestInit).headers as HeadersInit);
      expect(h.get('authorization')).toBe('jwt-abc');
    });

    it('skips Authorization header when getIdToken returns null', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
      const client = new AccesslyApiClient({
        baseUrl: 'https://api.example.com',
        getIdToken: () => null,
        fetchImpl,
      });
      await client.get('/health');
      const [, init] = fetchImpl.mock.calls[0]!;
      const h = new Headers((init as RequestInit).headers as HeadersInit);
      expect(h.has('authorization')).toBe(false);
    });

    it('serializes query parameters', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
      const client = new AccesslyApiClient({ baseUrl: 'https://api.example.com', fetchImpl });
      await client.get('/kyc', { query: { foo: 'bar', n: 42, skip: undefined } });
      const [url] = fetchImpl.mock.calls[0]!;
      expect(url).toBe('https://api.example.com/kyc?foo=bar&n=42');
    });

    it('returns undefined for 204 No Content', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
      const client = new AccesslyApiClient({ baseUrl: 'https://api.example.com', fetchImpl });
      expect(await client.delete('/x')).toBeUndefined();
    });
  });

  describe('error paths', () => {
    it('throws ValidationError on 400', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: 'bad input' }, 400));
      const client = new AccesslyApiClient({ baseUrl: 'https://api.example.com', fetchImpl });
      await expect(client.post('/wallets', {})).rejects.toBeInstanceOf(ValidationError);
    });

    it('throws AuthError on 401', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: 'Unauthorized' }, 401));
      const client = new AccesslyApiClient({ baseUrl: 'https://api.example.com', fetchImpl });
      await expect(client.post('/wallets', {})).rejects.toBeInstanceOf(AuthError);
    });

    it('does NOT retry on 4xx', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 400));
      const client = new AccesslyApiClient({ baseUrl: 'https://api.example.com', fetchImpl });
      await expect(client.get('/health')).rejects.toBeInstanceOf(ValidationError);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('retries idempotent GET on 5xx then succeeds', async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ err: 1 }, 500))
        .mockResolvedValueOnce(jsonResponse({ err: 2 }, 502))
        .mockResolvedValueOnce(jsonResponse({ status: 'ok' }, 200));
      const client = new AccesslyApiClient({
        baseUrl: 'https://api.example.com',
        fetchImpl,
        backoffMs: () => 0,
      });
      const out = await client.get<{ status: string }>('/health');
      expect(out.status).toBe('ok');
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    });

    it('does NOT retry POST by default', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 500));
      const client = new AccesslyApiClient({
        baseUrl: 'https://api.example.com',
        fetchImpl,
        backoffMs: () => 0,
      });
      await expect(client.post('/x', {})).rejects.toBeInstanceOf(ServerError);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('throws ServerError after exhausting retries on 5xx', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 500));
      const client = new AccesslyApiClient({
        baseUrl: 'https://api.example.com',
        fetchImpl,
        backoffMs: () => 0,
        maxRetries: 2,
      });
      await expect(client.get('/health')).rejects.toBeInstanceOf(ServerError);
      // 1 attempt + 2 retries = 3 calls
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    });

    it('wraps fetch failures in NetworkError', async () => {
      const fetchImpl = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));
      const client = new AccesslyApiClient({
        baseUrl: 'https://api.example.com',
        fetchImpl,
        backoffMs: () => 0,
        maxRetries: 0,
      });
      await expect(client.get('/health')).rejects.toBeInstanceOf(NetworkError);
    });
  });

  describe('telemetry', () => {
    it('emits request + response events', async () => {
      const events: TelemetryEvent[] = [];
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
      const client = new AccesslyApiClient({
        baseUrl: 'https://api.example.com',
        fetchImpl,
        telemetry: (e) => events.push(e),
      });
      await client.get('/health');
      expect(events.map((e) => e.kind)).toEqual(['request', 'response']);
    });

    it('emits retry + error events on flaky 5xx', async () => {
      const events: TelemetryEvent[] = [];
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({}, 500))
        .mockResolvedValueOnce(jsonResponse({ ok: true }, 200));
      const client = new AccesslyApiClient({
        baseUrl: 'https://api.example.com',
        fetchImpl,
        backoffMs: () => 0,
        telemetry: (e) => events.push(e),
      });
      await client.get('/health');
      expect(events.map((e) => e.kind)).toEqual([
        'request',
        'response',
        'retry',
        'request',
        'response',
      ]);
    });
  });

  describe('options validation', () => {
    it('throws when baseUrl is missing', () => {
      expect(() => new AccesslyApiClient({ baseUrl: '' })).toThrow(TypeError);
    });

    it('strips trailing slashes from baseUrl', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
      const client = new AccesslyApiClient({
        baseUrl: 'https://api.example.com////',
        fetchImpl,
      });
      await client.get('/health');
      const [url] = fetchImpl.mock.calls[0]!;
      expect(url).toBe('https://api.example.com/health');
    });
  });
});
