/**
 * Fetches the circuit artifacts (wasm witness generator + zkey proving
 * key) from the configured CDN.
 *
 * Total payload ~282 MB brotli at cap 1536 (per
 * `accesly-zkemail/docs/Phase1_Measurements.md`). Real apps should:
 *
 *   - Pre-warm via Service Worker on app load (don't wait for the user to
 *     click "recover").
 *   - Use strong, immutable cache headers (CloudFront `max-age=31536000,
 *     immutable`) — combined with a versioned URL, the browser never
 *     re-downloads the zkey for the same ceremony tag.
 *   - Consider HTTP Range requests for progress UI + abort-resume on
 *     mobile networks.
 *
 * This loader is intentionally simple: one `fetch` per artifact, returns
 * `Uint8Array`. Callers wanting progress / streaming should inject a
 * custom `fetch` via `ZkEmailProverConfig.fetch`.
 */

import { ArtifactLoadError } from '../errors';
import type { ZkEmailProverConfig } from '../types';

export interface CircuitArtifacts {
  readonly wasm: Uint8Array;
  readonly zkey: Uint8Array;
}

/**
 * Resolves a `path` against the configured base, including the version
 * segment if provided. Example:
 *   base = "https://cdn.accesly.app/zkemail"
 *   ver  = "v1.0.0-ceremony-2026-08"
 *   path = "accesly_email.wasm"
 *   → "https://cdn.accesly.app/zkemail/v1.0.0-ceremony-2026-08/accesly_email.wasm"
 */
export function buildArtifactUrl(config: ZkEmailProverConfig, path: string): string {
  const base = config.artifactsBaseUrl.replace(/\/+$/, '');
  const ver = config.artifactVersion ? `/${encodeURIComponent(config.artifactVersion)}` : '';
  const cleanPath = path.replace(/^\/+/, '');
  return `${base}${ver}/${cleanPath}`;
}

export async function loadArtifacts(config: ZkEmailProverConfig): Promise<CircuitArtifacts> {
  const [wasm, zkey] = await Promise.all([
    fetchArtifact(config, 'accesly_email.wasm'),
    fetchArtifact(config, 'accesly_email_final.zkey'),
  ]);
  return { wasm, zkey };
}

async function fetchArtifact(
  config: ZkEmailProverConfig,
  path: string,
): Promise<Uint8Array> {
  const url = buildArtifactUrl(config, path);
  const fetchFn = config.fetch ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new ArtifactLoadError(url, 'no fetch implementation available');
  }
  let res: Response;
  try {
    res = await fetchFn(url, { method: 'GET' });
  } catch (cause) {
    throw new ArtifactLoadError(url, 'network error fetching artifact', cause);
  }
  if (!res.ok) {
    throw new ArtifactLoadError(url, `HTTP ${res.status} ${res.statusText}`);
  }
  try {
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch (cause) {
    throw new ArtifactLoadError(url, 'failed to read response body', cause);
  }
}
