import { describe, expect, it } from 'vitest';
import { AccesslyApiError, AuthError, NetworkError, ServerError } from '@accesly/core';
import { isSorobanDeployPendingError } from '../src/hooks/sorobanDeployStatus.js';

describe('isSorobanDeployPendingError', () => {
  it('matches txSorobanInvalid wrapped in a 502 ServerError', () => {
    const err = new ServerError(
      'soroban submit failed: Soroban sendTransaction rejected: txSorobanInvalid',
      { status: 502 },
    );
    expect(isSorobanDeployPendingError(err)).toBe(true);
  });

  it('matches scecExceededLimit', () => {
    const err = new ServerError('sceStorage::scecExceededLimit on write', { status: 502 });
    expect(isSorobanDeployPendingError(err)).toBe(true);
  });

  it('matches via the error code field', () => {
    const err = new ServerError('opaque message', { status: 502, code: 'TXSOROBANINVALID' });
    expect(isSorobanDeployPendingError(err)).toBe(true);
  });

  it('does NOT match unrelated server errors', () => {
    expect(
      isSorobanDeployPendingError(
        new ServerError('internal database connection failed', { status: 500 }),
      ),
    ).toBe(false);
  });

  it('does NOT match auth or network errors', () => {
    expect(isSorobanDeployPendingError(new AuthError('unauthorized', { status: 401 }))).toBe(false);
    expect(isSorobanDeployPendingError(new NetworkError('fetch failed', {}))).toBe(false);
  });

  it('does NOT match plain Errors or non-error values', () => {
    expect(isSorobanDeployPendingError(new Error('txSorobanInvalid'))).toBe(false);
    expect(isSorobanDeployPendingError('txSorobanInvalid')).toBe(false);
    expect(isSorobanDeployPendingError(null)).toBe(false);
    expect(isSorobanDeployPendingError(undefined)).toBe(false);
  });

  it('passes through AccesslyApiError subclasses with deploy-pending message', () => {
    const err = new AccesslyApiError('soroban submit failed: timeout', { status: 502 });
    expect(isSorobanDeployPendingError(err)).toBe(true);
  });
});
