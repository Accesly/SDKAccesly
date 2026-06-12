/**
 * Errors thrown by the `@accesly/zkemail` prover. Every error carries a
 * stable `name` so consumers can branch on it without `instanceof` brittleness
 * across realms (WebWorker ↔ main thread).
 */

export class ZkEmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZkEmailError';
  }
}

/** Raised when the supplied .eml cannot be parsed (no DKIM-Signature, malformed headers, etc.). */
export class EmlParseError extends ZkEmailError {
  constructor(message: string) {
    super(message);
    this.name = 'EmlParseError';
  }
}

/** Raised when DKIM-Signature header is missing required tags or uses an unsupported algorithm. */
export class DkimSignatureError extends ZkEmailError {
  constructor(message: string) {
    super(message);
    this.name = 'DkimSignatureError';
  }
}

/** Raised when the canonicalized header exceeds the circuit's `maxHeadersLength` (1536 bytes per D3). */
export class HeaderCapExceededError extends ZkEmailError {
  readonly actualBytes: number;
  readonly capBytes: number;
  constructor(actual: number, cap: number) {
    super(
      `canonicalized header is ${actual} bytes, circuit cap is ${cap}. ` +
        `This email cannot be used for recovery. See D3 in accesly-zkemail/docs/Design_Decisions.md.`,
    );
    this.name = 'HeaderCapExceededError';
    this.actualBytes = actual;
    this.capBytes = cap;
  }
}

/** Raised when the prover cannot download circuit artifacts (wasm / zkey) from the configured CDN. */
export class ArtifactLoadError extends ZkEmailError {
  readonly url: string;
  override readonly cause?: unknown;
  constructor(url: string, message: string, cause?: unknown) {
    super(`${message} (${url})`);
    this.name = 'ArtifactLoadError';
    this.url = url;
    this.cause = cause;
  }
}

/** Raised when snarkjs fails to generate a witness or proof. */
export class ProofGenerationError extends ZkEmailError {
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ProofGenerationError';
    this.cause = cause;
  }
}
