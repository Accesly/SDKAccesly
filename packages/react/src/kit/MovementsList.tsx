'use client';

import { useWalletActivity } from '../hooks/useWalletActivity.js';
import type { WalletActivityItem } from '../hooks/walletSubscription.js';

/**
 * `<MovementsList>` — feed de movimientos de la wallet. Lee del hook
 * `useWalletActivity` (SSE + fallback polling 25s).
 *
 * Props:
 *  - `limit`: cantidad de eventos. Default 10.
 *  - `emptyState`: nodo a renderizar si no hay actividad. Default un mensaje.
 *  - `onItemClick`: opcional, callback al tap de un item.
 */
export interface MovementsListProps {
  readonly limit?: number;
  readonly emptyState?: React.ReactNode;
  readonly onItemClick?: (item: WalletActivityItem) => void;
  readonly className?: string;
}

export function MovementsList(props: MovementsListProps): JSX.Element {
  const { events, isLoading, error } = useWalletActivity(null, { limit: props.limit ?? 10 });

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
    <ul className={props.className ?? 'divide-y divide-neutral-100 dark:divide-neutral-800'}>
      {events.map((e) => (
        <MovementRow
          key={`${e.type}-${e.txHash}`}
          item={e}
          {...(props.onItemClick ? { onClick: props.onItemClick } : {})}
        />
      ))}
    </ul>
  );
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
  if (item.type === 'transfer-in') {
    return {
      title: 'Recibido',
      subtitle: `de ${short(item.from)}`,
      amount: `+${stroopsToHuman(item.amountStroops)} XLM`,
      icon: '↓',
      color: '#10b981',
      bg: 'rgba(16, 185, 129, 0.12)',
    };
  }
  if (item.type === 'transfer-out') {
    return {
      title: 'Enviado',
      subtitle: `a ${short(item.to)}`,
      amount: `-${stroopsToHuman(item.amountStroops)} XLM`,
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
