import { useNetwork } from '../hooks/useNetwork.js';

export interface NetworkBadgeProps {
  /**
   * Override manual del network. Si se omite, se lee del `<AcceslyProvider>`
   * via `useNetwork()`. Útil para stories/tests.
   */
  readonly network?: 'testnet' | 'mainnet';
  /** CSS overrides. Se mergea con el default. */
  readonly style?: React.CSSProperties;
  /** Si true, no renderiza nada cuando el network es 'testnet'. Default false. */
  readonly mainnetOnly?: boolean;
}

/**
 * Badge visual sutil que muestra la network del wallet activa. Se recomienda
 * renderizar en la esquina superior de `<WalletHome>` o en el header de la
 * app integradora para que el user nunca pierda de vista si está operando
 * con fondos reales.
 *
 * Colores:
 *  - testnet: gris (informativo, low-emphasis).
 *  - mainnet: lavanda (accesly-primary, high-emphasis).
 */
export function NetworkBadge(props: NetworkBadgeProps): JSX.Element | null {
  const detected = useNetwork();
  const network = props.network ?? detected;
  if (!network) return null;
  if (props.mainnetOnly && network === 'testnet') return null;

  const isMainnet = network === 'mainnet';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 100,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        background: isMainnet
          ? 'rgba(167, 139, 250, 0.12)'
          : 'rgba(160, 160, 170, 0.12)',
        color: isMainnet ? 'var(--accesly-primary, #a78bfa)' : 'var(--accesly-muted, #71717a)',
        border: `1px solid ${
          isMainnet ? 'rgba(167, 139, 250, 0.25)' : 'rgba(160, 160, 170, 0.15)'
        }`,
        ...props.style,
      }}
    >
      {network}
    </span>
  );
}
