'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useAccesly } from '../hooks/useAccesly.js';
import { useBranding } from '../hooks/useBranding.js';

/**
 * `<RecoveryFlow>` — wizard de recovery v2. Dos paths según cómo se registró
 * el user:
 *
 *  - **Email path**: email → OTP → password de Cognito → finalize.
 *  - **Google path**: sign-in con Google (re-auth) → OTP a su gmail →
 *    passphrase de recovery → finalize.
 *
 * Ambos paths usan el mismo `recovery.finalize` por debajo. El Google path
 * solo (a) auto-completa el email del JWT y (b) skipea el formulario inicial
 * porque ya tiene sesión de Cognito post-OAuth.
 *
 * **Integración del Google path**: cuando el user clickea "Continuar con
 * Google", seteamos un flag en `sessionStorage` ANTES del redirect a la
 * Hosted UI. La página `/auth/callback` del integrador debe checkear ese
 * flag y, si está set, navegar a `/recover` en vez del flow normal. El
 * RecoveryFlow detecta el flag + el auth.status al mount y reanuda el wizard.
 *
 * Sessión key: `accesly:recovery-via-google` = `'1'`.
 */
export interface RecoveryFlowProps {
  readonly onDone?: (result: { walletAddress: string; txHash: string }) => void;
  readonly onCancel?: () => void;
  readonly onError?: (err: Error) => void;
  /** Override del nombre de la passkey. Default = `branding.displayName ?? 'Accesly'`. */
  readonly passkeyRpName?: string;
  readonly className?: string;
}

type Step = 'method' | 'email-input' | 'otp' | 'working' | 'success' | 'error';
type Method = 'email' | 'google';

const RECOVERY_INTENT_KEY = 'accesly:recovery-via-google';

function readGoogleIntent(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(RECOVERY_INTENT_KEY) === '1';
  } catch {
    return false;
  }
}

function setGoogleIntent(on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (on) window.sessionStorage.setItem(RECOVERY_INTENT_KEY, '1');
    else window.sessionStorage.removeItem(RECOVERY_INTENT_KEY);
  } catch {
    /* private mode / quota — no-op */
  }
}

