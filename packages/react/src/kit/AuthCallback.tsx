'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccesly } from '../hooks/useAccesly.js';

/**
 * `<AuthCallback>` — pantalla que se monta en la ruta `/auth/callback`
 * (o donde el integrador haya configurado el redirect de Cognito Hosted UI).
 *
 * Extrae `?code=…` del URL y llama `auth.handleAuthCallback(code, redirectUri)`
 * que intercambia el code por id/access/refresh tokens y los persiste vía
 * el token manager del SDK.
 *
 * Tras éxito llama `onSuccess()` (donde el integrador navega a `/wallet` u
 * onboarding). Tras error, render del mensaje + CTA "Volver a iniciar sesión".
 *
 * Props:
 *  - `redirectUri`: opcional, override del que se usó en `signInWithGoogle()`.
 *    Si se omite usa `window.location.origin + window.location.pathname`.
 *  - `onSuccess`: callback al completar (el integrador hace `router.push('/wallet')`).
 *  - `onError`: callback opcional para custom handling (logging, etc).
 *  - `loadingText` / `successText` / `errorText`: copy override.
 *  - `className`: estilo del wrapper.
 */
export interface AuthCallbackProps {
  readonly redirectUri?: string;
  readonly onSuccess?: () => void;
  readonly onError?: (err: Error) => void;
  readonly loadingText?: string;
  readonly errorText?: string;
  readonly className?: string;
}

export function AuthCallback(props: AuthCallbackProps): JSX.Element {
  const { auth } = useAccesly();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  // Evita doble llamada en StrictMode dev — el code es one-shot.
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const errParam = url.searchParams.get('error');

    if (errParam) {
      const desc = url.searchParams.get('error_description') ?? errParam;
      setError(desc);
      setStatus('error');
      props.onError?.(new Error(desc));
      return;
    }
    if (!code) {
      setError('Sin código en la URL. Vuelve a iniciar sesión.');
      setStatus('error');
      return;
    }

    void auth
      .handleAuthCallback(code, props.redirectUri)
      .then(() => {
        setStatus('success');
        props.onSuccess?.();
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setStatus('error');
        if (err instanceof Error) props.onError?.(err);
      });
  }, [auth, props]);

  if (status === 'error') {
    return (
      <div className={props.className ?? 'w-full max-w-sm mx-auto p-6 text-center space-y-3'}>
        <div className="text-3xl">⚠️</div>
        <p className="text-sm text-red-600">{error ?? props.errorText ?? 'Error de autenticación'}</p>
      </div>
    );
  }
  return (
    <div className={props.className ?? 'w-full max-w-sm mx-auto p-6 text-center space-y-3'}>
      <div className="text-3xl animate-pulse">⏳</div>
      <p className="text-sm text-neutral-600">{props.loadingText ?? 'Completando inicio de sesión…'}</p>
    </div>
  );
}
