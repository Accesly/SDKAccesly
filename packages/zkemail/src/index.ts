/**
 * `@accesly/zkemail` — public entrypoint.
 *
 * The package is an OPTIONAL peer of `@accesly/core`. Consumers who never
 * call `auth.recover()` don't need to install it — `@accesly/core` ships a
 * stub that throws `RecoveryNotAvailableError` until this package is wired
 * in by the app (typically lazy-imported on the `/recover` route).
 */

export {
  ZkEmailError,
  EmlParseError,
  DkimSignatureError,
  HeaderCapExceededError,
  ArtifactLoadError,
  ProofGenerationError,
} from './errors';

export type {
  RecoveryParams,
  CircuitInputs,
  SnarkjsProof,
  SorobanProofBundle,
  ZkEmailProverConfig,
  ProveResult,
} from './types';

export { createZkEmailProver } from './prover/prove';
export type { ZkEmailProver, ProveArgs } from './prover/prove';
export { buildCircuitInputs } from './inputs/build';
export { parseEml, buildSignedHeaderBytes } from './eml/parse';
export type { ParsedEml, DkimTags, ParsedHeader } from './eml/parse';
export { formatForSoroban } from './soroban/format';

/**
 * Circuit cap, per D3 in accesly-zkemail. Covers p95 of all Gmail headers
 * and ~99% of Google-domain (the realistic recovery target).
 */
export const MAX_HEADERS_LENGTH = 1536;

/**
 * Number of public signals the circuit emits (7 logical signals × `[low, high]`).
 * Must match the Soroban verifier's `NUM_PUBLIC_SIGNALS`.
 */
export const NUM_PUBLIC_SIGNALS = 14;
