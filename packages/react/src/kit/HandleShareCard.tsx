'use client';

import { useState } from 'react';
import { useHandle } from '../hooks/useHandle.js';
import { useAppConfig } from '../hooks/useAppConfig.js';

/**
 * `<HandleShareCard>` — UI compacto que muestra el handle del wallet actual
 * y, si no hay, ofrece reservar uno.
 *
 * Pensado para embeber arriba del QR en `<ReceiveFlow>`. Si el integrador
 * desactivó handles vía `appConfig.features.handles = false`, el componente
 * se auto-oculta.
 *
 * Props:
 *  - `walletAddress`: opcional; si no se pasa, lo resuelve del DeviceStore.
 *  - `disabled`: oculta el componente desde el caller.
 */
export interface HandleShareCardProps {
  readonly walletAddress?: string | null;
  readonly disabled?: boolean;
  readonly className?: string;
}

const HANDLE_RE = /^[a-z0-9._]{3,20}$/;

export function HandleShareCard(props: HandleShareCardProps): JSX.Element | null {
  const { handle, isLoading, reserve } = useHandle(props.walletAddress);
  const { config } = useAppConfig();
  const featureEnabled = config?.features?.handles !== false;
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (props.disabled || !featureEnabled) return null;
  if (isLoading) return null;

  async function copy() {
    if (!handle) return;
    try {
      await navigator.clipboard.writeText(`@${handle}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  }

  async function onReserve() {
    setError(null);
    const cleaned = draft.replace(/^@/, '').toLowerCase();
    if (!HANDLE_RE.test(cleaned)) {
      setError('3..20 chars, letras, números, "." o "_"');
      return;
    }
    setSubmitting(true);
    try {
      await reserve(cleaned);
    } catch (err) {
      if (err instanceof Error && err.message.includes('409')) {
        setError(`@${cleaned} ya está tomado.`);
      } else {
        setError(err instanceof Error ? err.message : 'No se pudo reservar.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (handle) {
    return (
      <div
        className={props.className ?? 'rounded-xl border border-neutral-200 dark:border-neutral-700 p-3 flex items-center justify-between gap-2'}
      >
        <div>
          <div className="text-[10px] uppercase tracking-wider text-neutral-500">Tu handle</div>
          <div className="font-mono text-base">@{handle}</div>
        </div>
        <button
          type="button"
          onClick={copy}
          className="text-xs px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700"
        >
          {copied ? '✓ Copiado' : 'Copiar'}
        </button>
      </div>
    );
  }

  return (
    <div className={props.className ?? 'rounded-xl border border-neutral-200 dark:border-neutral-700 p-3 space-y-2'}>
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">
        Reserva tu handle
      </div>
      <div className="flex gap-2">
        <div className="flex items-center px-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-500">@</div>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="ana.mtz"
          maxLength={20}
          className="flex-1 rounded-lg border border-neutral-200 dark:border-neutral-700 px-3 py-2 text-sm bg-transparent font-mono"
        />
        <button
          type="button"
          disabled={submitting || !draft}
          onClick={onReserve}
          className="px-3 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50"
          style={{ background: 'var(--accesly-primary, #8B6CE7)' }}
        >
          {submitting ? '…' : 'Reservar'}
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
