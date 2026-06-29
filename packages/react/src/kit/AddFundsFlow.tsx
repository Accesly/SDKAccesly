'use client';

import { useState, type FormEvent } from 'react';
import { useAccesly } from '../hooks/useAccesly.js';
import { useKycPolicy } from '../hooks/usePolicies.js';

/**
 * `<AddFundsFlow>` — wizard de fondeo MXN → USDC vía Etherfuse SPEI.
 *
 * Pasos:
 *   1) Si KYC habilitado en el appConfig y `requiredFor.includes('onramp')`:
 *      pinta status + ofrece abrir el hosted form (Etherfuse). Bloquea hasta
 *      KYC OK.
 *   2) Form de monto MXN → `fiat.quoteOnramp` → muestra `amountUsdc` + fxRate.
 *   3) `fiat.submitOnramp` → muestra los datos SPEI que el user debe transferir
 *      (CLABE + concepto + beneficiario).
 *
 * Para card / OXXO el flow es similar pero por ahora solo SPEI está implementado
 * (siguiendo el mockup `sSpei`).
 */
export interface AddFundsFlowProps {
  readonly onSuccess?: () => void;
  readonly onCancel?: () => void;
  readonly className?: string;
}

type Step = 'kyc' | 'amount' | 'quote' | 'instructions' | 'error';

export function AddFundsFlow(props: AddFundsFlowProps): JSX.Element {
  const { fiat } = useAccesly();
  const kycPolicy = useKycPolicy();

  const requiresKyc = kycPolicy.enabled && kycPolicy.requiredFor.includes('onramp');

  const [step, setStep] = useState<Step>(requiresKyc ? 'kyc' : 'amount');
  const [kycStatus, setKycStatus] = useState<string | null>(null);
  const [kycUrl, setKycUrl] = useState<string | null>(null);
  const [amountMxn, setAmountMxn] = useState('');
  const [quote, setQuote] = useState<{ amountUsdc?: string; fxRate?: string; quoteId?: string } | null>(null);
  const [order, setOrder] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function startKyc() {
    setBusy(true);
    setError(null);
    try {
      const r = await fiat.startKyc();
      setKycStatus(r.status);
      setKycUrl(r.hostedUrl);
      if (r.hostedUrl) window.open(r.hostedUrl, '_blank', 'noopener');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'KYC error');
    } finally {
      setBusy(false);
    }
  }

  async function refreshKyc() {
    setBusy(true);
    try {
      const r = await fiat.kycStatus();
      setKycStatus(r.status);
      if (r.status === 'approved') setStep('amount');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'KYC error');
    } finally {
      setBusy(false);
    }
  }

  async function onQuoteSubmit(e: FormEvent) {
    e.preventDefault();
    if (!amountMxn) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fiat.quoteOnramp({ amountMxn });
      setQuote(r as never);
      setStep('quote');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cotizar.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmOrder() {
    if (!quote?.quoteId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fiat.submitOnramp({ quoteId: quote.quoteId });
      setOrder(r as never);
      setStep('instructions');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo abrir la orden.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={props.className ?? 'w-full max-w-sm space-y-4'}>
      <header>
        <h2 className="text-lg font-semibold">Agregar fondos</h2>
        <p className="text-sm text-neutral-500 mt-1">SPEI mexicano → USDC en tu wallet</p>
      </header>

      {step === 'kyc' && (
        <div className="space-y-3">
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 p-4 text-sm">
            <p className="font-medium">Verificación de identidad</p>
            <p className="text-neutral-500 mt-1">
              Esta app pide KYC nivel <span className="font-mono">{kycPolicy.minLevel ?? 'KYC2'}</span>{' '}
              antes de permitir onramp.
            </p>
            <p className="text-xs text-neutral-400 mt-2">
              Status actual: <span className="font-mono">{kycStatus ?? 'desconocido'}</span>
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={kycUrl ? refreshKyc : startKyc}
              disabled={busy}
              className="flex-1 py-3 rounded-xl text-white font-medium disabled:opacity-50"
              style={{ background: 'var(--accesly-primary, #8B6CE7)' }}
            >
              {kycUrl ? 'Ya completé KYC' : 'Iniciar KYC'}
            </button>
            {props.onCancel && (
              <button
                type="button"
                onClick={props.onCancel}
                className="py-3 px-4 rounded-xl border border-neutral-200 dark:border-neutral-700"
              >
                Cancelar
              </button>
            )}
          </div>
        </div>
      )}

      {step === 'amount' && (
        <form onSubmit={onQuoteSubmit} className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-wider text-neutral-500">MXN</label>
            <input
              type="number"
              required
              step="1"
              min="100"
              value={amountMxn}
              onChange={(e) => setAmountMxn(e.target.value)}
              placeholder="500"
              className="w-full rounded-xl border border-neutral-200 dark:border-neutral-700 px-4 py-3 text-lg font-mono bg-transparent"
            />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full py-3 rounded-xl text-white font-medium disabled:opacity-50"
            style={{ background: 'var(--accesly-primary, #8B6CE7)' }}
          >
            {busy ? 'Cotizando…' : 'Cotizar'}
          </button>
        </form>
      )}

      {step === 'quote' && quote && (
        <div className="space-y-3">
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 p-4 space-y-2">
            <Row label="Pagas" value={`MXN ${amountMxn}`} />
            <Row label="Recibes" value={`USDC ${quote.amountUsdc ?? '—'}`} bold />
            {quote.fxRate && <Row label="Tipo de cambio" value={quote.fxRate} />}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep('amount')}
              className="flex-1 py-3 rounded-xl border border-neutral-200 dark:border-neutral-700"
            >
              Volver
            </button>
            <button
              type="button"
              onClick={confirmOrder}
              disabled={busy}
              className="flex-1 py-3 rounded-xl text-white font-medium disabled:opacity-50"
              style={{ background: 'var(--accesly-primary, #8B6CE7)' }}
            >
              {busy ? 'Abriendo…' : 'Confirmar'}
            </button>
          </div>
        </div>
      )}

      {step === 'instructions' && order && (
        <div className="space-y-3">
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 p-4 space-y-2 text-sm">
            <p className="font-medium">Transfiere por SPEI</p>
            <div className="text-xs text-neutral-500 space-y-1">
              {Object.entries(order)
                .filter(([k, v]) => typeof v !== 'object' && v !== null && v !== undefined)
                .map(([k, v]) => (
                  <Row key={k} label={k} value={String(v)} mono />
                ))}
            </div>
            <p className="text-xs text-neutral-400 mt-3">
              Recibirás USDC en tu wallet cuando la transferencia confirme (típicamente &lt;10 min).
            </p>
          </div>
          <button
            type="button"
            onClick={props.onSuccess ?? props.onCancel}
            className="w-full py-3 rounded-xl text-white font-medium"
            style={{ background: 'var(--accesly-primary, #8B6CE7)' }}
          >
            Listo
          </button>
        </div>
      )}

      {step === 'error' && (
        <div className="space-y-3 text-center">
          <div className="text-3xl">⚠️</div>
          <p className="text-sm text-red-500">{error}</p>
          <button
            type="button"
            onClick={() => setStep('amount')}
            className="text-sm text-neutral-500"
          >
            Volver
          </button>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, bold, mono }: { label: string; value: string; bold?: boolean; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-neutral-500 text-xs uppercase tracking-wider">{label}</span>
      <span className={`${bold ? 'font-semibold' : ''} ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}
