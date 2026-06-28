/**
 * Typed error hierarchy for the Accesly API client.
 *
 * Every error thrown by the API client is a subclass of `AccesslyApiError`,
 * so consumers can do:
 *   try { ... } catch (e) {
 *     if (e instanceof AuthError) return relogin();
 *     if (e instanceof NetworkError) return retryLater();
 *     throw e;
 *   }
 */

export interface AccesslyApiErrorOptions {
  readonly status: number;
  readonly code?: string | undefined;
  readonly requestId?: string | undefined;
  readonly cause?: unknown;
}

export class AccesslyApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  override readonly cause: unknown;

  constructor(message: string, opts: AccesslyApiErrorOptions) {
    super(message);
    this.name = 'AccesslyApiError';
    this.status = opts.status;
    this.code = opts.code ?? `HTTP_${opts.status}`;
    this.requestId = opts.requestId;
    this.cause = opts.cause;
  }
}

/** 401 / 403 — caller should re-authenticate (or check appId/permissions). */
export class AuthError extends AccesslyApiError {
  constructor(message: string, opts: AccesslyApiErrorOptions) {
    super(message, opts);
    this.name = 'AuthError';
  }
}

/** 400 / 422 — request body or query was malformed. */
export class ValidationError extends AccesslyApiError {
  constructor(message: string, opts: AccesslyApiErrorOptions) {
    super(message, opts);
    this.name = 'ValidationError';
  }
}

/**
 * 409 with code `WALLET_NOT_ENROLLED` — the wallet does not have the
 * `biometric-tx` context rule for the asset the caller is trying to use.
 *
 * The SDK auto-handles this by calling `wallet.activateAsset(asset)` and
 * retrying the original operation. Callers don't normally see this error
 * surface to the UI; it's only thrown if the auto-retry itself fails (e.g.
 * the unlock-for-signing material expired, or the backend rejected the
 * activate). See `withAutoEnroll` in the React hook.
 */
export class WalletNotEnrolledError extends AccesslyApiError {
  readonly asset: 'XLM' | 'USDC';

  constructor(message: string, opts: AccesslyApiErrorOptions & { asset: 'XLM' | 'USDC' }) {
    super(message, opts);
    this.name = 'WalletNotEnrolledError';
    this.asset = opts.asset;
  }
}

/**
 * 409 with code `G_NOT_BOOTSTRAPPED` — the user's G-address bridge (classic
 * Stellar account derived from the same owner ed25519) has not been created
 * on-chain yet. Flows that need the G as helper (swap-sdex, sweep, fiat
 * onramp/KYC) tell the SDK to call `wallet.bootstrapG()` first.
 *
 * The React adapter auto-handles this for `tx.swapViaSdex` and
 * `wallet.sweepGToSA` (both receive the unlocked material). For `fiat.*` and
 * `kyc.*` the caller still has to bootstrap explicitly because those methods
 * don't take key material.
 */
export class GAddressNotBootstrappedError extends AccesslyApiError {
  constructor(message: string, opts: AccesslyApiErrorOptions) {
    super(message, opts);
    this.name = 'GAddressNotBootstrappedError';
  }
}

/**
 * 409 with code `G_MISSING_TRUSTLINE` — the G-address is bootstrapped but
 * doesn't trust the asset the caller is trying to move through it. Flows that
 * route via the G (swap-sdex with EURC, future fiat ramps on non-USDC, etc.)
 * tell the SDK to add the trustline first.
 *
 * The React adapter auto-handles this for `tx.swapViaSdex` via the
 * `withAutoAddTrustlineG` wrapper — `wallet.addTrustlineG` runs with the same
 * unlocked material and then the original call retries.
 */
export class GMissingTrustlineError extends AccesslyApiError {
  readonly asset: 'USDC' | 'EURC';

  constructor(message: string, opts: AccesslyApiErrorOptions & { asset: 'USDC' | 'EURC' }) {
    super(message, opts);
    this.name = 'GMissingTrustlineError';
    this.asset = opts.asset;
  }
}

