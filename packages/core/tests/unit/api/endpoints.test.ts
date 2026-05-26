import { describe, expect, it, vi } from 'vitest';
import { AccesslyApiClient, AccesslyEndpoints } from '../../../src/api/index.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('api/endpoints', () => {
  it('health hits GET /health', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: 'ok', stage: 'dev' }));
    const ep = new AccesslyEndpoints(
      new AccesslyApiClient({ baseUrl: 'https://api.example.com', fetchImpl }),
    );
    const r = await ep.health();
    expect(r).toEqual({ status: 'ok', stage: 'dev' });
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.example.com/health');
  });

  it('createWallet POSTs /wallets with the body', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ walletAddress: 'CABC', txHash: null }, 201));
    const ep = new AccesslyEndpoints(
      new AccesslyApiClient({ baseUrl: 'https://api.example.com', fetchImpl }),
    );
    const r = await ep.createWallet({
      appId: 'app',
      pubkeyEd25519: 'aa'.repeat(32),
      emailCommitment: 'bb'.repeat(32),
      secp256r1Pubkey: 'cc'.repeat(65),
      fragmentF2: { ciphertext: 'a', nonce: 'b', algo: 'aes-256-gcm' },
      fragmentF3: { ciphertext: 'c', nonce: 'd', algo: 'aes-256-gcm' },
    });
    expect(r.walletAddress).toBe('CABC');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/wallets');
    expect((init as RequestInit).method).toBe('POST');
  });

  it('getFragment2 POSTs /fragments/2 with the ephemeral pubkey', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        nonce: 'a',
        ciphertext: 'b',
        authTag: 'c',
        serverEphemeralPubkey: 'd',
      }),
    );
    const ep = new AccesslyEndpoints(
      new AccesslyApiClient({ baseUrl: 'https://api.example.com', fetchImpl }),
    );
    await ep.getFragment2({ clientEphemeralPubkey: 'xxxx' });
    const body = (fetchImpl.mock.calls[0]![1] as RequestInit).body;
    expect(typeof body).toBe('string');
    expect(JSON.parse(body as string)).toEqual({ clientEphemeralPubkey: 'xxxx' });
  });

  it('kycStart POSTs /kyc', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ customerId: 'cus', status: 'pending', hostedUrl: null }, 201),
      );
    const ep = new AccesslyEndpoints(
      new AccesslyApiClient({ baseUrl: 'https://api.example.com', fetchImpl }),
    );
    const r = await ep.kycStart();
    expect(r.status).toBe('pending');
    expect((fetchImpl.mock.calls[0]![1] as RequestInit).method).toBe('POST');
  });

  it('kycStatus GETs /kyc', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ customerId: 'cus', status: 'approved', hostedUrl: null }));
    const ep = new AccesslyEndpoints(
      new AccesslyApiClient({ baseUrl: 'https://api.example.com', fetchImpl }),
    );
    const r = await ep.kycStatus();
    expect(r.status).toBe('approved');
    expect((fetchImpl.mock.calls[0]![1] as RequestInit).method).toBe('GET');
  });

  it('onramp POSTs /onramp with the quote body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: 'quoted', amount: '500' }));
    const ep = new AccesslyEndpoints(
      new AccesslyApiClient({ baseUrl: 'https://api.example.com', fetchImpl }),
    );
    await ep.onramp({ action: 'quote', amount: '500', walletAddress: 'CABC', appId: 'app' });
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.example.com/onramp');
  });

  it('offramp POSTs /offramp', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: 'queued' }, 201));
    const ep = new AccesslyEndpoints(
      new AccesslyApiClient({ baseUrl: 'https://api.example.com', fetchImpl }),
    );
    await ep.offramp({
      action: 'submit',
      amount: '500',
      walletAddress: 'CABC',
      appId: 'app',
      clabe: '012345678901234567',
      quoteId: 'q-1',
    });
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.example.com/offramp');
  });
});
