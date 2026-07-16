'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useAccesly } from '../hooks/useAccesly.js';
import { useBalance } from '../hooks/useBalance.js';
import type { TransferAsset } from '@accesly/core';

/**
 * `<SwapFlow>` — wizard XLM ↔ USDC con auto-fallback Soroswap → SDEX.
 *
 * El SDK ya tiene `tx.swap()` (Soroswap Aggregator) y `tx.swapViaSdex()`
 * (SDEX classic). Para MVP usamos `swap()` que es más eficiente y, si el
 * backend no encuentra path, ya hace auto-fallback a SDEX internamente
 * (via `withAutoBootstrapG` / `withAutoAddTrustlineG` wrappers).
 *
 * Pasos:
 *   1. Form: from / to / amount / slippage
 *   2. Signing: passkey prompt
 *   3. Success: amountOut + quote summary + link al explorer
 *
 * Props:
 *  - `onSuccess(txHash)`: callback.
 *  - `onCancel()`: callback.
 *  - `defaultFrom` / `defaultTo`: 'XLM' (default from) | 'USDC'.
 */
export interface SwapFlowProps {
  readonly onSuccess?: (txHash: string) => void;
  readonly onCancel?: () => void;
  readonly defaultFrom?: TransferAsset;
  readonly defaultTo?: TransferAsset;
  readonly className?: string;
}

type Step = 'form' | 'signing' | 'success' | 'error';

