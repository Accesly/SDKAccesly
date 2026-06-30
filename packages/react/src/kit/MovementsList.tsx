'use client';

import { useMemo, useState } from 'react';
import { useWalletActivity } from '../hooks/useWalletActivity.js';
import { useWalletHistory } from '../hooks/useWalletHistory.js';
import type { WalletActivityItem } from '../hooks/walletSubscription.js';

/**
 * `<MovementsList>` — feed de movimientos de la wallet.
 *
 * Props:
 *  - `source`: `'history'` (default) lee del proxy de Stellar Expert con cache
 *    12h — muestra transfer-in, transfer-out, wallet-created y signer-rotated.
 *    `'activity'` lee del stream SSE en tiempo real, solo eventos del Smart
 *    Account propio (sin transfer-in). Útil para dashboards "ahora mismo".
 *  - `limit`: cap superior del buffer cliente (default 50). El componente nunca
 *    pinta más de `limit` items en total, paginados o no.
 *  - `pageSize`: si se setea, el componente pagina internamente con N items por
 *    página y muestra un selector `1 2 3 …` debajo. Sin esto, renderiza la
 *    lista completa hasta `limit`.
 *  - `emptyState`: nodo a renderizar si no hay actividad. Default un mensaje.
 *  - `onItemClick`: opcional, callback al tap de un item.
 */
export interface MovementsListProps {
  readonly source?: 'history' | 'activity';
  readonly limit?: number;
  readonly pageSize?: number;
  readonly emptyState?: React.ReactNode;
  readonly onItemClick?: (item: WalletActivityItem) => void;
  readonly className?: string;
}

export function MovementsList(props: MovementsListProps): JSX.Element {
  const source = props.source ?? 'history';
  const limit = props.limit ?? 50;
  // Llamamos ambos hooks siempre para mantener orden estable de hooks de
  // React. El que no se usa corre con polling minimal — pasamos 0 a history
  // para desactivar poll, y activity ya hace SSE así que su overhead es mínimo.
  const history = useWalletHistory(
    undefined,
    source === 'history' ? {} : { pollIntervalMs: 0 },
  );
  const activity = useWalletActivity(null, { limit });

  const events = useMemo<readonly WalletActivityItem[]>(() => {
    if (source === 'history') {
      return history.events.slice(0, limit) as unknown as readonly WalletActivityItem[];
    }
    return activity.events;
  }, [source, history.events, activity.events, limit]);
  const isLoading = source === 'history' ? history.isLoading : activity.isLoading;
  const error = source === 'history' ? history.error : activity.error;

  const pageSize = props.pageSize;
  const totalPages = pageSize ? Math.max(1, Math.ceil(events.length / pageSize)) : 1;
  const [page, setPage] = useState(1);
  // Clamp page si el total cambió (ej. polling trajo más events).
  const safePage = Math.min(page, totalPages);
  const pageEvents = pageSize
    ? events.slice((safePage - 1) * pageSize, safePage * pageSize)
    : events;

  if (isLoading && events.length === 0) {
    return (
      <div className={props.className ?? ''}>
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-sm text-red-500 px-3 py-2 rounded-lg bg-red-50">
        {error.message}
      </div>
    );
  }
  if (events.length === 0) {
    return (
      <div className="text-sm text-neutral-500 px-3 py-6 text-center">
        {props.emptyState ?? 'Aún no hay movimientos.'}
      </div>
    );
  }

  return (
    <div className={props.className}>
      <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {pageEvents.map((e) => (
          <MovementRow
            key={`${e.type}-${e.txHash}`}
            item={e}
            {...(props.onItemClick ? { onClick: props.onItemClick } : {})}
          />
        ))}
      </ul>
      {pageSize && totalPages > 1 ? (
        <Pager page={safePage} totalPages={totalPages} onChange={setPage} />
      ) : null}
    </div>
  );
}

/**
 * Selector compacto `‹ 1 2 3 ›`. Hasta 5 páginas pinta todas; con más usa
 * un patrón con elipsis para no romper el ancho en mobile.
 */
