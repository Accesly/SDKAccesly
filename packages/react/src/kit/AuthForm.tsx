'use client';

import { useState, type FormEvent } from 'react';
import { useAccesly } from '../hooks/useAccesly.js';
import { useAuthProviders } from '../hooks/usePolicies.js';
import { useBranding } from '../hooks/useBranding.js';

/**
 * `<AuthForm>` — login + sign-up form que respeta los providers que el dev
 * habilitó en su dashboard.
 *
 * Lee `useAuthProviders()` y renderiza los botones correspondientes:
 *  - `email`: form email + password
 *  - `google`: botón Continuar con Google (Cognito Hosted UI)
 *  - `phone`: SMS OTP — pending (Fase 10)
 *
 * Si todos los providers están desactivados, no se renderiza nada (caso
 * de configuración inválida; el host UI debe pintar su propio error).
 *
 * Props:
 *  - `mode`: 'sign-in' (default) | 'sign-up'
 *  - `onSuccess`: callback al completar — la app debe navegar a la home.
 *  - `redirectUri`: para Google OAuth (default: window.location.origin + '/auth/callback')
 */
export interface AuthFormProps {
  readonly mode?: 'sign-in' | 'sign-up';
  readonly onSuccess?: () => void;
  readonly redirectUri?: string;
  readonly className?: string;
}

export function AuthForm(props: AuthFormProps): JSX.Element {
  const { auth } = useAccesly();
  const providers = useAuthProviders();
  const branding = useBranding();
  const mode = props.mode ?? 'sign-in';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [code, setCode] = useState('');

  const showEmail = providers.providers.includes('email');
  const showGoogle = providers.providers.includes('google');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'sign-up') {
        const r = await auth.signUp(email, password);
        if (!r.userConfirmed) {
          setNeedsConfirm(true);
        } else {
          await auth.signIn(email, password);
          props.onSuccess?.();
        }
      } else {
        await auth.signIn(email, password);
        props.onSuccess?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo continuar.');
    } finally {
      setSubmitting(false);
    }
  }

  async function onConfirm(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await auth.confirmSignUp(email, code);
      await auth.signIn(email, password);
      props.onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Código inválido.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={props.className ?? 'w-full max-w-sm space-y-4'}>
      <header className="text-center">
        <h1 className="text-xl font-bold">
          {branding.displayName ?? 'Tu wallet'}
        </h1>
        <p className="text-sm text-neutral-500 mt-1">
          {mode === 'sign-up' ? 'Crea tu cuenta' : 'Bienvenido de vuelta'}
        </p>
      </header>

      {needsConfirm ? (
        <form onSubmit={onConfirm} className="space-y-3">
          <p className="text-sm text-neutral-600">
            Te mandamos un código a {email}.
          </p>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            className="w-full rounded-xl border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-center font-mono text-lg bg-transparent"
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={submitting || code.length < 6}
            className="w-full py-3 rounded-xl text-white font-medium disabled:opacity-50"
            style={{ background: 'var(--accesly-primary, #8B6CE7)' }}
          >
            {submitting ? 'Confirmando…' : 'Confirmar'}
          </button>
        </form>
      ) : (
        <>
          {showEmail && (
            <form onSubmit={onSubmit} className="space-y-3">
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tucorreo@ejemplo.com"
                className="w-full rounded-xl border border-neutral-200 dark:border-neutral-700 px-4 py-3 bg-transparent"
              />
              <input
                type="password"
                autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Contraseña"
                className="w-full rounded-xl border border-neutral-200 dark:border-neutral-700 px-4 py-3 bg-transparent"
              />
              {error && <p className="text-xs text-red-500">{error}</p>}
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 rounded-xl text-white font-medium disabled:opacity-50"
                style={{ background: 'var(--accesly-primary, #8B6CE7)' }}
              >
                {submitting
                  ? '…'
                  : mode === 'sign-up'
                  ? 'Crear cuenta'
                  : 'Iniciar sesión'}
              </button>
            </form>
          )}

          {showEmail && showGoogle && (
            <div className="flex items-center gap-3 text-xs text-neutral-400">
              <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
              <span>o</span>
              <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
            </div>
          )}

          {showGoogle && (
            <button
              type="button"
              onClick={() => auth.signInWithGoogle(props.redirectUri)}
              className="w-full py-3 rounded-xl border border-neutral-200 dark:border-neutral-700 font-medium bg-white text-neutral-900 hover:bg-neutral-50"
            >
              Continuar con Google
            </button>
          )}

          {!showEmail && !showGoogle && (
            <p className="text-xs text-neutral-500 text-center">
              No hay providers configurados para esta app.
            </p>
          )}
        </>
      )}
    </div>
  );
}
