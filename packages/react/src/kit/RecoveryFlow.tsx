'use client';

import { useState, type FormEvent } from 'react';
import { useAccesly } from '../hooks/useAccesly.js';
import { useBranding } from '../hooks/useBranding.js';

/**
 * `<RecoveryFlow>` — wizard recovery v2 (3 pasos) que rota el signer del
 * Smart Account en un dispositivo nuevo donde el user no tiene credential
 * local pero recuerda su password de Cognito.
 *
 * Pasos:
 *   1. **email**: input del email registrado. POST `/recovery/otp/request`.
 *   2. **otp**: input del código OTP (6 dígitos) + password. El password se
 *      mantiene en estado controlado únicamente hasta `finalize()`; el SDK lo
 *      zeroiza después. POST `/recovery/otp/verify` → recoveryJwt.
 *   3. **working**: `recovery.finalize()` orquesta passkey-nueva + Shamir-nuevo +
 *      rotate_signer firmado con la seed reconstruida + persist new credential.
 *   4. **success**: wallet rotada, ahora el user puede usar el dispositivo nuevo.
 *
 * Props:
 *  - `onDone(result)`: callback al success — navega a /wallet.
 *  - `passkeyRpName`: override del nombre del registro de passkey.
 */
export interface RecoveryFlowProps {
  readonly onDone?: (result: { walletAddress: string; txHash: string }) => void;
  readonly onCancel?: () => void;
  readonly onError?: (err: Error) => void;
  readonly passkeyRpName?: string;
  readonly className?: string;
}

type Step = 'email' | 'otp' | 'working' | 'success' | 'error';

export function RecoveryFlow(props: RecoveryFlowProps): JSX.Element {
  const { recovery } = useAccesly();
  const branding = useBranding();
  const rpName = props.passkeyRpName ?? branding.displayName ?? 'Accesly';

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryJwt, setRecoveryJwt] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ walletAddress: string; txHash: string } | null>(null);

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
      setRecoveryJwt(verify.recoveryJwt);
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

  if (step === 'email') {
    return (
      <form onSubmit={requestOtp} className={props.className ?? 'w-full max-w-sm mx-auto p-6 space-y-4'}>
        <header className="text-center">
          <h2 className="text-lg font-semibold">Recuperar wallet</h2>
          <p className="text-sm text-neutral-600 mt-1">
            Te mandaremos un código a tu email. Necesitarás tu password de Cognito.
          </p>
        </header>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tucorreo@ejemplo.com"
          className="w-full rounded-xl border border-neutral-200 dark:border-neutral-700 px-4 py-3 bg-transparent"
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
        <button
          type="submit"
          disabled={submitting || !email}
          className="w-full py-3 rounded-xl text-white font-medium disabled:opacity-50"
          style={{ background: 'var(--accesly-primary, #8B6CE7)' }}
        >
          {submitting ? 'Enviando…' : 'Enviar código'}
        </button>
        {props.onCancel && (
          <button type="button" onClick={props.onCancel} className="w-full text-sm text-neutral-500">
            Cancelar
          </button>
        )}
      </form>
    );
  }

  if (step === 'otp') {
    return (
      <form
        onSubmit={verifyAndFinalize}
        className={props.className ?? 'w-full max-w-sm mx-auto p-6 space-y-4'}
      >
        <header className="text-center">
          <h2 className="text-lg font-semibold">Verifica + nueva passkey</h2>
          <p className="text-sm text-neutral-600 mt-1">
            Código enviado a {email}. Ingresa el OTP y tu password.
          </p>
        </header>
        <input
          type="text"
          required
          inputMode="numeric"
          maxLength={6}
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          placeholder="123456"
          className="w-full rounded-xl border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-center font-mono text-lg bg-transparent"
        />
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Tu password de Cognito"
          className="w-full rounded-xl border border-neutral-200 dark:border-neutral-700 px-4 py-3 bg-transparent"
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
        <button
          type="submit"
          disabled={submitting || code.length < 6 || !password}
          className="w-full py-3 rounded-xl text-white font-medium disabled:opacity-50"
          style={{ background: 'var(--accesly-primary, #8B6CE7)' }}
        >
          {submitting ? 'Verificando…' : 'Recuperar wallet'}
        </button>
        {cooldown > 0 && (
          <p className="text-[10px] text-neutral-400 text-center">
            Espera {cooldown}s antes de pedir otro código.
          </p>
        )}
      </form>
    );
  }

  if (step === 'working') {
    return (
      <div className={props.className ?? 'w-full max-w-sm mx-auto p-6 space-y-4 text-center'}>
        <div className="text-5xl animate-pulse">⏳</div>
        <h2 className="text-lg font-semibold">Rotando signer…</h2>
        <p className="text-sm text-neutral-600">
          Aprueba el biométrico nuevo cuando aparezca. Estamos firmando la rotación
          on-chain con la llave reconstruida.
        </p>
      </div>
    );
  }

  if (step === 'success') {
    return (
      <div className={props.className ?? 'w-full max-w-sm mx-auto p-6 space-y-4 text-center'}>
        <div className="text-5xl">✓</div>
        <h2 className="text-lg font-semibold">Wallet recuperada</h2>
        <p className="text-sm text-neutral-600">
          Este dispositivo ya tiene tu nueva llave. Ya puedes operar normal.
        </p>
        {result?.txHash && (
          <code className="block bg-neutral-100 dark:bg-neutral-800 rounded-lg p-2 font-mono text-[10px] break-all">
            {result.txHash}
          </code>
        )}
      </div>
    );
  }

  return (
    <div className={props.className ?? 'w-full max-w-sm mx-auto p-6 space-y-4 text-center'}>
      <div className="text-5xl">⚠️</div>
      <h2 className="text-lg font-semibold">No se pudo recuperar</h2>
      <p className="text-sm text-red-600 break-words">{error}</p>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setStep('otp');
        }}
        className="w-full py-3 rounded-xl border border-neutral-200 dark:border-neutral-700 font-medium"
      >
        Reintentar
      </button>
    </div>
  );
}
