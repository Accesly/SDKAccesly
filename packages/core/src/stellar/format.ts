/**
 * Helpers puramente client-side para convertir / validar / mostrar valores
 * Stellar comunes que toda app de Accesly necesita.
 *
 * Cero dependencias del `@stellar/stellar-sdk` para que el bundle del integrador
 * no cargue ~200 KB solo por hacer `xlmToStroops(1.5)`.
 */

export type StellarNetwork = 'testnet' | 'mainnet';

/**
 * Decimales del XLM = 7 (1 XLM = 10_000_000 stroops). Reusado por
 * `xlmToStroops` / `stroopsToXlm` y exportado por si el integrador lo
 * necesita en otra parte.
 */
export const XLM_DECIMALS = 7;

/**
 * Convierte una cantidad de XLM expresada como string decimal a stroops como
 * string base-10. Manejo de precisión exacto — no usa `Number` (que pierde
 * precisión arriba de 2^53). Trim de ceros sobrantes; rechaza signos negativos.
 *
 * @example
 *   xlmToStroops('1.5')         // '15000000'
 *   xlmToStroops('0.0000001')   // '1'
 *   xlmToStroops('100')         // '1000000000'
 *
 * @throws Si `xlm` tiene más de 7 decimales (sub-stroop), letra, signo, o
 *   forma malformada (varios puntos, vacío, etc.).
 */
export function xlmToStroops(xlm: string): string {
  const s = xlm.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error(`xlmToStroops: invalid number "${xlm}" — expected positive decimal`);
  }
  const [whole, frac = ''] = s.split('.');
  if (frac.length > XLM_DECIMALS) {
    throw new Error(`xlmToStroops: ${xlm} exceeds 7 decimals (1 stroop = 0.0000001 XLM)`);
  }
  const fracPadded = (frac + '0'.repeat(XLM_DECIMALS)).slice(0, XLM_DECIMALS);
  const combined = `${whole}${fracPadded}`.replace(/^0+(?=\d)/, '');
  return combined === '' ? '0' : combined;
}

/**
 * Convierte stroops (string o bigint) a un string decimal de XLM con hasta 7
 * dígitos fraccionarios, sin trailing zeros.
 *
 * @example
 *   stroopsToXlm('15000000')   // '1.5'
 *   stroopsToXlm('1')          // '0.0000001'
 *   stroopsToXlm('10000000')   // '1'
 */
export function stroopsToXlm(stroops: string | bigint): string {
  const big = typeof stroops === 'bigint' ? stroops : BigInt(stroops);
  if (big < 0n) {
    throw new Error('stroopsToXlm: negative stroops not supported');
  }
  const factor = 10n ** BigInt(XLM_DECIMALS);
  const whole = big / factor;
  const frac = big % factor;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(XLM_DECIMALS, '0').replace(/0+$/, '');
  return `${whole.toString()}.${fracStr}`;
}

/**
 * Valida que una dirección sea G-address (clásica ed25519) o C-address (Soroban
 * contract). 56 caracteres base32 mayúsculos, prefijo G o C.
 *
 * NO valida el checksum interno de StrKey — para eso usá
 * `StrKey.isValidEd25519PublicKey` del stellar-sdk. Esto es defensa rápida
 * client-side suficiente para inputs de UI.
 */
export function isValidStellarAddress(s: string): boolean {
  return /^[GC][A-Z2-7]{55}$/.test(s);
}

/**
 * Versión recortada de una address para mostrar en UI cuando no cabe entera.
 * Por default `head=6` + `…` + `tail=4` — apropiado para C-addresses (56 chars).
 *
 * @example
 *   shortAddress('CDAGBAFG7XXBX34OCTR4LBDLMMWPPXJIXI4XT2SPOCYMHX7FJ5WCH557')
 *     // 'CDAGBA…H557'
 */
export function shortAddress(address: string, head = 6, tail = 4): string {
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

/**
 * Link al explorer de Stellar Expert para un contrato (C-address) en la red dada.
 */
export function walletExplorerUrl(address: string, network: StellarNetwork = 'testnet'): string {
  return `https://stellar.expert/explorer/${network}/contract/${address}`;
}

/**
 * Link al explorer de Stellar Expert para una tx en la red dada.
 */
export function txExplorerUrl(txHash: string, network: StellarNetwork = 'testnet'): string {
  return `https://stellar.expert/explorer/${network}/tx/${txHash}`;
}

/**
 * Link al explorer de Stellar Expert para una G-address clásica.
 */
export function accountExplorerUrl(address: string, network: StellarNetwork = 'testnet'): string {
  return `https://stellar.expert/explorer/${network}/account/${address}`;
}
