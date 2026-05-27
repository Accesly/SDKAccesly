import { describe, expect, it } from 'vitest';
import { normalizeSecp256r1Pubkey } from '../../../src/webauthn/register.js';

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

describe('webauthn/normalizeSecp256r1Pubkey', () => {
  it('passes through a canonical 65-byte uncompressed point', () => {
    const input = new Uint8Array(65);
    input[0] = 0x04;
    for (let i = 1; i < 65; i += 1) input[i] = i;
    const out = normalizeSecp256r1Pubkey(input);
    expect(out.length).toBe(65);
    expect(out[0]).toBe(0x04);
    expect(bytesEqual(out, input)).toBe(true);
    // Must be a copy, not the same reference
    expect(out).not.toBe(input);
  });

  it('prepends 0x04 to a raw 64-byte X||Y', () => {
    const xy = new Uint8Array(64);
    for (let i = 0; i < 64; i += 1) xy[i] = 100 + i;
    const out = normalizeSecp256r1Pubkey(xy);
    expect(out.length).toBe(65);
    expect(out[0]).toBe(0x04);
    // The trailing 64 bytes must equal the input.
    for (let i = 0; i < 64; i += 1) expect(out[i + 1]).toBe(xy[i]);
  });

  it('extracts the uncompressed point from a 91-byte P-256 SPKI', () => {
    // Build a minimal valid 91-byte SPKI: 26 bytes of AlgorithmIdentifier
    // wrapper + 65 bytes of uncompressed point with 0x04 prefix.
    const spki = new Uint8Array(91);
    // Fill the first 26 bytes with arbitrary-but-non-04 data
    for (let i = 0; i < 26; i += 1) spki[i] = i;
    spki[26] = 0x04;
    for (let i = 27; i < 91; i += 1) spki[i] = i;
    const out = normalizeSecp256r1Pubkey(spki);
    expect(out.length).toBe(65);
    expect(out[0]).toBe(0x04);
    for (let i = 1; i < 65; i += 1) expect(out[i]).toBe(spki[26 + i]);
  });

  it('throws on compressed (33-byte) input with a helpful message', () => {
    const compressed = new Uint8Array(33);
    compressed[0] = 0x02;
    for (let i = 1; i < 33; i += 1) compressed[i] = i;
    expect(() => normalizeSecp256r1Pubkey(compressed)).toThrow(/compressed/i);

    compressed[0] = 0x03;
    expect(() => normalizeSecp256r1Pubkey(compressed)).toThrow(/compressed/i);
  });

  it('throws on 65 bytes without 0x04 prefix', () => {
    const bad = new Uint8Array(65);
    bad[0] = 0x05;
    expect(() => normalizeSecp256r1Pubkey(bad)).toThrow(/unrecognised format/i);
  });

  it('throws on 91 bytes where byte 26 is not 0x04 (not a P-256 SPKI)', () => {
    const notSpki = new Uint8Array(91);
    notSpki[26] = 0x05;
    expect(() => normalizeSecp256r1Pubkey(notSpki)).toThrow(/unrecognised format/i);
  });

  it('throws on totally unknown length', () => {
    expect(() => normalizeSecp256r1Pubkey(new Uint8Array(10))).toThrow(RangeError);
    expect(() => normalizeSecp256r1Pubkey(new Uint8Array(0))).toThrow(RangeError);
    expect(() => normalizeSecp256r1Pubkey(new Uint8Array(128))).toThrow(RangeError);
  });
});
