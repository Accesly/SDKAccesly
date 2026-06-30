'use client';

import { useState } from 'react';
import { useAccesly } from '../hooks/useAccesly.js';
import { useBranding } from '../hooks/useBranding.js';
import { WalletAlreadyExistsError } from '../errors.js';

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
  /**
   * Callback opcional para cuando el SDK detecta que YA hay una wallet
   * backend pero no hay credential local en este dispositivo. El UI debe
   * navegar al flow de recovery (típicamente `/recover`). Si no se pasa,
   * el step 'wallet-exists' muestra un mensaje genérico sin CTA.
   */
  readonly onRecoverInstead?: (walletAddress: string) => void;
  readonly className?: string;
}

type Step = 'intro' | 'working' | 'success' | 'wallet-exists' | 'error';

export function CreateWalletFlow(props: CreateWalletFlowProps): JSX.Element {
  const { wallet } = useAccesly();
  const branding = useBranding();
  const [step, setStep] = useState<Step>('intro');
  const [error, setError] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [existingWallet, setExistingWallet] = useState<string | null>(null);

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
      // Caso especial: backend ya tiene la wallet pero este dispositivo
      // no tiene el credential local. El usuario tiene que recuperar, no
      // crear de nuevo (si seguimos, el nuevo passkey queda huérfano y
      // unlockForSigning truena al primer signing op).
      if (err instanceof WalletAlreadyExistsError) {
        setExistingWallet(err.walletAddress);
        setStep('wallet-exists');
        if (err instanceof Error) props.onError?.(err);
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStep('error');
      if (err instanceof Error) props.onError?.(err);
    }
  }

  if (step === 'intro') {
    return (
      <div className={props.className ?? 'w-full max-w-sm mx-auto text-center'}>
        <Tile gradient>
          <ShieldIcon />
        </Tile>
        <Title>Crea tu wallet</Title>
        <Subtitle>
          Usaremos tu biométrico (Face ID, Touch ID o Windows Hello) como la única
          llave de tu wallet. Sin frases semilla — tu cuenta vive on-chain y tú
          firmas con tu huella.
        </Subtitle>
        <PrimaryButton onClick={start} style={{ marginTop: 24 }}>
          Crear mi wallet
        </PrimaryButton>
        <p
          style={{
            marginTop: 18,
            fontSize: 11,
            lineHeight: 1.55,
            color: 'var(--accesly-muted2, var(--ink3, #9E95A7))',
          }}
        >
          Tu llave se split en 3 partes (Shamir 2-of-3): 2 en tu dispositivo, 1 en el servidor.
          El servidor nunca tiene la llave completa.
        </p>
      </div>
    );
  }

  if (step === 'working') {
    return (
      <div className={props.className ?? 'w-full max-w-sm mx-auto text-center'}>
        <Spinner />
        <Title style={{ marginTop: 18 }}>Creando tu wallet…</Title>
        <Subtitle>
          Aprueba el biométrico cuando aparezca. Esto puede tardar unos segundos —
          estamos desplegando tu Smart Account en Stellar.
        </Subtitle>
      </div>
    );
  }

  if (step === 'success') {
    return (
      <div className={props.className ?? 'w-full max-w-sm mx-auto text-center'}>
        <Tile color="mint">
          <CheckIcon />
        </Tile>
        <Title>¡Listo!</Title>
        <Subtitle>Tu wallet ya está on-chain.</Subtitle>
        {walletAddress && (
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
            {walletAddress}
          </code>
        )}
        <PrimaryButton
          onClick={() => props.onDone?.({ walletAddress: walletAddress ?? '', createdNow: true })}
          style={{ marginTop: 18 }}
        >
          Continuar
        </PrimaryButton>
      </div>
    );
  }

  if (step === 'wallet-exists') {
    return (
      <div className={props.className ?? 'w-full max-w-sm mx-auto text-center'}>
        <Tile color="amber">
          <InfoIcon />
        </Tile>
        <Title>Ya tienes una wallet</Title>
        <Subtitle>
          Detectamos que ya creaste una wallet con este correo. Como este
          dispositivo no tiene la llave, tenés que <strong>recuperarla</strong>
          {' '}en vez de crear una nueva.
        </Subtitle>
        {existingWallet && (
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
            {existingWallet}
          </code>
        )}
        {props.onRecoverInstead && existingWallet ? (
          <PrimaryButton
            onClick={() => props.onRecoverInstead?.(existingWallet)}
            style={{ marginTop: 18 }}
          >
            Recuperar mi wallet
          </PrimaryButton>
        ) : (
          <p
            style={{
              marginTop: 18,
              fontSize: 12,
              color: 'var(--accesly-muted, var(--ink2, #6B5F78))',
            }}
          >
            Navega a la página de recovery para restaurar el acceso.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={props.className ?? 'w-full max-w-sm mx-auto text-center'}>
      <Tile color="error">
        <AlertIcon />
      </Tile>
      <Title>No se pudo crear tu wallet</Title>
      <p
        style={{
          marginTop: 8,
          fontSize: 13,
          color: '#c92a2a',
          wordBreak: 'break-word',
          lineHeight: 1.5,
        }}
      >
        {error}
      </p>
      <button
        type="button"
        onClick={() => setStep('intro')}
        style={{
          width: '100%',
          height: 48,
          marginTop: 18,
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

function Tile({
  children,
  gradient,
  color = 'lav',
}: {
  children: React.ReactNode;
  gradient?: boolean;
  color?: 'lav' | 'mint' | 'amber' | 'error';
}) {
  const background = gradient
    ? 'var(--accesly-grad, var(--grad, linear-gradient(135deg, #A98DF0, #45C9A8)))'
    : color === 'mint'
      ? 'linear-gradient(135deg, #45c9a8, #7bd1a0)'
      : color === 'amber'
        ? 'linear-gradient(135deg, #f5c842, #f4a142)'
        : color === 'error'
          ? 'rgba(244,113,116,.14)'
          : 'var(--accesly-grad, var(--grad, linear-gradient(135deg, #A98DF0, #45C9A8)))';
  const shadow = gradient || color === 'lav'
    ? '0 12px 32px rgba(139,108,231,.28)'
    : color === 'mint'
      ? '0 12px 32px rgba(69,201,168,.28)'
      : color === 'amber'
        ? '0 12px 32px rgba(245,200,66,.32)'
        : 'none';
  const iconColor = color === 'error' ? '#c92a2a' : '#fff';
  return (
    <div
      aria-hidden
      style={{
        width: 60,
        height: 60,
        borderRadius: 20,
        margin: '0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background,
        boxShadow: shadow,
        color: iconColor,
      }}
    >
      {children}
    </div>
  );
}

function Title({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <h2
      style={{
        marginTop: 18,
        marginBottom: 0,
        fontSize: 22,
        fontWeight: 800,
        letterSpacing: '-0.02em',
        color: 'var(--accesly-ink, var(--ink, #261E33))',
        ...style,
      }}
    >
      {children}
    </h2>
  );
}

function Subtitle({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        marginTop: 10,
        fontSize: 13.5,
        lineHeight: 1.55,
        color: 'var(--accesly-muted, var(--ink2, #6B5F78))',
      }}
    >
      {children}
    </p>
  );
}

function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { style, ...rest } = props;
  return (
    <button
      type="button"
      {...rest}
      style={{
        width: '100%',
        height: 52,
        borderRadius: 14,
        border: 'none',
        background:
          'var(--accesly-grad, var(--grad, linear-gradient(135deg, #A98DF0, #45C9A8)))',
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: 700,
        cursor: rest.disabled ? 'not-allowed' : 'pointer',
        opacity: rest.disabled ? 0.5 : 1,
        boxShadow: '0 8px 24px -8px rgba(139,108,231,.55)',
        ...style,
      }}
    />
  );
}

function Spinner() {
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
          width: 40,
          height: 40,
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

function ShieldIcon() {
  return (
    <svg width={28} height={28} viewBox="0 0 24 24" fill="none">
      <path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6l8-3z" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width={30} height={30} viewBox="0 0 24 24" fill="none">
      <path d="M5 12l5 5 9-11" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width={28} height={28} viewBox="0 0 24 24" fill="none">
      <circle cx={12} cy={12} r={9.5} stroke="currentColor" strokeWidth={2} />
      <path d="M12 8v.01M12 11v6" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width={28} height={28} viewBox="0 0 24 24" fill="none">
      <circle cx={12} cy={12} r={9.5} stroke="currentColor" strokeWidth={2} />
      <path d="M12 8v5M12 16.5v.5" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" />
    </svg>
  );
}
