import { describe, expect, it } from 'vitest';
import { formatForSoroban } from '../src/soroban/format';
import type { SnarkjsProof } from '../src/types';

const ZERO_PROOF: SnarkjsProof = {
  protocol: 'groth16',
  curve: 'bls12381',
  pi_a: ['0', '0', '1'],
  pi_b: [['0', '0'], ['0', '0'], ['1', '0']],
  pi_c: ['0', '0', '1'],
};
const ZERO_SIGNALS = new Array(14).fill('0');

describe('formatForSoroban', () => {
  it('produces 96-byte G1, 192-byte G2, 96-byte G1, and 14 × 32-byte signals', () => {
    const out = formatForSoroban(ZERO_PROOF, ZERO_SIGNALS);
    expect(out.proof.a.length).toBe(96);
    expect(out.proof.b.length).toBe(192);
    expect(out.proof.c.length).toBe(96);
    expect(out.publicSignals.length).toBe(14);
    for (const sig of out.publicSignals) expect(sig.length).toBe(32);
  });

  it('encodes a known G1 point with X=1, Y=2 as 48-byte BE limbs', () => {
    const proof = { ...ZERO_PROOF, pi_a: ['1', '2', '1'] as [string, string, string] };
    const out = formatForSoroban(proof, ZERO_SIGNALS);
    expect(out.proof.a[47]).toBe(1); // X low byte
    expect(out.proof.a[95]).toBe(2); // Y low byte
    expect(out.proof.a[0]).toBe(0); // X high byte
    expect(out.proof.a[48]).toBe(0); // Y high byte
  });

  it('encodes G2 with Fp2 in c1 || c0 order', () => {
    const proof: SnarkjsProof = {
      ...ZERO_PROOF,
      // X.c0=10, X.c1=11; Y.c0=20, Y.c1=21
      pi_b: [
        ['10', '11'],
        ['20', '21'],
        ['1', '0'],
      ],
    };
    const out = formatForSoroban(proof, ZERO_SIGNALS);
    // Layout: X.c1 (offset 0-47), X.c0 (48-95), Y.c1 (96-143), Y.c0 (144-191).
    expect(out.proof.b[47]).toBe(11); // X.c1 low byte
    expect(out.proof.b[95]).toBe(10); // X.c0 low byte
    expect(out.proof.b[143]).toBe(21); // Y.c1 low byte
    expect(out.proof.b[191]).toBe(20); // Y.c0 low byte
  });

  it('rejects non-affine snarkjs output (Z != 1)', () => {
    const bad = { ...ZERO_PROOF, pi_a: ['0', '0', '2'] as [string, string, string] };
    expect(() => formatForSoroban(bad, ZERO_SIGNALS)).toThrow(/affine/);
  });

  it('rejects BN254 proofs', () => {
    const bn = { ...ZERO_PROOF, curve: 'bn128' as unknown as 'bls12381' };
    expect(() => formatForSoroban(bn, ZERO_SIGNALS)).toThrow(/BLS12-381/);
  });

  it('rejects wrong number of public signals', () => {
    expect(() => formatForSoroban(ZERO_PROOF, new Array(13).fill('0'))).toThrow(/14 public/);
  });

  it('rejects out-of-range scalars', () => {
    const huge = new Array(14).fill(
      '52435875175126190479447740508185965837690552500527637822603658699938581184513', // == Fr modulus
    );
    expect(() => formatForSoroban(ZERO_PROOF, huge)).toThrow(/out of range/);
  });

  it('encodes a 32-byte public signal big-endian', () => {
    const signals = ['0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '258'];
    const out = formatForSoroban(ZERO_PROOF, signals);
    const last = out.publicSignals[13]!;
    expect(last[31]).toBe(258 & 0xff); // 0x02
    expect(last[30]).toBe(1); // 0x01
    expect(last[0]).toBe(0);
  });
});
