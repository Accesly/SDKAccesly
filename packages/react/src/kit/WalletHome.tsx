'use client';

import { useState } from 'react';
import { useBranding } from '../hooks/useBranding.js';
import { useAccesly } from '../hooks/useAccesly.js';
import { useUpgradeRecommendation } from '../hooks/useUpgradeRecommendation.js';
import { BalanceCard } from './BalanceCard.js';
import { MovementsList } from './MovementsList.js';
import { ReceiveFlow } from './ReceiveFlow.js';
import { SendFlow } from './SendFlow.js';
import { AddFundsFlow } from './AddFundsFlow.js';

/**
 * `<WalletHome>` — pantalla principal completa al estilo del mockup
 * `sHome` de `DashboardAcceslyDev/Docs/Wallet Accesly.html`:
 *
 *   - BalanceCard (header con saldo + branding)
 *   - 3 acciones rápidas: Enviar / Recibir / Agregar fondos
 *   - MovementsList (feed de actividad)
 *   - Upgrade banner si el dev publicó un targetVersion nuevo
 *
 * Cada acción abre un modal con el flow correspondiente. El integrador puede
 * pasar `renderModal` para usar su propio dialog system; default = position-fixed
 * overlay simple.
 */
export interface WalletHomeProps {
  readonly className?: string;
  readonly renderModal?: (node: React.ReactNode, onClose: () => void) => React.ReactNode;
}

type Modal = 'send' | 'receive' | 'addFunds' | null;

export function WalletHome(props: WalletHomeProps): JSX.Element {
  const branding = useBranding();
  const { auth } = useAccesly();
  const upgrade = useUpgradeRecommendation();
  const [open, setOpen] = useState<Modal>(null);

  const renderModal = props.renderModal ?? defaultModal;

  return (
    <div className={props.className ?? 'w-full max-w-md mx-auto p-4 space-y-4'}>
      {branding.logoUrl && (
        <div className="flex justify-center">
          <img src={branding.logoUrl} alt={branding.displayName ?? ''} className="h-8" />
        </div>
      )}

      <BalanceCard primaryAsset="USDC" />

      <nav className="grid grid-cols-3 gap-2">
        <ActionButton label="Enviar" icon="↑" onClick={() => setOpen('send')} />
        <ActionButton label="Recibir" icon="↓" onClick={() => setOpen('receive')} />
        <ActionButton label="Agregar" icon="＋" onClick={() => setOpen('addFunds')} />
      </nav>

      {upgrade.recommendation?.upgradeAvailable && (
        <UpgradeBanner
          targetVersion={upgrade.recommendation.targetVersion ?? ''}
          strategy={upgrade.recommendation.rolloutStrategy}
        />
      )}

      <section className="rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-4">
        <header className="flex items-baseline justify-between mb-2">
          <h2 className="font-semibold">Movimientos</h2>
          {auth.username && (
            <span className="text-[10px] text-neutral-400 font-mono">{auth.username}</span>
          )}
        </header>
        <MovementsList limit={20} />
      </section>

      {open === 'send' &&
        renderModal(<SendFlow onCancel={() => setOpen(null)} onSuccess={() => setOpen(null)} />, () => setOpen(null))}
      {open === 'receive' && renderModal(<ReceiveFlow onClose={() => setOpen(null)} />, () => setOpen(null))}
      {open === 'addFunds' &&
        renderModal(<AddFundsFlow onCancel={() => setOpen(null)} onSuccess={() => setOpen(null)} />, () => setOpen(null))}
    </div>
  );
}

function ActionButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-1 py-4 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 hover:border-neutral-400"
    >
      <span
        className="w-10 h-10 rounded-full flex items-center justify-center text-lg"
        style={{ background: 'var(--accesly-primary, #8B6CE7)', color: 'white' }}
      >
        {icon}
      </span>
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}

function UpgradeBanner({ targetVersion, strategy }: { targetVersion: string; strategy: string }) {
  return (
    <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 px-4 py-3 text-xs flex items-center justify-between gap-2">
      <div>
        <p className="font-medium text-amber-900 dark:text-amber-200">
          Actualización disponible
        </p>
        <p className="text-amber-700 dark:text-amber-300/70">
          Nueva versión <span className="font-mono">{targetVersion}</span>{' '}
          {strategy === 'force' ? '(requerida)' : '(opcional)'}.
        </p>
      </div>
    </div>
  );
}

function defaultModal(node: React.ReactNode, onClose: () => void): React.ReactNode {
  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-neutral-900 rounded-3xl p-6 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        {node}
      </div>
    </div>
  );
}
