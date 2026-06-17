import { describe, expect, it } from 'vitest';
import {
  XLM_DECIMALS,
  accountExplorerUrl,
  isValidStellarAddress,
  shortAddress,
  stroopsToXlm,
  txExplorerUrl,
  walletExplorerUrl,
  xlmToStroops,
} from '../../../src/stellar/format';

describe('stellar/format', () => {
  describe('xlmToStroops', () => {
    it('converts whole XLM amounts', () => {
      expect(xlmToStroops('1')).toBe('10000000');
      expect(xlmToStroops('100')).toBe('1000000000');
      expect(xlmToStroops('0')).toBe('0');
    });

    it('converts fractional XLM amounts without floating-point error', () => {
      expect(xlmToStroops('1.5')).toBe('15000000');
      expect(xlmToStroops('0.0000001')).toBe('1'); // 1 stroop
      expect(xlmToStroops('1.2345678')).toBe('12345678');
    });

    it('pads short decimals to 7 places', () => {
      expect(xlmToStroops('1.5')).toBe('15000000');
      expect(xlmToStroops('0.5')).toBe('5000000');
    });

    it('rejects amounts with more than 7 decimals (sub-stroop)', () => {
      expect(() => xlmToStroops('1.12345678')).toThrow(/7 decimals/);
    });

    it('rejects malformed input', () => {
      expect(() => xlmToStroops('abc')).toThrow();
      expect(() => xlmToStroops('1.2.3')).toThrow();
      expect(() => xlmToStroops('')).toThrow();
      expect(() => xlmToStroops('-1')).toThrow();
    });
  });

  describe('stroopsToXlm', () => {
    it('formats whole XLM amounts without trailing zeros', () => {
      expect(stroopsToXlm('10000000')).toBe('1');
      expect(stroopsToXlm('1000000000')).toBe('100');
      expect(stroopsToXlm('0')).toBe('0');
    });

    it('formats fractional XLM amounts', () => {
      expect(stroopsToXlm('15000000')).toBe('1.5');
      expect(stroopsToXlm('1')).toBe('0.0000001');
      expect(stroopsToXlm('12345678')).toBe('1.2345678');
    });

    it('accepts bigint input', () => {
      expect(stroopsToXlm(10000000n)).toBe('1');
    });

    it('roundtrips through xlmToStroops', () => {
      const samples = ['0', '1', '1.5', '0.0000001', '12345.6789', '999999.9999999'];
      for (const s of samples) {
        expect(stroopsToXlm(xlmToStroops(s))).toBe(s.replace(/\.?0+$/, '') || '0');
      }
    });
  });

  describe('isValidStellarAddress', () => {
    it('accepts well-formed G-addresses', () => {
      expect(
        isValidStellarAddress(
          'GDRHSVLY3VCEHCHCSR5MZR2ALYLCERDDFT3ULCUIELGFVYHTZFCMNU4E',
        ),
      ).toBe(true);
    });

    it('accepts well-formed C-addresses', () => {
      expect(
        isValidStellarAddress(
          'CDAGBAFG7XXBX34OCTR4LBDLMMWPPXJIXI4XT2SPOCYMHX7FJ5WCH557',
        ),
      ).toBe(true);
    });

    it('rejects too-short / too-long / wrong prefix / lowercase', () => {
      expect(isValidStellarAddress('GDRHSVLY')).toBe(false);
      expect(
        isValidStellarAddress(
          'gdrhsvly3vcehchcsr5mzr2alylcerddft3ulcuielgfvyhtzfcmnu4e',
        ),
      ).toBe(false);
      expect(
        isValidStellarAddress(
          'XDRHSVLY3VCEHCHCSR5MZR2ALYLCERDDFT3ULCUIELGFVYHTZFCMNU4E',
        ),
      ).toBe(false);
    });
  });

  describe('shortAddress', () => {
    it('returns the address unchanged when shorter than head+tail+1', () => {
      expect(shortAddress('ABC')).toBe('ABC');
    });

    it('shortens with default head=6 tail=4', () => {
      expect(
        shortAddress('CDAGBAFG7XXBX34OCTR4LBDLMMWPPXJIXI4XT2SPOCYMHX7FJ5WCH557'),
      ).toBe('CDAGBA…H557');
    });
  });

  describe('explorer URLs', () => {
    it('uses testnet by default', () => {
      expect(walletExplorerUrl('CABC')).toContain('/testnet/contract/CABC');
      expect(txExplorerUrl('deadbeef')).toContain('/testnet/tx/deadbeef');
      expect(accountExplorerUrl('GABC')).toContain('/testnet/account/GABC');
    });

    it('respects mainnet selection', () => {
      expect(walletExplorerUrl('CABC', 'mainnet')).toContain(
        '/mainnet/contract/CABC',
      );
    });
  });

  it('exposes XLM_DECIMALS = 7', () => {
    expect(XLM_DECIMALS).toBe(7);
  });
});