/** 404 — resource does not exist. */
export class NotFoundError extends AccesslyApiError {
  constructor(message: string, opts: AccesslyApiErrorOptions) {
    super(message, opts);
    this.name = 'NotFoundError';
  }
}

/** 429 — caller should back off. */
export class RateLimitError extends AccesslyApiError {
  readonly retryAfterSeconds: number | undefined;

  constructor(
    message: string,
    opts: AccesslyApiErrorOptions & { retryAfterSeconds?: number | undefined },
  ) {
    super(message, opts);
    this.name = 'RateLimitError';
    this.retryAfterSeconds = opts.retryAfterSeconds;
  }
}

/** 5xx — server-side problem, the client already exhausted its retries. */
export class ServerError extends AccesslyApiError {
  constructor(message: string, opts: AccesslyApiErrorOptions) {
    super(message, opts);
    this.name = 'ServerError';
  }
}

/** Fetch threw (DNS fail, TLS error, abort, etc.) or response was not parseable. */
export class NetworkError extends AccesslyApiError {
  constructor(message: string, opts: Omit<AccesslyApiErrorOptions, 'status'>) {
    super(message, { ...opts, status: 0 });
    this.name = 'NetworkError';
  }
}

/**
 * Maps an HTTP status code + body to the right error subclass.
 */
export function errorForResponse(
  status: number,
  body: unknown,
  requestId: string | undefined,
): AccesslyApiError {
  const message = extractMessage(body) ?? `HTTP ${status}`;
  const code = extractCode(body);
  const opts: AccesslyApiErrorOptions = { status, code, requestId };
  if (status === 401 || status === 403) return new AuthError(message, opts);
  if (status === 404) return new NotFoundError(message, opts);
  if (status === 429) {
    return new RateLimitError(message, {
      ...opts,
      retryAfterSeconds: extractRetryAfter(body),
    });
  }
  if (status === 409 && code === 'WALLET_NOT_ENROLLED') {
    const asset = extractAsset(body);
    if (asset === 'XLM' || asset === 'USDC') {
      return new WalletNotEnrolledError(message, { ...opts, asset });
    }
  }
  if (status === 409 && code === 'G_NOT_BOOTSTRAPPED') {
    return new GAddressNotBootstrappedError(message, opts);
  }
  if (status === 409 && code === 'G_MISSING_TRUSTLINE') {
    const asset = extractAsset(body);
    if (asset === 'USDC' || asset === 'EURC') {
      return new GMissingTrustlineError(message, { ...opts, asset });
    }
  }
  if (status >= 400 && status < 500) return new ValidationError(message, opts);
  if (status >= 500) return new ServerError(message, opts);
  return new AccesslyApiError(message, opts);
}

function extractMessage(body: unknown): string | undefined {
  if (body && typeof body === 'object') {
    const b = body as { message?: unknown; error?: unknown };
    if (typeof b.message === 'string') return b.message;
    if (typeof b.error === 'string') return b.error;
  }
  return undefined;
}

function extractCode(body: unknown): string | undefined {
  if (body && typeof body === 'object') {
    const b = body as { code?: unknown };
    if (typeof b.code === 'string') return b.code;
  }
  return undefined;
}

function extractRetryAfter(body: unknown): number | undefined {
  if (body && typeof body === 'object') {
    const b = body as { retryAfter?: unknown };
    if (typeof b.retryAfter === 'number' && b.retryAfter >= 0) return b.retryAfter;
  }
  return undefined;
}

function extractAsset(body: unknown): 'XLM' | 'USDC' | 'EURC' | undefined {
  if (body && typeof body === 'object') {
    const b = body as { asset?: unknown };
    if (b.asset === 'XLM' || b.asset === 'USDC' || b.asset === 'EURC') return b.asset;
  }
  return undefined;
}
