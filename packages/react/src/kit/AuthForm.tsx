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
 * **Theming**: usa la cadena `var(--accesly-X, var(--X, fallback))` para
 * cada color/border/background. Eso quiere decir:
 *  1. Si el integrador define `--accesly-card` (etc.) → wins.
 *  2. Si no, pero define `--card` (siguiendo la convención del example
 *     app) → wins.
 *  3. Sino, hardcoded fallback que funciona en light mode.
 * En la práctica esto hace que la kit-form se vea idéntica al Landing
 * cuando se monta dentro del shell del example, y siga siendo usable
 * standalone para integradores sin design tokens propios.
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
    <div className={props.className ?? 'w-full max-w-sm mx-auto'}>
      <header className="text-center" style={{ marginBottom: 24 }}>
        <div
          aria-hidden
          style={{
            width: 56,
            height: 56,
            borderRadius: 18,
            background: 'var(--accesly-grad, var(--grad, linear-gradient(135deg, #A98DF0, #45C9A8)))',
            boxShadow: '0 12px 32px rgba(139,108,231,.28)',
            margin: '0 auto 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
          }}
        >
          {mode === 'sign-up' ? <PlusIcon /> : <KeyIcon />}
        </div>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: '-0.02em',
            color: 'var(--accesly-ink, var(--ink, #261E33))',
            margin: 0,
          }}
        >
          {mode === 'sign-up' ? 'Crea tu cuenta' : 'Bienvenido de vuelta'}
        </h1>
        <p
          style={{
            fontSize: 13.5,
            color: 'var(--accesly-muted, var(--ink2, #6B5F78))',
            marginTop: 6,
            lineHeight: 1.5,
          }}
        >
          {mode === 'sign-up'
            ? 'Sin seed phrases. Tu llave nunca toca nuestros servidores.'
            : 'Entra con tu correo o tu cuenta de Google.'}
        </p>
      </header>

      {needsConfirm ? (
        <form onSubmit={onConfirm} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p
            style={{
              fontSize: 13,
              color: 'var(--accesly-muted, var(--ink2, #6B5F78))',
              textAlign: 'center',
            }}
          >
            Te mandamos un código a <strong>{email}</strong>.
          </p>
          <Input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            maxLength={6}
            style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: 18, letterSpacing: 4 }}
          />
          {error && <ErrorPill>{error}</ErrorPill>}
          <PrimaryButton type="submit" disabled={submitting || code.length < 6}>
            {submitting ? 'Confirmando…' : 'Confirmar'}
          </PrimaryButton>
        </form>
      ) : (
        <>
          {showEmail && (
            <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tucorreo@ejemplo.com"
              />
              <Input
                type="password"
                autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Contraseña"
              />
              {error && <ErrorPill>{error}</ErrorPill>}
              <PrimaryButton type="submit" disabled={submitting}>
                {submitting
                  ? '…'
                  : mode === 'sign-up'
                    ? 'Crear cuenta'
                    : 'Iniciar sesión'}
              </PrimaryButton>
            </form>
          )}

          {showEmail && showGoogle && (
            <div
              className="flex items-center gap-3"
              style={{
                margin: '18px 0',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.08em',
                color: 'var(--accesly-muted2, var(--ink3, #9E95A7))',
                textTransform: 'uppercase',
              }}
            >
              <div
                style={{
                  height: 1,
                  flex: 1,
                  background: 'var(--accesly-line, var(--line, rgba(38,30,51,.10)))',
                }}
              />
              <span>o</span>
              <div
                style={{
                  height: 1,
                  flex: 1,
                  background: 'var(--accesly-line, var(--line, rgba(38,30,51,.10)))',
                }}
              />
            </div>
          )}

          {showGoogle && (
            <button
              type="button"
              onClick={() => auth.signInWithGoogle(props.redirectUri)}
              className="w-full flex items-center justify-center gap-3 transition"
              style={{
                height: 52,
                borderRadius: 14,
                border: '1px solid var(--accesly-line, var(--line, rgba(38,30,51,.10)))',
                background: 'var(--accesly-card, var(--card, #FFFFFF))',
                color: 'var(--accesly-ink, var(--ink, #261E33))',
                fontSize: 14.5,
                fontWeight: 700,
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background =
                  'var(--accesly-card2, var(--card2, rgba(0,0,0,.025)))';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background =
                  'var(--accesly-card, var(--card, #FFFFFF))';
              }}
            >
              <GoogleG />
              Continuar con Google
            </button>
          )}

          {!showEmail && !showGoogle && (
            <p
              style={{
                fontSize: 12,
                color: 'var(--accesly-muted, var(--ink2, #6B5F78))',
                textAlign: 'center',
              }}
            >
              No hay providers configurados para esta app.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/* ─── Subcomponents ─────────────────────────────────────────────────────── */

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { style, ...rest } = props;
  return (
    <input
      {...rest}
      style={{
        width: '100%',
        height: 52,
        padding: '0 16px',
        borderRadius: 14,
        border: '1px solid var(--accesly-line, var(--line, rgba(38,30,51,.10)))',
        background: 'var(--accesly-card, var(--card, #FFFFFF))',
        color: 'var(--accesly-ink, var(--ink, #261E33))',
        fontSize: 15,
        outline: 'none',
        transition: 'border-color 120ms, box-shadow 120ms',
        ...style,
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor =
          'var(--accesly-primary, var(--lav, #8B6CE7))';
        e.currentTarget.style.boxShadow =
          '0 0 0 3px var(--accesly-primary-soft, var(--lav-soft, rgba(139,108,231,.18)))';
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor =
          'var(--accesly-line, var(--line, rgba(38,30,51,.10)))';
        e.currentTarget.style.boxShadow = 'none';
      }}
    />
  );
}

function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { style, ...rest } = props;
  return (
    <button
      {...rest}
      style={{
        width: '100%',
        height: 52,
        marginTop: 4,
        borderRadius: 14,
        border: 'none',
        background: 'var(--accesly-grad, var(--grad, linear-gradient(135deg, #A98DF0, #45C9A8)))',
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: 700,
        cursor: rest.disabled ? 'not-allowed' : 'pointer',
        opacity: rest.disabled ? 0.5 : 1,
        boxShadow: '0 8px 24px -8px rgba(139,108,231,.55)',
        transition: 'transform 80ms, box-shadow 120ms',
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!rest.disabled) {
          e.currentTarget.style.boxShadow = '0 10px 30px -8px rgba(139,108,231,.7)';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = '0 8px 24px -8px rgba(139,108,231,.55)';
      }}
      onMouseDown={(e) => {
        if (!rest.disabled) e.currentTarget.style.transform = 'scale(.985)';
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = 'scale(1)';
      }}
    />
  );
}

function ErrorPill({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 12.5,
        padding: '8px 12px',
        borderRadius: 10,
        background: 'rgba(244,113,116,.10)',
        color: '#c92a2a',
        textAlign: 'center',
      }}
    >
      {children}
    </div>
  );
}

/* ─── Icons ─────────────────────────────────────────────────────────────── */

function KeyIcon() {
  return (
    <svg width={26} height={26} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M15 7a4 4 0 1 1-3.9 5H8v3H5v3H2v-3.5L8.5 8.6A4 4 0 0 1 15 7z"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={15.5} cy={8.5} r={1} fill="currentColor" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width={28} height={28} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
      />
    </svg>
  );
}

function GoogleG() {
  return (
    <svg width={18} height={18} viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8a12 12 0 1 1 7.9-21l5.7-5.7A20 20 0 1 0 24 44a20 20 0 0 0 19.6-23.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8A12 12 0 0 1 24 12a12 12 0 0 1 7.9 3l5.7-5.7A20 20 0 0 0 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44a20 20 0 0 0 13.5-5.2l-6.2-5.3A12 12 0 0 1 12.7 28l-6.5 5A20 20 0 0 0 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.3C39.9 36.2 44 31 44 24c0-1.2-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}
