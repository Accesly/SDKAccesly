/**
 * High-level prove() entrypoint.
 *
 * Flow:
 *   1. Parse .eml.
 *   2. Build circuit inputs.
 *   3. Load wasm + zkey from CDN (cached after first call).
 *   4. Invoke snarkjs.groth16.fullProve in-thread.
 *   5. Format output for the Soroban contract.
 *
 * snarkjs is dynamically imported so consumers who never call this
 * function don't pay its (~3 MB) bundle cost.
 *
 * In a real browser app the caller should run this inside a WebWorker so
 * the 60-300s of CPU work doesn't block the UI. This module exposes the
 * core logic only — the worker boundary is the consumer app's
 * responsibility (single-file Worker, Comlink, etc.).
 */

import { ProofGenerationError } from '../errors';
import type { CircuitInputs, ProveResult, RecoveryParams, ZkEmailProverConfig } from '../types';
import { buildCircuitInputs } from '../inputs/build';
import { parseEml } from '../eml/parse';
import { formatForSoroban } from '../soroban/format';
import { loadArtifacts, type CircuitArtifacts } from './load-artifacts';

export interface ProveArgs {
  readonly eml: string;
  readonly recovery: RecoveryParams;
  readonly rsaModulus: bigint;
}

/**
 * Creates a stateful prover that caches the downloaded artifacts. Calling
 * `prove()` multiple times only hits the CDN once.
 */
export function createZkEmailProver(config: ZkEmailProverConfig) {
  let artifactsPromise: Promise<CircuitArtifacts> | null = null;

  function ensureArtifacts() {
    if (!artifactsPromise) artifactsPromise = loadArtifacts(config);
    return artifactsPromise;
  }

  return {
    /** Eagerly start the artifact download (e.g. on app boot / Service Worker pre-warm). */
    preload(): Promise<void> {
      return ensureArtifacts().then(() => undefined);
    },

    /** Generates a Groth16 proof and formats it for the Soroban verifier. */
    async prove(args: ProveArgs): Promise<ProveResult> {
      const start = nowMs();
      const parsed = parseEml(args.eml);
      const inputs = buildCircuitInputs({
        parsed,
        rsaModulus: args.rsaModulus,
        recovery: args.recovery,
      });
      const { wasm, zkey } = await ensureArtifacts();
      const snarkjs = await loadSnarkjs();
      let proof: unknown;
      let publicSignals: unknown;
      try {
        const result = await snarkjs.groth16.fullProve(
          inputs as unknown as Record<string, unknown>,
          wasm,
          zkey,
        );
        proof = result.proof;
        publicSignals = result.publicSignals;
      } catch (cause) {
        throw new ProofGenerationError(
          'snarkjs.groth16.fullProve failed — likely a witness-mismatch (bad inputs) or zkey/wasm corruption',
          cause,
        );
      }
      const bundle = formatForSoroban(
        proof as Parameters<typeof formatForSoroban>[0],
        publicSignals as readonly string[],
      );
      return { bundle, elapsedMs: nowMs() - start };
    },

    /** Lower-level: skip eml parsing, prove from already-built inputs. */
    async proveFromInputs(inputs: CircuitInputs): Promise<ProveResult> {
      const start = nowMs();
      const { wasm, zkey } = await ensureArtifacts();
      const snarkjs = await loadSnarkjs();
      const result = await snarkjs.groth16.fullProve(
        inputs as unknown as Record<string, unknown>,
        wasm,
        zkey,
      );
      const bundle = formatForSoroban(
        result.proof as Parameters<typeof formatForSoroban>[0],
        result.publicSignals as readonly string[],
      );
      return { bundle, elapsedMs: nowMs() - start };
    },
  };
}

export type ZkEmailProver = ReturnType<typeof createZkEmailProver>;

interface SnarkjsLike {
  readonly groth16: {
    fullProve(
      input: Record<string, unknown>,
      wasm: Uint8Array | string,
      zkey: Uint8Array | string,
    ): Promise<{ proof: unknown; publicSignals: unknown }>;
  };
}

async function loadSnarkjs(): Promise<SnarkjsLike> {
  // Dynamic import keeps snarkjs out of the consumer's main bundle.
  // `@ts-expect-error` because snarkjs has no published types and we
  // intentionally don't ship our own.
  // @ts-expect-error -- no types
  const mod = (await import('snarkjs')) as SnarkjsLike;
  if (!mod?.groth16?.fullProve) {
    throw new ProofGenerationError('snarkjs module loaded but groth16.fullProve is missing');
  }
  return mod;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