function Pager({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (next: number) => void;
}) {
  const pages = buildPagerWindow(page, totalPages);
  return (
    <nav
      aria-label="Paginación de movimientos"
      className="flex items-center justify-center gap-1 pt-3"
    >
      <button
        type="button"
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page === 1}
        aria-label="Página anterior"
        className="w-8 h-8 rounded-lg text-sm flex items-center justify-center text-neutral-500 disabled:opacity-30 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        ‹
      </button>
      {pages.map((p, i) =>
        p === '…' ? (
          <span key={`gap-${i}`} className="px-1 text-xs text-neutral-400">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            aria-current={p === page ? 'page' : undefined}
            className={`min-w-8 h-8 px-2 rounded-lg text-sm font-medium ${
              p === page
                ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
            }`}
          >
            {p}
          </button>
        ),
      )}
      <button
        type="button"
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page === totalPages}
        aria-label="Página siguiente"
        className="w-8 h-8 rounded-lg text-sm flex items-center justify-center text-neutral-500 disabled:opacity-30 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        ›
      </button>
    </nav>
  );
}

function buildPagerWindow(page: number, total: number): (number | '…')[] {
  if (total <= 5) {
    const out: number[] = [];
    for (let i = 1; i <= total; i++) out.push(i);
    return out;
  }
  // Patrón típico: 1 … (page-1) page (page+1) … total
  const set = new Set<number>([1, total, page, page - 1, page + 1]);
  const sorted = Array.from(set)
    .filter((n) => n >= 1 && n <= total)
    .sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  for (let i = 0; i < sorted.length; i++) {
    out.push(sorted[i]!);
    const next = sorted[i + 1];
    if (next !== undefined && next - sorted[i]! > 1) out.push('…');
  }
  return out;
}

function MovementRow({
  item,
  onClick,
}: {
  item: WalletActivityItem;
  onClick?: (item: WalletActivityItem) => void;
}) {
  const meta = describe(item);
  return (
    <li
      onClick={onClick ? () => onClick(item) : undefined}
      className={`flex items-center gap-3 py-3 ${onClick ? 'cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900' : ''}`}
    >
      <span
        aria-hidden
        className="w-9 h-9 rounded-full flex items-center justify-center text-base"
        style={{ background: meta.bg, color: meta.color }}
      >
        {meta.icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{meta.title}</div>
        <div className="text-xs text-neutral-500 truncate">{meta.subtitle}</div>
      </div>
      <div className="text-right">
        <div className="text-sm font-mono tabular-nums" style={{ color: meta.color }}>
          {meta.amount}
        </div>
        <div className="text-[10px] text-neutral-400">{formatTime(item.timestamp)}</div>
      </div>
    </li>
  );
}

function Skeleton() {
  return (
    <div className="flex items-center gap-3 py-3 animate-pulse">
      <div className="w-9 h-9 rounded-full bg-neutral-200 dark:bg-neutral-800" />
      <div className="flex-1 space-y-2">
        <div className="h-3 bg-neutral-200 dark:bg-neutral-800 rounded w-1/3" />
        <div className="h-2 bg-neutral-200 dark:bg-neutral-800 rounded w-1/2" />
      </div>
    </div>
  );
}

interface RowMeta {
  readonly title: string;
  readonly subtitle: string;
  readonly amount: string;
  readonly icon: string;
  readonly color: string;
  readonly bg: string;
}

function describe(item: WalletActivityItem): RowMeta {
  // El backend manda `asset` ('XLM' | 'USDC') en transfers; default XLM
  // para audits viejos pre-1.4 que solo loggeaban amount/to.
  const asset = (item as { asset?: string }).asset ?? 'XLM';
  if (item.type === 'transfer-in') {
    return {
      title: 'Recibido',
      subtitle: `de ${short(item.from)}`,
      amount: `+${stroopsToHuman(item.amountStroops)} ${asset}`,
      icon: '↓',
      color: '#10b981',
      bg: 'rgba(16, 185, 129, 0.12)',
    };
  }
  if (item.type === 'transfer-out') {
    return {
      title: 'Enviado',
      subtitle: `a ${short(item.to)}`,
      amount: `-${stroopsToHuman(item.amountStroops)} ${asset}`,
      icon: '↑',
      color: '#ef4444',
      bg: 'rgba(239, 68, 68, 0.12)',
    };
  }
  if (item.type === 'signer-rotated') {
    return {
      title: 'Llave rotada',
      subtitle: 'cambio de signer del Smart Account',
      amount: '',
      icon: '⟳',
      color: '#6366f1',
      bg: 'rgba(99, 102, 241, 0.12)',
    };
  }
  return {
    title: 'Wallet creada',
    subtitle: `tx ${short(item.txHash)}`,
    amount: '',
    icon: '✦',
    color: '#8b5cf6',
    bg: 'rgba(139, 92, 246, 0.12)',
  };
}

function short(addr: string): string {
  if (!addr) return '—';
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function stroopsToHuman(stroops: string): string {
  const n = Number(stroops) / 1e7;
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatTime(ts: string | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  const diffMs = Date.now() - d.getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString();
}
