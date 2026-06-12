import { describe, expect, it, vi } from 'vitest';
import { ArtifactLoadError } from '../src/errors';
import { buildArtifactUrl, loadArtifacts } from '../src/prover/load-artifacts';

describe('buildArtifactUrl', () => {
  it('joins base + version + path', () => {
    expect(
      buildArtifactUrl(
        { artifactsBaseUrl: 'https://cdn.accesly.app/zkemail', artifactVersion: 'v1' },
        'accesly_email.wasm',
      ),
    ).toBe('https://cdn.accesly.app/zkemail/v1/accesly_email.wasm');
  });

  it('omits version segment when not provided', () => {
    expect(
      buildArtifactUrl(
        { artifactsBaseUrl: 'https://cdn.accesly.app/zkemail' },
        'accesly_email.wasm',
      ),
    ).toBe('https://cdn.accesly.app/zkemail/accesly_email.wasm');
  });

  it('trims trailing/leading slashes', () => {
    expect(
      buildArtifactUrl(
        { artifactsBaseUrl: 'https://cdn.accesly.app/zkemail/' },
        '/accesly_email.wasm',
      ),
    ).toBe('https://cdn.accesly.app/zkemail/accesly_email.wasm');
  });

  it('url-encodes the version segment', () => {
    expect(
      buildArtifactUrl(
        { artifactsBaseUrl: 'https://x.test', artifactVersion: 'v1.0.0-ceremony 2026/08' },
        'a.wasm',
      ),
    ).toContain('v1.0.0-ceremony%202026%2F08');
  });
});

describe('loadArtifacts', () => {
  it('fetches wasm and zkey in parallel and returns Uint8Arrays', async () => {
    const wasmBytes = new Uint8Array([1, 2, 3, 4]);
    const zkeyBytes = new Uint8Array([5, 6, 7, 8, 9]);
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      const body = url.endsWith('.wasm') ? wasmBytes : zkeyBytes;
      return new Response(body, { status: 200, statusText: 'OK' });
    });
    const out = await loadArtifacts({
      artifactsBaseUrl: 'https://x.test',
      fetch: fetchSpy as unknown as typeof globalThis.fetch,
    });
    expect(out.wasm).toEqual(wasmBytes);
    expect(out.zkey).toEqual(zkeyBytes);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('throws ArtifactLoadError on non-2xx', async () => {
    const fetchSpy = vi.fn(async () => new Response('not found', { status: 404, statusText: 'Not Found' }));
    await expect(
      loadArtifacts({
        artifactsBaseUrl: 'https://x.test',
        fetch: fetchSpy as unknown as typeof globalThis.fetch,
      }),
    ).rejects.toThrow(ArtifactLoadError);
  });

  it('wraps network errors as ArtifactLoadError', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('econnreset');
    });
    await expect(
      loadArtifacts({
        artifactsBaseUrl: 'https://x.test',
        fetch: fetchSpy as unknown as typeof globalThis.fetch,
      }),
    ).rejects.toThrow(ArtifactLoadError);
  });
});
