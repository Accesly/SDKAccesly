/**
 * Parser mínimo de URIs SEP-0007 (Stellar payment request URI scheme).
 *
 * Formatos que soportamos:
 *   - Plain address:            `GABC...` o `CABC...`
 *   - SEP-0007 payment URI:     `web+stellar:pay?destination=G...&amount=1&asset_code=USDC&asset_issuer=G...`
 *
 * Devuelve solo los fields que `<SendFlow>` usa hoy (destination, amount,
 * asset). Los demás (`memo`, `msg`, `origin_domain`, `callback`, `network_passphrase`)
 * los descartamos porque el kit no los soporta en este flow.
 *
 * Ver https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md
 */

const STELLAR_ADDRESS_RE = /^[GC][A-Z0-9]{55}$/;

// Issuers Circle mainnet + testnet — los que reconocemos como USDC.
const USDC_ISSUERS = new Set([
  'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', // mainnet
  'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', // testnet
]);

export interface ParsedQrPayment {
  readonly destination: string;
  /** Cantidad en human-readable (ej. "1.5") o `null` si el QR no la trae. */
  readonly amount: string | null;
  /** `'XLM'` | `'USDC'` o `null` si el QR no lo especifica o es asset no soportado. */
  readonly asset: 'XLM' | 'USDC' | null;
}

/**
 * Parsea el contenido de un QR y devuelve `{ destination, amount, asset }`.
 * Devuelve `null` si el string no es una address plain ni una URI SEP-0007
 * válida — el caller muestra un error al user.
 */
export function parseQrPayment(raw: string): ParsedQrPayment | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Caso 1: plain address.
  if (STELLAR_ADDRESS_RE.test(trimmed)) {
    return { destination: trimmed, amount: null, asset: null };
  }

  // Caso 2: URI SEP-0007. Formato: `web+stellar:pay?...` (paths custom-scheme).
  //
  // URL() no parsea el path que sigue a `web+stellar:` porque no es un
  // scheme HTTP. Extraemos manualmente el operation (`pay`) y el query
  // string. Reemplazamos el scheme por `https://x?` para reusar el parser
  // de URLSearchParams sin hackear más.
  if (trimmed.startsWith('web+stellar:pay?')) {
    let params: URLSearchParams;
    try {
      const queryPart = trimmed.slice('web+stellar:pay?'.length);
      params = new URLSearchParams(queryPart);
    } catch {
      return null;
    }

    const destination = params.get('destination');
    if (!destination || !STELLAR_ADDRESS_RE.test(destination)) return null;

    const amountRaw = params.get('amount');
    const amount =
      amountRaw && /^\d+(\.\d+)?$/.test(amountRaw) && Number(amountRaw) > 0
        ? amountRaw
        : null;

    // asset_code + asset_issuer: si no vienen, es XLM. Si vienen, tienen que
    // ser USDC (Circle) — los demás no los soportamos hoy, devolvemos null en
    // el asset para que el user lo elija manual.
    const assetCode = params.get('asset_code');
    const assetIssuer = params.get('asset_issuer');
    let asset: 'XLM' | 'USDC' | null = null;
    if (!assetCode) {
      // Sin asset_code → asset nativo (XLM). SEP-0007 §Parameters.
      asset = 'XLM';
    } else if (assetCode === 'USDC' && assetIssuer && USDC_ISSUERS.has(assetIssuer)) {
      asset = 'USDC';
    }
    // else: asset no soportado — asset queda null y el user lo elige.

    return { destination, amount, asset };
  }

  return null;
}
