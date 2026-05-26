import { describe, expect, it } from 'vitest';
import {
  AccesslyApiError,
  AuthError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ValidationError,
  errorForResponse,
} from '../../../src/api/errors.js';

describe('api/errors', () => {
  it('classifies 400 as ValidationError', () => {
    const e = errorForResponse(400, { message: 'bad body' }, 'req-1');
    expect(e).toBeInstanceOf(ValidationError);
    expect(e.status).toBe(400);
    expect(e.message).toBe('bad body');
    expect(e.requestId).toBe('req-1');
  });

  it('classifies 401 as AuthError', () => {
    expect(errorForResponse(401, { error: 'Unauthorized' }, undefined)).toBeInstanceOf(AuthError);
  });

  it('classifies 403 as AuthError', () => {
    expect(errorForResponse(403, undefined, undefined)).toBeInstanceOf(AuthError);
  });

  it('classifies 404 as NotFoundError', () => {
    expect(errorForResponse(404, { message: 'no such wallet' }, undefined)).toBeInstanceOf(
      NotFoundError,
    );
  });

  it('classifies 429 as RateLimitError with retryAfter', () => {
    const e = errorForResponse(429, { message: 'slow down', retryAfter: 12 }, undefined);
    expect(e).toBeInstanceOf(RateLimitError);
    expect((e as RateLimitError).retryAfterSeconds).toBe(12);
  });

  it('classifies 422 as ValidationError (4xx default)', () => {
    expect(errorForResponse(422, undefined, undefined)).toBeInstanceOf(ValidationError);
  });

  it('classifies 500 as ServerError', () => {
    expect(errorForResponse(500, { message: 'oops' }, undefined)).toBeInstanceOf(ServerError);
  });

  it('classifies 503 as ServerError', () => {
    expect(errorForResponse(503, undefined, undefined)).toBeInstanceOf(ServerError);
  });

  it('falls back to AccesslyApiError for non-error statuses', () => {
    const e = errorForResponse(300, undefined, undefined);
    expect(e).toBeInstanceOf(AccesslyApiError);
    expect(e).not.toBeInstanceOf(AuthError);
  });

  it('uses HTTP_<status> as default code when body has none', () => {
    const e = errorForResponse(500, {}, undefined);
    expect(e.code).toBe('HTTP_500');
  });

  it('extracts code from body when present', () => {
    const e = errorForResponse(400, { code: 'INVALID_APPID', message: 'bad' }, undefined);
    expect(e.code).toBe('INVALID_APPID');
  });

  it('uses "HTTP <status>" as default message when body has none', () => {
    const e = errorForResponse(502, undefined, undefined);
    expect(e.message).toBe('HTTP 502');
  });
});
