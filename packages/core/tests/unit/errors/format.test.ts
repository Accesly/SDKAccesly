import { describe, expect, it } from 'vitest';
import {
  AccesslyApiError,
  AuthError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ValidationError,
} from '../../../src/api/errors.js';
import { formatError } from '../../../src/errors/format.js';

const status = { status: 401 } as const;

describe('errors/formatError', () => {
  describe('typed API errors', () => {
    it('maps AuthError to "sesión expiró"', () => {
      const e = new AuthError('Token expired', { status: 401 });
      expect(formatError(e)).toMatch(/sesión|sign in/i);
    });

    it('maps NetworkError to "no se pudo contactar"', () => {
      const e = new NetworkError('fetch failed', {});
      expect(formatError(e)).toMatch(/contactar|reach/i);
    });

    it('maps RateLimitError to "demasiadas solicitudes"', () => {
      const e = new RateLimitError('Too many', { status: 429 });
      expect(formatError(e)).toMatch(/demasiadas|too many/i);
    });

    it('maps NotFoundError to "no existe"', () => {
      const e = new NotFoundError('not found', { status: 404 });
      expect(formatError(e)).toMatch(/no existe|find/i);
    });

    it('maps ServerError to "servidor tuvo un problema"', () => {
      const e = new ServerError('500', { status: 500 });
      expect(formatError(e)).toMatch(/servidor|server/i);
    });

    it('preserves ValidationError message (it has context)', () => {
      const e = new ValidationError('amountStroops must be > 0', {
        status: 400,
      });
      expect(formatError(e)).toBe('amountStroops must be > 0');
    });

    it('preserves AccesslyApiError message', () => {
      const e = new AccesslyApiError('custom', status);
      expect(formatError(e)).toBe('custom');
    });
  });

  describe('locale switching', () => {
    it('returns English when opts.locale === "en"', () => {
      const e = new NetworkError('fetch failed', {});
      expect(formatError(e, { locale: 'en' })).toMatch(/reach the backend/i);
    });

    it('returns Spanish by default', () => {
      const e = new NetworkError('fetch failed', {});
      expect(formatError(e)).toMatch(/contactar/i);
    });
  });

  describe('browser WebAuthn errors', () => {
    it('maps NotAllowedError to passkey cancellation message', () => {
      const e = new Error('user cancelled');
      e.name = 'NotAllowedError';
      expect(formatError(e)).toMatch(/biométrica|biometric/i);
    });

    it('detects PRF-related messages as unsupported', () => {
      const e = new Error('Tu navegador no soporta WebAuthn PRF');
      expect(formatError(e)).toMatch(/PRF|Chrome 116/i);
    });

    it('detects NotImplementedYetError', () => {
      const e = new Error('not impl');
      e.name = 'NotImplementedYetError';
      expect(formatError(e)).toMatch(/implementada|implemented/i);
    });
  });

  describe('heuristics on message', () => {
    it('detects "failed to fetch" → network', () => {
      const e = new Error('Failed to fetch');
      expect(formatError(e)).toMatch(/contactar|reach/i);
    });

    it('detects "unauthorized" → auth_expired', () => {
      const e = new Error('Unauthorized request');
      expect(formatError(e)).toMatch(/sesión|sign in/i);
    });

    it('detects "no local CredentialRecord" → no_local_credential', () => {
      const e = new Error('no local CredentialRecord for alice');
      expect(formatError(e)).toMatch(/dispositivo|device/i);
    });
  });

  describe('fallbacks', () => {
    it('returns original message when no rule matches', () => {
      expect(formatError(new Error('custom failure'))).toBe('custom failure');
    });

    it('returns the input when it is a non-empty string', () => {
      expect(formatError('plain string err')).toBe('plain string err');
    });

    it('returns "unknown" message for non-Error / empty input', () => {
      expect(formatError(undefined)).toMatch(/inesperado|wrong/i);
      expect(formatError(null)).toMatch(/inesperado|wrong/i);
      expect(formatError({})).toMatch(/inesperado|wrong/i);
    });
  });
});
