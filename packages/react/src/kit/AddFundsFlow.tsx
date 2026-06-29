'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useAccesly } from '../hooks/useAccesly.js';
import { useAppConfig } from '../hooks/useAppConfig.js';
import { useKycPolicy } from '../hooks/usePolicies.js';

/**
 * `<AddFundsFlow>` — wizard de fondeo MXN → USDC.
 *
 * Pasos:
 *   1) Picker del método de pago: SPEI / Card / OXXO. Los métodos visibles
 *      vienen de `appConfig.features.fiatOnramp.methods` que el dev edita en
 *      el dashboard. Si solo hay uno, se salta el picker.
 *   2) Si KYC habilitado y `requiredFor.includes('onramp')`: pinta status +
 *      ofrece abrir el hosted form (Etherfuse). Bloquea hasta KYC OK.
 *   3) Form de monto MXN → `fiat.quoteOnramp` → muestra `amountUsdc` + fxRate.
 *   4) `fiat.submitOnramp` → muestra las instrucciones de pago (CLABE para
 *      SPEI, link a checkout para Card, código de pago para OXXO).
 *
 * Card y OXXO usan el mismo backend `submitOnramp` por ahora — el routing
 * por método queda en el backend Etherfuse. La UI ya respeta el toggle del
 * dev para mostrar/ocultar la opción.
 */
export type FiatMethod = 'spei' | 'card' | 'oxxo';

export interface AddFundsFlowProps {
  readonly onSuccess?: () => void;
  readonly onCancel?: () => void;
  readonly className?: string;
  /** Override del método pre-seleccionado. Si se omite, se pinta el picker. */
  readonly defaultMethod?: FiatMethod;
}

type Step = 'pickMethod' | 'kyc' | 'amount' | 'quote' | 'instructions' | 'error';

const METHOD_LABEL: Record<FiatMethod, string> = {
  spei: 'SPEI',
  card: 'Tarjeta',
  oxxo: 'OXXO',
};

const METHOD_BLURB: Record<FiatMethod, string> = {
  spei: 'Transferencia bancaria, &lt;10 min',
  card: 'Débito o crédito, inmediato',
  oxxo: 'Pago en efectivo, hasta 24 h',
};

const METHOD_ICON: Record<FiatMethod, string> = {
  spei: '⚡',
  card: '💳',
  oxxo: '🏪',
};

export function AddFundsFlow(props: AddFundsFlowProps): JSX.Element {
  const { fiat } = useAccesly();
  const kycPolicy = useKycPolicy();
  const { config } = useAppConfig();

  const enabledMethods = useMemo<ReadonlyArray<FiatMethod>>(() => {
    const f = config?.features?.fiatOnramp;
    if (!f?.enabled) return ['spei']; // safe default
    const methods = (f.methods ?? ['spei']) as ReadonlyArray<FiatMethod>;
    return methods.length > 0 ? methods : ['spei'];
  }, [config]);

  const requiresKyc = kycPolicy.enabled && kycPolicy.requiredFor.includes('onramp');

  // Pre-seleccionar: prop > único método disponible > picker
  const initialMethod: FiatMethod | null =
    props.defaultMethod && enabledMethods.includes(props.defaultMethod)
      ? props.defaultMethod
      : enabledMethods.length === 1
      ? enabledMethods[0]!
      : null;

  const [method, setMethod] = useState<FiatMethod | null>(initialMethod);
  const [step, setStep] = useState<Step>(
    initialMethod ? (requiresKyc ? 'kyc' : 'amount') : 'pickMethod',
  );
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
        <p className="text-sm text-neutral-500 mt-1">
          {method ? `${METHOD_LABEL[method]} → USDC en tu wallet` : 'Elige un método'}
        </p>
      </header>

      {step === 'pickMethod' && (
        <div className="space-y-2">
          {enabledMethods.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMethod(m);
                setStep(requiresKyc ? 'kyc' : 'amount');
              }}
              className="w-full flex items-center gap-3 p-4 rounded-2xl border border-neutral-200 dark:border-neutral-700 hover:border-neutral-400 text-left"
            >
              <span className="text-2xl">{METHOD_ICON[m]}</span>
              <div className="flex-1">
                <div className="font-medium">{METHOD_LABEL[m]}</div>
                <div className="text-xs text-neutral-500" dangerouslySetInnerHTML={{ __html: METHOD_BLURB[m] }} />
              </div>
              <span className="text-neutral-300">→</span>
            </button>
          ))}
          {props.onCancel && (
            <button
              type="button"
              onClick={props.onCancel}
              className="w-full py-3 text-sm text-neutral-500"
            >
              Cancelar
            </button>
          )}
        </div>
      )}

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
            <p className="font-medium">
              {method === 'card'
                ? 'Sigue el checkout'
                : method === 'oxxo'
                ? 'Paga en OXXO'
                : 'Transfiere por SPEI'}
            </p>
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
