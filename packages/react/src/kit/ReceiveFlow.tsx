'use client';

import { useEffect, useState } from 'react';
import { useAccesly } from '../hooks/useAccesly.js';
import { useBranding } from '../hooks/useBranding.js';

/**
 * `<ReceiveFlow>` — pantalla de "Recibir", con QR del wallet address
 * + copy button. Muestra el handle del usuario si configuraron handles
 * (Fase 10) — fallback a wallet address corta.
 *
 * Props:
 *  - `walletAddress`: override del address. Si no se pasa, lo resuelve del
 *    DeviceStore via `wallet.getStoredCredential`.
 *  - `onClose`: callback cuando el user cierra el flow.
 *
 * El QR se renderiza con un data: URL usando un servicio público sin
 * dependencias adicionales en el bundle. Para producción, el integrador
 * puede pasar `renderQr` con su preferred library.
 */
export interface ReceiveFlowProps {
  readonly walletAddress?: string;
  readonly onClose?: () => void;
  readonly renderQr?: (text: string) => React.ReactNode;
  readonly className?: string;
}

export function ReceiveFlow(props: ReceiveFlowProps): JSX.Element {
  const { wallet, auth, _internal } = useAccesly();
  const branding = useBranding();
  const [resolved, setResolved] = useState<string | null>(props.walletAddress ?? null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (props.walletAddress) {
      setResolved(props.walletAddress);
      return;
    }
    if (!_internal.username) return;
    let cancelled = false;
    void (async () => {
      try {
        const c = await wallet.getStoredCredential(_internal.username!);
        if (!cancelled) setResolved(c?.walletAddress ?? null);
      } catch {
        if (!cancelled) setResolved(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.walletAddress, wallet, _internal.username]);

  async function copyToClipboard() {
    if (!resolved) return;
    try {
      await navigator.clipboard.writeText(resolved);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  }

  const qr = resolved
    ? props.renderQr?.(resolved) ?? (
        <img
          alt={`QR de ${resolved}`}
          src={qrDataUrl(resolved)}
          width={240}
          height={240}
          className="rounded-xl bg-white"
        />
      )
    : null;

  return (
    <div className={props.className ?? 'w-full max-w-sm space-y-5 text-center'}>
      <header>
        <h2 className="text-lg font-semibold">Recibir</h2>
        <p className="text-sm text-neutral-500 mt-1">
          Comparte tu dirección — solo {branding.displayName ?? 'esta app'} sabe interpretarla.
        </p>
      </header>

      <div className="flex justify-center">{qr ?? <div className="w-60 h-60 bg-neutral-100 dark:bg-neutral-800 rounded-xl animate-pulse" />}</div>

      {auth.username && (
        <div className="text-xs text-neutral-500 font-mono">{auth.username}</div>
      )}

      {resolved && (
        <button
          type="button"
          onClick={copyToClipboard}
          className="w-full py-3 rounded-xl border border-neutral-200 dark:border-neutral-700 font-mono text-xs hover:bg-neutral-50 dark:hover:bg-neutral-900"
        >
          {copied ? '✓ Copiado' : shorten(resolved)}
        </button>
      )}

      {props.onClose && (
        <button
          type="button"
          onClick={props.onClose}
          className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
        >
          Cerrar
        </button>
      )}
    </div>
  );
}

function shorten(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function qrDataUrl(text: string): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(text)}`;
}
