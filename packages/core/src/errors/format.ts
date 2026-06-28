/**
 * `formatError(err, opts?)` — convierte cualquier error que produzca el SDK
 * (incluido el browser, WebAuthn, fetch, Cognito) en un mensaje human-readable
 * apto para mostrar al user. Reemplaza el `describeError` que cada integrador
 * escribe a mano en su `lib/errors.ts`.
 *
 * Locale: `'es'` (default) o `'en'`. Monolingüe por ahora — i18n completo
 * (locales adicionales, ICU plural rules) llega en una siguiente release.
 *
 * No reemplaza el `error.name` / `error.message` originales — la app sigue
 * pudiendo inspeccionarlos para telemetry. Esta función produce *solo* el
 * string que vas a renderizar.
 */

import {
  AccesslyApiError,
  AuthError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ValidationError,
} from '../api/errors.js';

export type FormatErrorLocale = 'es' | 'en';

export interface FormatErrorOptions {
  /** `'es'` (default) o `'en'`. */
  readonly locale?: FormatErrorLocale;
}

interface Message {
  readonly es: string;
  readonly en: string;
}

const MESSAGES = {
  unknown: {
    es: 'Ocurrió un error inesperado.',
    en: 'Something went wrong.',
  },
  auth_expired: {
    es: 'Tu sesión expiró. Volvé a iniciar sesión.',
    en: 'Your session expired. Please sign in again.',
  },
  network: {
    es: 'No se pudo contactar al backend. Revisá tu conexión.',
    en: "Couldn't reach the backend. Check your connection.",
  },
  rate_limit: {
    es: 'Demasiadas solicitudes. Esperá unos segundos y volvé a intentar.',
    en: 'Too many requests. Wait a few seconds and try again.',
  },
  not_found: {
    es: 'El recurso solicitado no existe.',
    en: "Couldn't find that resource.",
  },
  server: {
    es: 'El servidor tuvo un problema. Intentá de nuevo en un momento.',
    en: 'Server hit a problem. Try again in a moment.',
  },
  webauthn_cancelled: {
    es: 'No se completó la verificación biométrica. Asegurate de tener un passkey activo (Touch ID, Face ID, Windows Hello o llave de seguridad).',
    en: 'Biometric verification was cancelled. Make sure you have an active passkey (Touch ID, Face ID, Windows Hello, or a security key).',
  },
  webauthn_unsupported: {
    es: 'Este navegador o autenticador no soporta WebAuthn PRF. Usá Chrome 116+, Edge 116+ o Safari 18+ con un passkey nativo del sistema.',
    en: 'This browser or authenticator does not support WebAuthn PRF. Use Chrome 116+, Edge 116+ or Safari 18+ with a native OS passkey.',
  },
  no_local_credential: {
    es: 'Este dispositivo no tiene la credencial de tu wallet. Usá Recuperar wallet con tu email y contraseña.',
    en: "This device doesn't have your wallet credential. Use Recover wallet with your email and password.",
  },
  not_implemented: {
    es: 'Esta funcionalidad aún no está implementada en el SDK.',
    en: 'This feature is not implemented in the SDK yet.',
  },
} as const satisfies Record<string, Message>;

type MessageKey = keyof typeof MESSAGES;

function localize(key: MessageKey, locale: FormatErrorLocale): string {
  return MESSAGES[key][locale];
}

/**
 * Convierte un error en mensaje humano. Trata de matchear el tipo y el shape
 * en este orden:
 *
 *   1. Errores tipados del SDK (`AuthError`, `NetworkError`, ...) → mensaje
 *      apropiado de la matriz.
 *   2. Errores conocidos por `error.name` (`NotAllowedError` de WebAuthn,
 *      `NotImplementedYetError` de los namespaces stub, etc.).
 *   3. Heurísticas sobre el `error.message` (regex de "fetch", "passkey",
 *      "credential", "PRF") — fallback razonable para errores no tipados que
 *      vienen de dependencias.
 *   4. `error.message` original.
 *   5. `MESSAGES.unknown` para non-Error inputs.
 *
 * @example
 *   try { await wallet.bootstrap({ email, password }); }
 *   catch (e) { setError(formatError(e)); }
 */
export function formatError(err: unknown, opts: FormatErrorOptions = {}): string {
  const locale = opts.locale ?? 'es';
  const t = (k: MessageKey) => localize(k, locale);

  // 1. Errores tipados del SDK.
  if (err instanceof RateLimitError) return t('rate_limit');
  if (err instanceof NotFoundError) return t('not_found');
  if (err instanceof AuthError) return t('auth_expired');
  if (err instanceof NetworkError) return t('network');
  if (err instanceof ServerError) return t('server');
  if (err instanceof ValidationError) {
    // Validation errors devuelven contexto útil — preservar el message.
    return err.message || t('unknown');
  }
  if (err instanceof AccesslyApiError) {
    return err.message || t('unknown');
  }

  // 2. Errores conocidos por nombre.
  if (err instanceof Error) {
    const name = err.name;
    const msg = err.message ?? '';

    if (name === 'NotImplementedYetError') return t('not_implemented');

    // Browser WebAuthn cancellation / user-decline.
    if (name === 'NotAllowedError') return t('webauthn_cancelled');
    if (name === 'NotSupportedError') return t('webauthn_unsupported');
    if (name === 'AbortError' && /credentials|webauthn/i.test(msg)) {
      return t('webauthn_cancelled');
    }

    // 3. Heurísticas sobre message.
    if (/PRF/i.test(msg) || /no soporta WebAuthn/i.test(msg)) {
      return t('webauthn_unsupported');
    }
    // CredentialRecord chequea ANTES que el cancel heurístico (que también
    // matchearía "credential" + "no").
    if (/CredentialRecord/i.test(msg)) {
      return t('no_local_credential');
    }
    if (/passkey|credential/i.test(msg) && /no|missing|cancel/i.test(msg)) {
      return t('webauthn_cancelled');
    }
    if (/failed to fetch|networkerror|network request|ENOTFOUND/i.test(msg)) {
      return t('network');
    }
    if (/unauthor/i.test(msg) || /expired/i.test(msg)) {
      return t('auth_expired');
    }

    // 4. Fallback al message original.
    return msg || t('unknown');
  }

  // 5. Non-Error throws.
  if (typeof err === 'string' && err.trim().length > 0) return err;
  return t('unknown');
}
