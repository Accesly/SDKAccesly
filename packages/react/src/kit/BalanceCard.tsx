'use client';

import { useBalance } from '../hooks/useBalance.js';
import { useBranding } from '../hooks/useBranding.js';
import { useAccesly } from '../hooks/useAccesly.js';

/**
 * `<BalanceCard>` — saldo total con primary asset (USDC), saldo XLM,
 * y nombre del integrador. Diseñado para el header del wallet.
 *
 * Props:
 *  - `primaryAsset`: 'USDC' (default) | 'XLM'. Cuál mostrar grande.
 *  - `className`: opcional, se merge con la clase default.
 *
 * Se actualiza vía SSE (instant) o polling 10s fallback. El branding viene
 * de `useBranding()`: la card pinta con `--accesly-primary` automáticamente.
 */
export interface BalanceCardProps {
  readonly primaryAsset?: 'USDC' | 'XLM';
  readonly className?: string;
  /**
   * Override del label de moneda (default 'MXN equivalente'). Útil para apps
   * que muestren USD u otra fiat.
   */
  readonly fiatLabel?: string;
}

export function BalanceCard(props: BalanceCardProps): JSX.Element {
  const { xlm, usdc, isLoading } = useBalance();
  const branding = useBranding();
  const { auth } = useAccesly();
  const primary = props.primaryAsset ?? 'USDC';

  const primaryValue = primary === 'USDC' ? usdc : xlm;
  const secondaryAsset = primary === 'USDC' ? 'XLM' : 'USDC';
  const secondaryValue = primary === 'USDC' ? xlm : usdc;

  return (
    <article
      className={
        props.className ??
        'rounded-3xl p-6 text-white shadow-lg bg-gradient-to-br from-[var(--accesly-primary,#8B6CE7)] to-[var(--accesly-secondary,#5E45B8)]'
      }
    >
      <header className="flex items-center justify-between mb-6">
        <span className="text-xs uppercase tracking-wider opacity-80">
          {branding.displayName ?? 'Wallet'}
        </span>
        <span className="text-xs opacity-70 font-mono">
          {auth.username ?? '—'}
        </span>
      </header>

      <div className="space-y-1">
        <div className="text-xs uppercase tracking-wider opacity-70">
          Saldo {primary}
        </div>
        <div className="text-4xl font-bold tabular-nums">
          {isLoading ? '—' : formatAmount(primaryValue)}
          <span className="text-xl ml-2 opacity-80">{primary}</span>
        </div>
      </div>

      <footer className="mt-5 flex items-center justify-between text-xs opacity-80">
        <span>
          {secondaryAsset}:{' '}
          <span className="font-mono">
            {isLoading ? '—' : formatAmount(secondaryValue)}
          </span>
        </span>
        {props.fiatLabel && <span>{props.fiatLabel}</span>}
      </footer>
    </article>
  );
}

function formatAmount(v: string | null): string {
  if (!v) return '0';
  const n = Number(v);
  if (!isFinite(n)) return v;
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}
