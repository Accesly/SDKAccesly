'use client';

import { useState, type FormEvent } from 'react';
import { useAccesly } from '../hooks/useAccesly.js';
import { useAppConfig } from '../hooks/useAppConfig.js';
import { useBalance } from '../hooks/useBalance.js';
import { useSpendingPolicy, checkTransferPolicy } from '../hooks/usePolicies.js';
import { ContactPicker } from './ContactPicker.js';
import { QrScanModal } from './QrScanModal.js';
import { parseQrPayment } from './parseSep0007.js';
import type { ContactRecord } from '@accesly/core';

/**
 * `<SendFlow>` — wizard de envío de USDC / XLM.
 *
 * Pasos:
 *   1) Form de destino (address C…/G… o `@handle`) + monto + asset, con
 *      `<ContactPicker>` arriba para tap-to-fill.
 *   2) Si destino empieza con '@', resolve vía `endpoints.resolveHandle`
 *      antes de continuar.
 *   3) Validación contra `useSpendingPolicy` (blacklist + per-tx cap) —
 *      cliente lo rechaza antes de pegarle al backend.
 *   4) `wallet.unlockForSigning(username)` → passkey prompt.
 *   5) `tx.send(...)` con la material desbloqueada.
 *   6) Confirmación con txHash + link al explorer.
 *
 * Props:
 *   - `onSuccess(txHash)`: callback.
 *   - `onCancel()`: callback.
 *   - `defaultAsset`: 'USDC' (default) | 'XLM'.
 */
/**
 * Policy que decide qué hace el kit con los fields `amount` y `asset_code`
 * cuando el user escanea un QR SEP-0007 que los trae.
 *
 *  - `'ignore'` (default): el kit los descarta. El user siempre tipea el
 *    monto y elige el asset. Recomendado para wallets generales — evita
 *    que un QR malicioso pida un monto mayor al esperado sin que el user
 *    lo note.
 *  - `'prefill'`: el kit pobla los inputs con lo que trae el QR pero deja
 *    al user editarlos antes de firmar. Útil para "invoices" amistosos.
 *  - `'lock'`: el kit pobla y bloquea. El user solo confirma. Para flujos
 *    POS / merchant donde el monto es la fuente de verdad.
 *
 * En modo `'lock'`, si el QR NO trae `amount` cae a `'ignore'` para no
 * dejar el input bloqueado en vacío.
 */
export type QrAmountPolicy = 'ignore' | 'prefill' | 'lock';

export interface SendFlowProps {
  readonly onSuccess?: (txHash: string) => void;
  readonly onCancel?: () => void;
  readonly defaultAsset?: 'USDC' | 'XLM';
  readonly className?: string;
  /**
   * Cómo tratar el `amount` (y `asset_code`) que trae un QR SEP-0007.
   * Default `'ignore'` — el user siempre tipea el monto.
   */
  readonly qrAmount?: QrAmountPolicy;
}

type Step = 'form' | 'signing' | 'success' | 'error';

