import { describe, expect, it, vi } from 'vitest';
import { AccesslyApiClient, AccesslyEndpoints, AuthError } from '../../../src/api/index.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('api/endpoints.getWallet', () => {
  it('returns the wallet metadata on 200 including onChain', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        walletAddress: 'CABC1234567890',
        appId: 'my-app',
        createdAt: '2026-05-26T20:00:00Z',
        onChain: true,
      }),
    );
    const ep = new AccesslyEndpoints(
      new AccesslyApiClient({ baseUrl: 'https://api.example.com', fetchImpl }),
    );
    const wallet = await ep.getWallet();
    expect(wallet).toEqual({
      walletAddress: 'CABC1234567890',
      appId: 'my-app',
      createdAt: '2026-05-26T20:00:00Z',
      onChain: true,
    });
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.example.com/wallets');
    expect((fetchImpl.mock.calls[0]![1] as RequestInit).method).toBe('GET');
  });

  it('exposes onChain=false (ghost wallet) verbatim', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        walletAddress: 'CGHOST...',
        appId: 'my-app',
        createdAt: '2026-05-26T20:00:00Z',
        onChain: false,
      }),
    );
    const ep = new AccesslyEndpoints(
      new AccesslyApiClient({ baseUrl: 'https://api.example.com', fetchImpl }),
    );
    const wallet = await ep.getWallet();
    expect(wallet?.onChain).toBe(false);
  });

  it('exposes onChain=null (RPC unreachable) verbatim', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        walletAddress: 'CUNKNOWN...',
        appId: 'my-app',
        createdAt: '2026-05-26T20:00:00Z',
        onChain: null,
      }),
    );
    const ep = new AccesslyEndpoints(
      new AccesslyApiClient({ baseUrl: 'https://api.example.com', fetchImpl }),
    );
    const wallet = await ep.getWallet();
    expect(wallet?.onChain).toBeNull();
  });

  it('returns null on 404', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: 'no wallet registered for this user' }, 404));
    const ep = new AccesslyEndpoints(
      new AccesslyApiClient({ baseUrl: 'https://api.example.com', fetchImpl }),
    );
    expect(await ep.getWallet()).toBeNull();
  });

  it('propagates non-404 errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: 'Unauthorized' }, 401));
    const ep = new AccesslyEndpoints(
      new AccesslyApiClient({ baseUrl: 'https://api.example.com', fetchImpl }),
    );
    await expect(ep.getWallet()).rejects.toBeInstanceOf(AuthError);
  });
});
