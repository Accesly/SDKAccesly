'use client';

import { useState, type FormEvent } from 'react';
import { useAccesly } from '../hooks/useAccesly.js';
import { useBalance } from '../hooks/useBalance.js';
import { useSpendingPolicy, checkTransferPolicy } from '../hooks/usePolicies.js';

/**
 * `<SendFlow>` — wizard de envío de USDC / XLM.
 *
 * Pasos:
 *   1) Form de destino + monto + asset.
 *   2) Validación contra `useSpendingPolicy` (blacklist + per-tx cap) —
 *      cliente lo rechaza antes de pegarle al backend.
 *   3) `wallet.unlockForSigning(username)` → passkey prompt.
 *   4) `tx.send(...)` con la material desbloqueada.
 *   5) Confirmación con txHash + link al explorer.
 *
 * Props:
 *   - `onSuccess(txHash)`: callback.
 *   - `onCancel()`: callback.
 *   - `defaultAsset`: 'USDC' (default) | 'XLM'.
 */
export interface SendFlowProps {
  readonly onSuccess?: (txHash: string) => void;
  readonly onCancel?: () => void;
  readonly defaultAsset?: 'USDC' | 'XLM';
  readonly className?: string;
}

type Step = 'form' | 'signing' | 'success' | 'error';

export function SendFlow(props: SendFlowProps): JSX.Element {
  const { tx, wallet, auth } = useAccesly();
  const balance = useBalance();
  const policy = useSpendingPolicy();

  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [asset, setAsset] = useState<'USDC' | 'XLM'>(props.defaultAsset ?? 'USDC');
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [explorerUrl, setExplorerUrl] = useState<string | null>(null);

  function toStroops(human: string): string {
    const n = Number(human);
    if (!isFinite(n) || n <= 0) throw new Error('Monto inválido');
    return BigInt(Math.round(n * 1e7)).toString();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    let amountStroops: string;
    try {
      amountStroops = toStroops(amount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Monto inválido');
      return;
    }

    if (!destination.match(/^[GC][A-Z0-9]{55}$/)) {
      setError('La dirección debe ser un Stellar address (G… o C…) válido.');
      return;
    }

    const check = checkTransferPolicy(policy, {
      destinationAddress: destination,
      asset,
      amountStroops,
    });
    if (check.ok === false) {
      if (check.reason === 'destination-blacklisted') {
        setError('Esta dirección está en la lista de bloqueo del app.');
      } else {
        setError('El monto supera el límite por transacción.');
      }
      return;
    }

    if (!auth.username) {
      setError('Sesión no encontrada.');
      return;
    }

    setStep('signing');
    try {
      const material = await wallet.unlockForSigning(auth.username);
      const result = await tx.send({
        destinationAddress: destination,
        amountStroops,
        asset,
        fragmentF1Plain: material.fragmentF1Plain,
        fragmentF2Key: material.fragmentF2Key,
        ownerPubkey: material.ownerPubkey,
      });
      setTxHash(result.txHash);
      setExplorerUrl(result.explorerUrl);
      setStep('success');
      props.onSuccess?.(result.txHash);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar.');
      setStep('error');
    }
  }

  if (step === 'signing') {
    return (
      <div className={props.className ?? 'w-full max-w-sm text-center space-y-4'}>
        <div className="text-4xl">⏳</div>
        <h2 className="text-lg font-semibold">Confirmando…</h2>
        <p className="text-sm text-neutral-500">
          Aprueba con tu huella o Face ID para firmar la transacción.
        </p>
      </div>
    );
  }

  if (step === 'success') {
    return (
      <div className={props.className ?? 'w-full max-w-sm text-center space-y-4'}>
        <div className="text-5xl">✓</div>
        <h2 className="text-lg font-semibold">Enviado</h2>
        <p className="text-sm text-neutral-500">
          Tu transacción está confirmada en la red.
        </p>
        {txHash && (
          <div className="font-mono text-[10px] text-neutral-500 break-all">{txHash}</div>
        )}
        <div className="flex gap-2 justify-center">
          {explorerUrl && (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700"
            >
              Ver en explorer
            </a>
          )}
          <button
            type="button"
            onClick={props.onCancel}
            className="text-xs px-3 py-2 rounded-lg text-white"
            style={{ background: 'var(--accesly-primary, #8B6CE7)' }}
          >
            Listo
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className={props.className ?? 'w-full max-w-sm space-y-4'}>
      <header>
        <h2 className="text-lg font-semibold">Enviar</h2>
        <p className="text-sm text-neutral-500 mt-1">
          Saldo {asset}:{' '}
          <span className="font-mono">
            {asset === 'USDC' ? balance.usdc ?? '0' : balance.xlm ?? '0'}
          </span>
        </p>
      </header>

      <div className="space-y-1">
        <label className="text-xs uppercase tracking-wider text-neutral-500">Para</label>
        <input
          type="text"
          required
          value={destination}
          onChange={(e) => setDestination(e.target.value.trim())}
          placeholder="GBV2…XBQU o CCG3…ZF7E"
          className="w-full rounded-xl border border-neutral-200 dark:border-neutral-700 px-4 py-3 bg-transparent font-mono text-sm"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs uppercase tracking-wider text-neutral-500">Monto</label>
        <div className="flex gap-2">
          <input
            type="number"
            inputMode="decimal"
            step="0.0001"
            min="0"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="flex-1 rounded-xl border border-neutral-200 dark:border-neutral-700 px-4 py-3 bg-transparent text-lg font-mono"
          />
          <select
            value={asset}
            onChange={(e) => setAsset(e.target.value as 'USDC' | 'XLM')}
            className="rounded-xl border border-neutral-200 dark:border-neutral-700 px-3 bg-transparent"
          >
            <option value="USDC">USDC</option>
            <option value="XLM">XLM</option>
          </select>
        </div>
      </div>

      {policy.perTxStroops && policy.perTxAsset === asset && (
        <p className="text-[11px] text-neutral-500">
          Límite por transacción del app:{' '}
          <span className="font-mono">{Number(policy.perTxStroops) / 1e7}</span> {asset}
        </p>
      )}

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
          Enviar
        </button>
      </div>
    </form>
  );
}