export function SendFlow(props: SendFlowProps): JSX.Element {
  const { tx, wallet, auth, _internal } = useAccesly();
  const balance = useBalance();
  const policy = useSpendingPolicy();
  const { config } = useAppConfig();
  const handlesEnabled = config?.features?.handles !== false;

  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [asset, setAsset] = useState<'USDC' | 'XLM'>(props.defaultAsset ?? 'USDC');
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [explorerUrl, setExplorerUrl] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrLocked, setQrLocked] = useState(false);

  const qrPolicy: QrAmountPolicy = props.qrAmount ?? 'ignore';

  function pickContact(c: ContactRecord) {
    if (c.handle) setDestination(`@${c.handle}`);
    else if (c.address) setDestination(c.address);
    // Escribir manual desbloquea el monto — el user tomó control.
    setQrLocked(false);
  }

  function handleQrResult(raw: string) {
    const parsed = parseQrPayment(raw);
    if (!parsed) {
      setError('El QR no contiene una dirección Stellar ni un URI SEP-0007 válido.');
      setQrOpen(false);
      return;
    }
    setError(null);
    setDestination(parsed.destination);

    // Amount + asset según policy del integrador.
    if (qrPolicy !== 'ignore') {
      if (parsed.amount) setAmount(parsed.amount);
      if (parsed.asset) setAsset(parsed.asset);
      // Solo lockeamos si viene amount — sin él, dejar lock trababa el form.
      setQrLocked(qrPolicy === 'lock' && parsed.amount !== null);
    }
    setQrOpen(false);
  }

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

    // Resolve `@handle` antes de validar policy / firmar.
    let destAddress = destination;
    if (destination.startsWith('@')) {
      try {
        const resolved = await _internal.endpoints.resolveHandle(destination);
        if (!resolved) {
          setError(`No encontramos ${destination}. Confirma que existe.`);
          return;
        }
        destAddress = resolved;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo resolver el handle.');
        return;
      }
    }

    if (!destAddress.match(/^[GC][A-Z0-9]{55}$/)) {
      setError('La dirección debe ser un Stellar address (G… o C…) válido o @handle.');
      return;
    }

    const check = checkTransferPolicy(policy, {
      destinationAddress: destAddress,
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
        destinationAddress: destAddress,
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

  // Handler del teclado numérico. Reglas: máx 7 decimales, máx 12 dígitos
  // total (evita monto absurdo tipo 1e13), sin doble ".". `back` borra un
  // dígito. Bloqueado si `qrLocked` (policy = 'lock' + QR con amount).
  function pressKey(k: string) {
    if (qrLocked) return;
    let cur = amount;
    if (k === 'back') cur = cur.slice(0, -1);
    else if (k === '.') {
      if (cur.includes('.')) return;
      cur = cur === '' ? '0.' : cur + '.';
    } else {
      if (cur === '0') cur = k;
      else if ((cur.split('.')[1] ?? '').length >= 7) return;
      else cur += k;
    }
    if (cur.replace('.', '').length > 12) return;
    setAmount(cur);
  }

  const displayAmount = amount === '' ? '0' : amount;
  const assetBalance = asset === 'USDC' ? balance.usdc ?? '0' : balance.xlm ?? '0';

  // Inline styles — el kit debe funcionar sin depender de que el integrador
  // tenga Tailwind con el kit en su content path. Todos los colores usan
  // CSS vars con fallback razonable para dark mode.
  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '.14em',
    textTransform: 'uppercase',
    color: 'var(--accesly-muted, #8a8a94)',
  };

  return (
    <form
      onSubmit={onSubmit}
      className={props.className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        width: '100%',
        maxWidth: 420,
      }}
    >
      {/* Fila: label DIRECCIÓN DESTINO + botón Escanear */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label style={labelStyle}>Dirección destino</label>
          <button
            type="button"
            onClick={() => setQrOpen(true)}
            aria-label="Escanear QR"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '.08em',
              textTransform: 'uppercase',
              padding: '5px 10px',
              borderRadius: 8,
              border: '1px solid var(--accesly-border, rgba(148, 163, 184, 0.3))',
              background: 'transparent',
              color: 'var(--accesly-text, inherit)',
              cursor: 'pointer',
            }}
          >
            <QrIcon />
            Escanear
          </button>
        </div>
        <ContactPicker onPick={pickContact} />
        <input
          type="text"
          required
          value={destination}
          onChange={(e) => {
            setDestination(e.target.value.trim());
            setQrLocked(false);
          }}
          placeholder={handlesEnabled ? '@ana.mtz o G… o C…' : 'G… o C…'}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          style={{
            width: '100%',
            padding: '12px 14px',
            borderRadius: 14,
            border: '1px solid var(--accesly-border, rgba(148, 163, 184, 0.3))',
            background: 'var(--accesly-card, transparent)',
            color: 'var(--accesly-text, inherit)',
            fontSize: 14,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Toggle XLM / USDC */}
      <div style={{ display: 'flex', gap: 8 }}>
        {(['XLM', 'USDC'] as const).map((a) => {
          const on = asset === a;
          return (
            <button
              key={a}
              type="button"
              disabled={qrLocked}
              onClick={() => setAsset(a)}
              style={{
                flex: 1,
                padding: '10px 0',
                borderRadius: 12,
                border: on
                  ? '1.5px solid var(--accesly-primary, #8B6CE7)'
                  : '1px solid var(--accesly-border, rgba(148, 163, 184, 0.3))',
                background: on
                  ? 'var(--accesly-primary-soft, rgba(139, 108, 231, 0.15))'
                  : 'transparent',
                color: on
                  ? 'var(--accesly-primary-ink, var(--accesly-primary, #8B6CE7))'
                  : 'var(--accesly-muted, #8a8a94)',
                fontWeight: 700,
                fontSize: 13,
                letterSpacing: '.04em',
                cursor: qrLocked ? 'not-allowed' : 'pointer',
                opacity: qrLocked ? 0.6 : 1,
              }}
            >
              {a}
            </button>
          );
        })}
      </div>

      {/* Display grande del monto */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          padding: '10px 0 6px',
        }}
      >
        <div style={{ fontSize: 12, color: 'var(--accesly-muted, #8a8a94)' }}>
          Disponible: {assetBalance} {asset}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: 'var(--accesly-muted, #8a8a94)',
            }}
          >
            {asset}
          </span>
          <span
            style={{
              fontSize: 46,
              lineHeight: 1,
              letterSpacing: '-.03em',
              fontWeight: 700,
              color:
                amount && amount !== '0'
                  ? 'var(--accesly-text, inherit)'
                  : 'var(--accesly-muted, #8a8a94)',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
          >
            {displayAmount}
          </span>
        </div>
        {qrLocked && (
          <div style={{ ...labelStyle, fontSize: 10 }}>Fijado por el QR</div>
        )}
      </div>

      {/* Teclado numérico */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 6,
        }}
      >
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'].map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => pressKey(k)}
            disabled={qrLocked}
            style={{
              height: 48,
              borderRadius: 12,
              border: 'none',
              background: 'transparent',
              color: 'var(--accesly-text, inherit)',
              fontSize: 22,
              fontWeight: 500,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              cursor: qrLocked ? 'not-allowed' : 'pointer',
              opacity: qrLocked ? 0.4 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {k === 'back' ? <BackspaceIcon /> : k}
          </button>
        ))}
      </div>

      {policy.perTxStroops && policy.perTxAsset === asset && (
        <p style={{ margin: 0, fontSize: 11, color: 'var(--accesly-muted, #8a8a94)' }}>
          Límite por transacción del app:{' '}
          <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
            {Number(policy.perTxStroops) / 1e7}
          </span>{' '}
          {asset}
        </p>
      )}

      {error && (
        <div
          role="alert"
          style={{
            padding: '10px 12px',
            borderRadius: 12,
            background: 'rgba(244, 113, 116, 0.1)',
            color: 'var(--accesly-danger, #ef4444)',
            fontSize: 12.5,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        {props.onCancel && (
          <button
            type="button"
            onClick={props.onCancel}
            style={{
              flex: 1,
              padding: '14px 0',
              borderRadius: 14,
              border: '1px solid var(--accesly-border, rgba(148, 163, 184, 0.3))',
              background: 'transparent',
              color: 'var(--accesly-text, inherit)',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Cancelar
          </button>
        )}
        <button
          type="submit"
          disabled={!destination || !amount}
          style={{
            flex: 1,
            padding: '14px 0',
            borderRadius: 14,
            border: 'none',
            background: 'var(--accesly-primary, #8B6CE7)',
            color: '#fff',
            fontWeight: 700,
            fontSize: 15,
            cursor: 'pointer',
            opacity: !destination || !amount ? 0.55 : 1,
          }}
        >
          Enviar {displayAmount !== '0' ? `${displayAmount} ${asset}` : ''}
        </button>
      </div>

      {qrOpen && (
        <QrScanModal onResult={handleQrResult} onClose={() => setQrOpen(false)} />
      )}
    </form>
  );
}

function BackspaceIcon(): JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 4H8L2 12l6 8h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
      <line x1="18" y1="9" x2="12" y2="15" />
      <line x1="12" y1="9" x2="18" y2="15" />
    </svg>
  );
}

/**
 * Icono QR minimal — matchea el weight de los iconos del kit sin traer una
 * lib de icons extra. 4 cuadros esquineros + un cuadro central: la lectura
 * visual clásica de un QR.
 */
function QrIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="3" height="3" />
      <rect x="18" y="18" width="3" height="3" />
    </svg>
  );
}