export function SwapFlow(props: SwapFlowProps): JSX.Element {
  const { tx, wallet, auth, _internal } = useAccesly();
  const balance = useBalance();

  const [fromAsset, setFromAsset] = useState<TransferAsset>(props.defaultFrom ?? 'XLM');
  const [toAsset, setToAsset] = useState<TransferAsset>(props.defaultTo ?? 'USDC');
  const [amount, setAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState(50); // 0.5%
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    txHash: string;
    amountOut: string;
    priceImpactPct: string;
    explorerUrl: string;
    platform: string;
  } | null>(null);

  // Fase 18 (2026-07-12) — quote preview vía debounced simulate.
  // Antes el input "A" solo decía "≈ (cotización tras firmar)" — el user no
  // sabía cuánto recibiría hasta después del passkey prompt. Ahora consulta
  // el backend cada vez que cambian los inputs y muestra amountOut + price
  // impact en tiempo real.
  const [preview, setPreview] = useState<{
    amountOut: string;
    priceImpactPct: string;
    platform: string;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    const amt = Number(amount);
    if (!isFinite(amt) || amt <= 0 || fromAsset === toAsset) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const stroops = BigInt(Math.round(amt * 1e7)).toString();
        const sim = await _internal.endpoints.swapSimulate({
          fromAsset,
          toAsset,
          amountIn: stroops,
          slippageBps,
        });
        if (controller.signal.aborted) return;
        setPreview({
          amountOut: (Number(sim.quote.amountOut) / 1e7).toFixed(7).replace(/\.?0+$/, ''),
          priceImpactPct: sim.quote.priceImpactPct,
          platform: sim.quote.platform,
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        // No mostramos error del preview como error del form — solo indicamos
        // que no hay quote (mostrar el placeholder). Si el user firma igual,
        // el submit real ya devuelve el error.
        setPreview(null);
        setPreviewError(err instanceof Error ? err.message : 'sin cotización');
      } finally {
        if (!controller.signal.aborted) setPreviewLoading(false);
      }
    }, 500); // debounce 500ms
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [amount, fromAsset, toAsset, slippageBps, _internal]);

  function toStroops(human: string): string {
    const n = Number(human);
    if (!isFinite(n) || n <= 0) throw new Error('Monto inválido');
    return BigInt(Math.round(n * 1e7)).toString();
  }

  function flip() {
    setFromAsset(toAsset);
    setToAsset(fromAsset);
  }

  const fromBalance = fromAsset === 'XLM' ? balance.xlm : balance.usdc;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (fromAsset === toAsset) {
      setError('From y To deben ser distintos.');
      return;
    }
    if (!auth.username) {
      setError('Sesión no encontrada.');
      return;
    }

    let amountIn: string;
    try {
      amountIn = toStroops(amount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Monto inválido');
      return;
    }

    setStep('signing');
    try {
      const material = await wallet.unlockForSigning(auth.username);
      const swapArgs = {
        fromAsset,
        toAsset,
        amountIn,
        slippageBps,
        fragmentF1Plain: material.fragmentF1Plain,
        fragmentF2Key: material.fragmentF2Key,
        ownerPubkey: material.ownerPubkey,
      };

      // Fase 18.2 (2026-07-12) — restauramos auto-fallback a SDEX.
      // Soroswap Aggregator no soporta Smart Accounts como trader — su
      // `/quote/build` valida from/to como G-address y simula contra la
      // balance del owner G (que no tiene los tokens; los tiene el smart
      // account C). Cuando falla, caemos a SDEX classic via G-bridge —
      // `withAutoBootstrapG` + `withAutoAddTrustlineG` en useAccesly
      // manejan el bootstrap on-demand (un extra ~10s la primera vez, después
      // instantáneo). El material del passkey se re-usa, sin segundo prompt.
      let r;
      try {
        r = await tx.swap(swapArgs);
      } catch (soroswapErr) {
        const msg = soroswapErr instanceof Error ? soroswapErr.message : '';
        const softFallback =
          msg.includes('soroswap') ||
          msg.includes('InsufficientBalance') ||
          msg.includes('Path not found') ||
          msg.includes('No path found') ||
          msg.includes('expected 48');
        if (!softFallback) throw soroswapErr;
        r = await tx.swapViaSdex(swapArgs);
      }

      setResult({
        txHash: r.txHash,
        amountOut: (Number(r.quote.amountOut) / 1e7).toString(),
        priceImpactPct: r.quote.priceImpactPct,
        explorerUrl: r.explorerUrl,
        platform: r.quote.platform,
      });
      setStep('success');
      props.onSuccess?.(r.txHash);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo hacer el swap.');
      setStep('error');
    }
  }

  if (step === 'signing') {
    return (
      <div className={props.className ?? 'w-full max-w-sm mx-auto p-6 text-center space-y-4'}>
        <div className="text-4xl animate-pulse">⏳</div>
        <h2 className="text-lg font-semibold">Firmando swap…</h2>
        <p className="text-sm text-neutral-500">
          Aprueba con tu biométrico. El swap se ejecuta vía Soroswap Aggregator
          que rutea al mejor precio disponible.
        </p>
      </div>
    );
  }

  if (step === 'success' && result) {
    return (
      <div className={props.className ?? 'w-full max-w-sm mx-auto p-6 text-center space-y-4'}>
        <div className="text-5xl">✓</div>
        <h2 className="text-lg font-semibold">Swap completado</h2>
        <div className="rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-4 space-y-1 text-sm text-left">
          <Row label="Pagaste" value={`${amount} ${fromAsset}`} />
          <Row label="Recibiste" value={`${result.amountOut} ${toAsset}`} bold />
          <Row label="Price impact" value={`${result.priceImpactPct}%`} />
          <Row label="Plataforma" value={result.platform} />
        </div>
        <div className="flex gap-2">
          <a
            href={result.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="flex-1 py-3 rounded-xl border border-neutral-200 dark:border-neutral-700 text-sm text-center"
          >
            Ver en explorer
          </a>
          <button
            type="button"
            onClick={props.onCancel}
            className="flex-1 py-3 rounded-xl text-white font-medium"
            style={{ background: 'var(--accesly-primary, #8B6CE7)' }}
          >
            Listo
          </button>
        </div>
      </div>
    );
  }

  if (step === 'error') {
    return (
      <div className={props.className ?? 'w-full max-w-sm mx-auto p-6 text-center space-y-4'}>
        <div className="text-5xl">⚠️</div>
        <p className="text-sm text-red-600 break-words">{error}</p>
        <button
          type="button"
          onClick={() => setStep('form')}
          className="w-full py-3 rounded-xl border border-neutral-200 dark:border-neutral-700 font-medium"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className={props.className ?? 'w-full max-w-sm mx-auto p-6 space-y-4'}>
      <header>
        <h2 className="text-lg font-semibold">Swap</h2>
        <p className="text-xs text-neutral-500 mt-1">
          Cambia entre XLM y USDC. Soroswap primero, SDEX fallback automático.
        </p>
      </header>

      <div className="rounded-2xl border border-neutral-200 dark:border-neutral-700 p-3 space-y-3">
        <div>
          <label className="text-xs uppercase tracking-wider text-neutral-500">Desde</label>
          <div className="flex gap-2 mt-1">
            <input
              type="number"
              step="0.0001"
              min="0"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="flex-1 rounded-lg border border-neutral-200 dark:border-neutral-700 px-3 py-2 text-lg font-mono bg-transparent"
            />
            <select
              value={fromAsset}
              onChange={(e) => setFromAsset(e.target.value as TransferAsset)}
              className="rounded-lg border border-neutral-200 dark:border-neutral-700 px-3 bg-transparent"
            >
              <option value="XLM">XLM</option>
              <option value="USDC">USDC</option>
            </select>
          </div>
          <div className="text-[10px] text-neutral-400 mt-1">
            Saldo: <span className="font-mono">{fromBalance ?? '—'}</span> {fromAsset}
          </div>
        </div>

        <div className="text-center">
          <button
            type="button"
            onClick={flip}
            aria-label="Invertir"
            className="w-9 h-9 rounded-full bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-lg"
          >
            ↓
          </button>
        </div>

        <div>
          <label className="text-xs uppercase tracking-wider text-neutral-500">A</label>
          <div className="flex gap-2 mt-1">
            <div className="flex-1 rounded-lg bg-neutral-50 dark:bg-neutral-900 px-3 py-2 text-lg font-mono">
              {previewLoading ? (
                <span className="text-neutral-400">Cotizando…</span>
              ) : preview ? (
                <span>≈ {preview.amountOut}</span>
              ) : (
                <span className="text-neutral-400">—</span>
              )}
            </div>
            <select
              value={toAsset}
              onChange={(e) => setToAsset(e.target.value as TransferAsset)}
              className="rounded-lg border border-neutral-200 dark:border-neutral-700 px-3 bg-transparent"
            >
              <option value="USDC">USDC</option>
              <option value="XLM">XLM</option>
            </select>
          </div>
          {preview && (
            <div className="text-[10px] text-neutral-400 mt-1 flex justify-between">
              <span>
                Price impact: <span className="font-mono">{preview.priceImpactPct}%</span>
              </span>
              <span>
                via <span className="font-mono">{preview.platform}</span>
              </span>
            </div>
          )}
          {previewError && !previewLoading && (
            <div className="text-[10px] text-amber-500 mt-1">
              Sin cotización disponible ahora — el swap puede intentarse igual.
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <label className="text-xs text-neutral-500">Slippage (bps)</label>
        <input
          type="number"
          min="10"
          max="500"
          step="10"
          value={slippageBps}
          onChange={(e) => setSlippageBps(Number(e.target.value))}
          className="w-20 rounded-lg border border-neutral-200 dark:border-neutral-700 px-2 py-1 text-sm font-mono bg-transparent text-right"
        />
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex gap-2">
        {props.onCancel && (
          <button
            type="button"
            onClick={props.onCancel}
            className="flex-1 py-3 rounded-xl border border-neutral-200 dark:border-neutral-700 font-medium"
          >
            Cancelar
          </button>
        )}
        <button
          type="submit"
          className="flex-1 py-3 rounded-xl text-white font-medium"
          style={{ background: 'var(--accesly-primary, #8B6CE7)' }}
        >
          Cotizar y firmar
        </button>
      </div>
    </form>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs uppercase tracking-wider text-neutral-500">{label}</span>
      <span className={`${bold ? 'font-semibold' : ''} font-mono`}>{value}</span>
    </div>
  );
}
