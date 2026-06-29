'use client';

import { useState } from 'react';
import { useAccesly } from '../hooks/useAccesly.js';
import { useBranding } from '../hooks/useBranding.js';

/**
 * `<CreateWalletFlow>` — one-shot post-signup screen que dispara
 * `wallet.bootstrap()` (registro de passkey + Shamir split + deploy del
 * Smart Account on-chain Stellar testnet).
 *
 * Pasos visuales:
 *  1. Intro — explica qué va a pasar + CTA grande "Crear mi wallet"
 *  2. Working — animación + texto ("Aprueba el biométrico…")
 *  3. Success — wallet address corta + CTA al callback `onDone`
 *
 * Props:
 *  - `email` + `password`: requeridos (el SDK los necesita para passkey
 *    rpName + recovery key derivation). El integrador los obtiene del
 *    AuthForm que vino antes.
 *  - `passkeyRpName`: override del nombre que el browser muestra en el
 *    prompt biométrico. Default = `branding.displayName ?? 'Accesly'`.
 *  - `onDone(result)`: callback al success — el integrador navega a /wallet.
 *  - `onError`: opcional para logging.
 */
export interface CreateWalletFlowProps {
  readonly email: string;
  readonly password: string;
  readonly passkeyRpName?: string;
  readonly onDone?: (result: { walletAddress: string; createdNow: boolean }) => void;
  readonly onError?: (err: Error) => void;
  readonly className?: string;
}

type Step = 'intro' | 'working' | 'success' | 'error';

export function CreateWalletFlow(props: CreateWalletFlowProps): JSX.Element {
  const { wallet } = useAccesly();
  const branding = useBranding();
  const [step, setStep] = useState<Step>('intro');
  const [error, setError] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  const rpName = props.passkeyRpName ?? branding.displayName ?? 'Accesly';

  async function start() {
    setStep('working');
    setError(null);
    try {
      const result = await wallet.bootstrap({
        email: props.email,
        password: props.password,
        passkey: { rpName },
      });
      setWalletAddress(result.walletAddress);
      setStep('success');
      props.onDone?.({ walletAddress: result.walletAddress, createdNow: result.createdNow });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStep('error');
      if (err instanceof Error) props.onError?.(err);
    }
  }

  if (step === 'intro') {
    return (
      <div className={props.className ?? 'w-full max-w-sm mx-auto p-6 space-y-5 text-center'}>
        <div className="text-5xl">🔐</div>
        <h2 className="text-lg font-semibold">Crea tu wallet</h2>
        <p className="text-sm text-neutral-600">
          Usaremos tu biométrico (Face ID, Touch ID o Windows Hello) como la única llave de tu
          wallet. Sin frases semilla — tu cuenta vive on-chain y tú firmas con tu huella.
        </p>
        <button
          type="button"
          onClick={start}
          className="w-full py-3 rounded-xl text-white font-medium"
          style={{ background: 'var(--accesly-primary, #8B6CE7)' }}
        >
          Crear mi wallet
        </button>
        <p className="text-[10px] text-neutral-400">
          Tu llave se split en 3 partes (Shamir 2-of-3): 2 en tu dispositivo, 1 en el servidor.
          El servidor nunca tiene la llave completa.
        </p>
      </div>
    );
  }

  if (step === 'working') {
    return (
      <div className={props.className ?? 'w-full max-w-sm mx-auto p-6 space-y-4 text-center'}>
        <div className="text-5xl animate-pulse">⏳</div>
        <h2 className="text-lg font-semibold">Creando tu wallet…</h2>
        <p className="text-sm text-neutral-600">
          Aprueba el biométrico cuando aparezca. Esto puede tardar unos segundos —
          estamos desplegando tu Smart Account en Stellar.
        </p>
      </div>
    );
  }

  if (step === 'success') {
    return (
      <div className={props.className ?? 'w-full max-w-sm mx-auto p-6 space-y-4 text-center'}>
        <div className="text-5xl">✨</div>
        <h2 className="text-lg font-semibold">¡Listo!</h2>
        <p className="text-sm text-neutral-600">Tu wallet ya está on-chain.</p>
        {walletAddress && (
          <code className="block bg-neutral-100 dark:bg-neutral-800 rounded-lg p-2 font-mono text-[10px] break-all">
            {walletAddress}
          </code>
        )}
        <button
          type="button"
          onClick={() => props.onDone?.({ walletAddress: walletAddress ?? '', createdNow: true })}
          className="w-full py-3 rounded-xl text-white font-medium"
          style={{ background: 'var(--accesly-primary, #8B6CE7)' }}
        >
          Continuar
        </button>
      </div>
    );
  }

  return (
    <div className={props.className ?? 'w-full max-w-sm mx-auto p-6 space-y-4 text-center'}>
      <div className="text-5xl">⚠️</div>
      <h2 className="text-lg font-semibold">No se pudo crear tu wallet</h2>
      <p className="text-sm text-red-600 break-words">{error}</p>
      <button
        type="button"
        onClick={() => setStep('intro')}
        className="w-full py-3 rounded-xl border border-neutral-200 dark:border-neutral-700 font-medium"
      >
        Reintentar
      </button>
    </div>
  );
}