export function RecoveryFlow(props: RecoveryFlowProps): JSX.Element {
  const { recovery, auth } = useAccesly();
  const branding = useBranding();
  const rpName = props.passkeyRpName ?? branding.displayName ?? 'Accesly';

  const [step, setStep] = useState<Step>('method');
  const [method, setMethod] = useState<Method>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ walletAddress: string; txHash: string } | null>(null);

  /**
   * Resume del Google path post-OAuth: si encontramos el flag + sesión válida
   * al mount, saltamos directo al request del OTP con el email del JWT. El
   * usuario ya re-autenticó con Google en una pestaña diferente; este mount
   * es la vuelta del flow.
   */
  useEffect(() => {
    if (!readGoogleIntent()) return;
    if (auth.status !== 'authenticated') return;
    if (!auth.username) return;
    // Limpiar el flag inmediatamente para que un refresh accidental no
    // reanude un flow viejo.
    setGoogleIntent(false);
    setMethod('google');
    setEmail(auth.username);
    void (async () => {
      setSubmitting(true);
      try {
        const r = await recovery.requestOtp({ email: auth.username! });
        setCooldown(r.cooldownSeconds);
        setStep('otp');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo enviar el código.');
        setStep('error');
      } finally {
        setSubmitting(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status, auth.username]);

  function chooseMethod(m: Method) {
    setMethod(m);
    setError(null);
    if (m === 'email') {
      setStep('email-input');
      return;
    }
    // Google path: setea flag + dispara OAuth. El user vuelve a esta pantalla
    // post-callback con auth.status === 'authenticated'.
    setGoogleIntent(true);
    try {
      auth.signInWithGoogle();
    } catch (err) {
      setGoogleIntent(false);
      setError(
        err instanceof Error
          ? err.message
          : 'No se pudo iniciar el sign-in con Google.',
      );
    }
  }

  async function requestOtp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = await recovery.requestOtp({ email: email.trim() });
      setCooldown(r.cooldownSeconds);
      setStep('otp');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar el código.');
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyAndFinalize(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const verify = await recovery.verifyOtp({ email: email.trim(), code: code.trim() });
      setStep('working');
      const r = await recovery.finalize({
        email: email.trim(),
        password,
        recoveryJwt: verify.recoveryJwt,
        passkey: { rpName },
      });
      setResult({ walletAddress: r.walletAddress, txHash: r.txHash });
      setStep('success');
      props.onDone?.({ walletAddress: r.walletAddress, txHash: r.txHash });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStep('error');
      if (err instanceof Error) props.onError?.(err);
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Method selector ────────────────────────────────────────────────────────
  if (step === 'method') {
    return (
      <div className={props.className ?? 'w-full max-w-sm mx-auto'}>
        <header className="text-center" style={{ marginBottom: 22 }}>
          <div
            aria-hidden
            className="mx-auto flex items-center justify-center"
            style={{
              width: 56,
              height: 56,
              borderRadius: 18,
              background:
                'var(--accesly-grad, var(--grad, linear-gradient(135deg, #A98DF0, #45C9A8)))',
              boxShadow: '0 12px 32px rgba(139,108,231,.28)',
              color: '#fff',
            }}
          >
            <RecoverIcon />
          </div>
          <h2
            style={{
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              color: 'var(--accesly-ink, var(--ink, #261E33))',
              margin: '14px 0 6px',
            }}
          >
            Recuperar tu wallet
          </h2>
          <p
            style={{
              fontSize: 13.5,
              color: 'var(--accesly-muted, var(--ink2, #6B5F78))',
              lineHeight: 1.5,
              margin: 0,
            }}
          >
            Elige el método con el que te registraste originalmente.
          </p>
        </header>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <MethodCard
            onClick={() => chooseMethod('email')}
            disabled={submitting}
            iconBg="var(--accesly-primary-soft, var(--lav-soft, rgba(139,108,231,.14)))"
            iconColor="var(--accesly-primary, var(--lav-600, #7055C7))"
            icon={<EmailIcon />}
            title="Continuar con email"
            subtitle="Recibe un código por correo + tu password de Cognito"
          />
          <MethodCard
            onClick={() => chooseMethod('google')}
            disabled={submitting}
            iconBg="var(--accesly-card2, var(--card2, #F3F0F8))"
            iconColor="currentColor"
            icon={<GoogleG />}
            title="Continuar con Google"
            subtitle="Re-autentícate con la cuenta de Google que usaste al registrarte"
          />
        </div>

        {error && (
          <div
            style={{
              marginTop: 14,
              fontSize: 12.5,
              padding: '8px 12px',
              borderRadius: 10,
              background: 'rgba(244,113,116,.10)',
              color: '#c92a2a',
              textAlign: 'center',
            }}
          >
            {error}
          </div>
        )}

        {props.onCancel && (
          <button
            type="button"
            onClick={props.onCancel}
            className="w-full"
            style={{
              marginTop: 16,
              padding: '10px 0',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--accesly-muted, var(--ink2, #6B5F78))',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Cancelar
          </button>
        )}
      </div>
    );
  }

  // ─── Email path: pedir email ────────────────────────────────────────────────
  if (step === 'email-input') {
    return (
      <form
        onSubmit={requestOtp}
        className={props.className ?? 'w-full max-w-sm mx-auto'}
      >
        <StepHeader title="Recuperar wallet" subtitle="Te mandaremos un código a tu email. Necesitarás tu password de Cognito." />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FieldInput
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tucorreo@ejemplo.com"
          />
          {error && <ErrorPill>{error}</ErrorPill>}
          <PrimaryButton type="submit" disabled={submitting || !email}>
            {submitting ? 'Enviando…' : 'Enviar código'}
          </PrimaryButton>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setStep('method');
            }}
            style={{
              marginTop: 4,
              padding: '8px 0',
              fontSize: 12.5,
              fontWeight: 600,
              color: 'var(--accesly-muted, var(--ink2, #6B5F78))',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            ← Cambiar método
          </button>
        </div>
      </form>
    );
  }

  // ─── OTP + passphrase ───────────────────────────────────────────────────────
  if (step === 'otp') {
    const isGoogle = method === 'google';
    return (
      <form
        onSubmit={verifyAndFinalize}
        className={props.className ?? 'w-full max-w-sm mx-auto'}
      >
        <StepHeader
          title="Verifica + nueva passkey"
          subtitle={
            isGoogle
              ? `Te mandamos un código a ${email}. Ingresa el OTP y la passphrase que pusiste al crear tu wallet.`
              : `Código enviado a ${email}. Ingresa el OTP y tu password de Cognito.`
          }
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FieldInput
            type="text"
            required
            inputMode="numeric"
            maxLength={6}
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="123456"
            style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: 18, letterSpacing: 4 }}
          />
          <FieldInput
            type="password"
            required
            autoComplete={isGoogle ? 'off' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isGoogle ? 'Tu passphrase de recovery' : 'Tu password de Cognito'}
          />
          {error && <ErrorPill>{error}</ErrorPill>}
          <PrimaryButton type="submit" disabled={submitting || code.length < 6 || !password}>
            {submitting ? 'Verificando…' : 'Recuperar wallet'}
          </PrimaryButton>
          {cooldown > 0 && (
            <p
              style={{
                fontSize: 11,
                color: 'var(--accesly-muted2, var(--ink3, #9E95A7))',
                textAlign: 'center',
                margin: '4px 0 0',
              }}
            >
              Espera {cooldown}s antes de pedir otro código.
            </p>
          )}
        </div>
      </form>
    );
  }

  if (step === 'working') {
    return (
      <div className={props.className ?? 'w-full max-w-sm mx-auto text-center'}>
        <Spinner />
        <h2
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: 'var(--accesly-ink, var(--ink, #261E33))',
            margin: '16px 0 6px',
          }}
        >
          Rotando signer…
        </h2>
        <p style={{ fontSize: 13.5, color: 'var(--accesly-muted, var(--ink2, #6B5F78))', lineHeight: 1.5 }}>
          Aprueba el biométrico nuevo cuando aparezca. Estamos firmando la rotación
          on-chain con la llave reconstruida.
        </p>
      </div>
    );
  }

  if (step === 'success') {
    return (
      <div className={props.className ?? 'w-full max-w-sm mx-auto text-center'}>
        <div
          aria-hidden
          style={{
            width: 56,
            height: 56,
            borderRadius: 18,
            background: 'linear-gradient(135deg, #45c9a8, #7bd1a0)',
            margin: '0 auto 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            boxShadow: '0 12px 32px rgba(69,201,168,.32)',
          }}
        >
          <svg width={28} height={28} viewBox="0 0 24 24" fill="none">
            <path d="M5 12l5 5 9-11" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2
          style={{
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: '-0.02em',
            color: 'var(--accesly-ink, var(--ink, #261E33))',
            margin: '0 0 6px',
          }}
        >
          Wallet recuperada
        </h2>
        <p style={{ fontSize: 13.5, color: 'var(--accesly-muted, var(--ink2, #6B5F78))', lineHeight: 1.5 }}>
          Este dispositivo ya tiene tu nueva llave. Ya puedes operar normal.
        </p>
        {result?.txHash && (
          <code
            style={{
              display: 'block',
              marginTop: 14,
              padding: 10,
              borderRadius: 10,
              background: 'var(--accesly-card2, var(--card2, #F3F0F8))',
              fontFamily: 'monospace',
              fontSize: 10,
              wordBreak: 'break-all',
              color: 'var(--accesly-muted, var(--ink2, #6B5F78))',
            }}
          >
            {result.txHash}
          </code>
        )}
      </div>
    );
  }

  return (
    <div className={props.className ?? 'w-full max-w-sm mx-auto text-center'}>
      <div
        aria-hidden
        style={{
          width: 56,
          height: 56,
          borderRadius: 18,
          background: 'rgba(244,113,116,.12)',
          margin: '0 auto 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#c92a2a',
        }}
      >
        <svg width={28} height={28} viewBox="0 0 24 24" fill="none">
          <path d="M12 8v5M12 16.5v.5" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" />
          <circle cx={12} cy={12} r={9.5} stroke="currentColor" strokeWidth={2} />
        </svg>
      </div>
      <h2
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: 'var(--accesly-ink, var(--ink, #261E33))',
          margin: '0 0 6px',
        }}
      >
        No se pudo recuperar
      </h2>
      <p
        style={{
          fontSize: 13,
          color: '#c92a2a',
          wordBreak: 'break-word',
          lineHeight: 1.5,
          marginBottom: 14,
        }}
      >
        {error}
      </p>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setStep(method === 'google' ? 'method' : 'otp');
        }}
        style={{
          width: '100%',
          height: 48,
          borderRadius: 14,
          border: '1px solid var(--accesly-line, var(--line, rgba(38,30,51,.10)))',
          background: 'var(--accesly-card, var(--card, #FFFFFF))',
          color: 'var(--accesly-ink, var(--ink, #261E33))',
          fontSize: 14,
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        Reintentar
      </button>
    </div>
  );
}

/* ─── Shared UI helpers ─────────────────────────────────────────────────── */

function StepHeader({ title, subtitle }: { title: string; subtitle: React.ReactNode }) {
  return (
    <header className="text-center" style={{ marginBottom: 18 }}>
      <h2
        style={{
          fontSize: 19,
          fontWeight: 700,
          letterSpacing: '-0.015em',
          color: 'var(--accesly-ink, var(--ink, #261E33))',
          margin: '0 0 6px',
        }}
      >
        {title}
      </h2>
      <p
        style={{
          fontSize: 13,
          color: 'var(--accesly-muted, var(--ink2, #6B5F78))',
          lineHeight: 1.5,
          margin: 0,
        }}
      >
        {subtitle}
      </p>
    </header>
  );
}

function FieldInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
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
        e.currentTarget.style.borderColor = 'var(--accesly-primary, var(--lav, #8B6CE7))';
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
  return (
    <button
      {...props}
      style={{
        width: '100%',
        height: 52,
        marginTop: 2,
        borderRadius: 14,
        border: 'none',
        background:
          'var(--accesly-grad, var(--grad, linear-gradient(135deg, #A98DF0, #45C9A8)))',
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: 700,
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        opacity: props.disabled ? 0.5 : 1,
        boxShadow: '0 8px 24px -8px rgba(139,108,231,.55)',
        transition: 'box-shadow 120ms',
        ...props.style,
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

function Spinner() {
  // Inject keyframes una vez (idempotente — el browser deduplica por id).
  // Hacemos esto inline en vez de meter un .css side-effect import porque
  // el kit es ESM-tree-shakeable y queremos minimizar runtime overhead.
  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `@keyframes accesly-spin { to { transform: rotate(360deg); } }`,
        }}
      />
      <div
        aria-hidden
        style={{
          width: 36,
          height: 36,
          margin: '0 auto',
          border: '3px solid var(--accesly-line, var(--line, rgba(38,30,51,.10)))',
          borderTopColor: 'var(--accesly-primary, var(--lav, #8B6CE7))',
          borderRadius: '50%',
          animationName: 'accesly-spin',
          animationDuration: '700ms',
          animationTimingFunction: 'linear',
          animationIterationCount: 'infinite',
        }}
      />
    </>
  );
}

/**
 * Reusable "card-style" method picker button — full-width tile con icon
 * a la izquierda, título + subtítulo en bloque, chevron a la derecha.
 * Auto-hover state via inline handlers (sin Tailwind dark: class porque
 * los colores ya vienen del var fallback chain).
 */
function MethodCard(props: {
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly iconBg: string;
  readonly iconColor: string;
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className="w-full"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 14px',
        borderRadius: 16,
        border: '1px solid var(--accesly-line, var(--line, rgba(38,30,51,.10)))',
        background: 'var(--accesly-card, var(--card, #FFFFFF))',
        color: 'var(--accesly-ink, var(--ink, #261E33))',
        textAlign: 'left',
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        opacity: props.disabled ? 0.5 : 1,
        transition: 'border-color 120ms, background 120ms, transform 80ms',
      }}
      onMouseEnter={(e) => {
        if (props.disabled) return;
        e.currentTarget.style.borderColor =
          'var(--accesly-primary, var(--lav, #8B6CE7))';
        e.currentTarget.style.background =
          'var(--accesly-card2, var(--card2, rgba(139,108,231,.04)))';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor =
          'var(--accesly-line, var(--line, rgba(38,30,51,.10)))';
        e.currentTarget.style.background =
          'var(--accesly-card, var(--card, #FFFFFF))';
      }}
      onMouseDown={(e) => {
        if (!props.disabled) e.currentTarget.style.transform = 'scale(.985)';
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = 'scale(1)';
      }}
    >
      <span
        aria-hidden
        style={{
          width: 40,
          height: 40,
          flexShrink: 0,
          borderRadius: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: props.iconBg,
          color: props.iconColor,
        }}
      >
        {props.icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, lineHeight: 1.2 }}>
          {props.title}
        </div>
        <div
          style={{
            fontSize: 12,
            fontWeight: 400,
            color: 'var(--accesly-muted, var(--ink2, #6B5F78))',
            marginTop: 3,
            lineHeight: 1.4,
          }}
        >
          {props.subtitle}
        </div>
      </div>
      <ChevronIcon />
    </button>
  );
}

function RecoverIcon() {
  return (
    <svg width={26} height={26} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 12a8 8 0 0 1 14-5.3L20 5v5h-5"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20 12a8 8 0 0 1-14 5.3L4 19v-5h5"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EmailIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3.5 6.5h17v11h-17z"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <path
        d="M3.5 7l8.5 6.5L20.5 7"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      style={{
        color: 'var(--accesly-muted2, var(--ink3, rgba(38,30,51,.35)))',
        flexShrink: 0,
      }}
    >
      <path
        d="M9 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Logo G de Google, sin tracking. */
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
