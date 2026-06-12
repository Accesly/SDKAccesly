/**
 * Converts a snarkjs BLS12-381 Groth16 proof + public signals into the
 * uncompressed byte layout that the Soroban verifier contract consumes via
 * `BytesN<N>::from_array`.
 *
 * Layout (per CAP-0064 / EIP-2537 / ZCash, mirrors `rust-verifier/scripts/export_vk.ts`):
 *   - Fp:  48 bytes big-endian.
 *   - G1 uncompressed (96 B):  X (48) || Y (48).
 *   - Fp2 element: c1 (48 BE) || c0 (48 BE).
 *   - G2 uncompressed (192 B): X.c1 || X.c0 || Y.c1 || Y.c0.
 *   - Fr public signal: 32 bytes big-endian (BLS12-381 Fr is 255 bits, fits in 32 B).
 */

import { NUM_PUBLIC_SIGNALS } from '../index';
import type { SnarkjsProof, SorobanProofBundle } from '../types';

const BLS12_381_FP_BYTES = 48;
const BLS12_381_FP_MODULUS = BigInt(
  '4002409555221667393417789825735904156556882819939007885332058136124031650490837864442687629129015664037894272559787',
);
const BLS12_381_FR_BYTES = 32;
const BLS12_381_FR_MODULUS = BigInt(
  '52435875175126190479447740508185965837690552500527637822603658699938581184513',
);

export function formatForSoroban(
  proof: SnarkjsProof,
  publicSignals: readonly string[],
): SorobanProofBundle {
  if (proof.protocol !== 'groth16') {
    throw new Error(`expected groth16 proof, got ${proof.protocol}`);
  }
  if (proof.curve !== 'bls12381') {
    throw new Error(
      `expected BLS12-381 proof, got ${proof.curve}. The Soroban verifier ` +
        `only accepts BLS12-381 (host function constraint).`,
    );
  }
  if (publicSignals.length !== NUM_PUBLIC_SIGNALS) {
    throw new Error(
      `expected ${NUM_PUBLIC_SIGNALS} public signals, got ${publicSignals.length}`,
    );
  }

  const a = g1ToUncompressed(proof.pi_a, 'pi_a');
  const b = g2ToUncompressed(proof.pi_b, 'pi_b');
  const c = g1ToUncompressed(proof.pi_c, 'pi_c');

  const sigBytes: Uint8Array[] = publicSignals.map((s, i) => frToBytes(s, `signal[${i}]`));

  return {
    proof: { a, b, c },
    publicSignals: sigBytes,
  };
}

function g1ToUncompressed(point: readonly string[], label: string): Uint8Array {
  if (point.length !== 3) {
    throw new Error(`${label}: expected 3 coords, got ${point.length}`);
  }
  const [x, y, z] = point;
  if (z !== '1') {
    throw new Error(
      `${label}: G1 not in affine form (Z=${z}). snarkjs should always emit Z=1 for proofs.`,
    );
  }
  const out = new Uint8Array(96);
  out.set(fpToBytes(x!, label + '.x'), 0);
  out.set(fpToBytes(y!, label + '.y'), 48);
  return out;
}

function g2ToUncompressed(
  point: readonly (readonly string[])[],
  label: string,
): Uint8Array {
  if (point.length !== 3 || point.some((p) => p.length !== 2)) {
    throw new Error(`${label}: expected [[c0,c1],[c0,c1],[c0,c1]]`);
  }
  const [x, y, z] = point;
  const [x0, x1] = [x![0]!, x![1]!];
  const [y0, y1] = [y![0]!, y![1]!];
  const [z0, z1] = [z![0]!, z![1]!];
  if (z0 !== '1' || z1 !== '0') {
    throw new Error(`${label}: G2 not in affine form (Z=[${z0}, ${z1}])`);
  }
  const out = new Uint8Array(192);
  out.set(fpToBytes(x1, label + '.x.c1'), 0);
  out.set(fpToBytes(x0, label + '.x.c0'), 48);
  out.set(fpToBytes(y1, label + '.y.c1'), 96);
  out.set(fpToBytes(y0, label + '.y.c0'), 144);
  return out;
}

function fpToBytes(decimal: string, label: string): Uint8Array {
  const v = BigInt(decimal);
  if (v < 0n || v >= BLS12_381_FP_MODULUS) {
    throw new Error(`${label}: field element out of range`);
  }
  return bigIntToBytes(v, BLS12_381_FP_BYTES);
}

function frToBytes(decimal: string, label: string): Uint8Array {
  const v = BigInt(decimal);
  if (v < 0n || v >= BLS12_381_FR_MODULUS) {
    throw new Error(`${label}: scalar element out of range (decimal=${decimal})`);
  }
  return bigIntToBytes(v, BLS12_381_FR_BYTES);
}

function bigIntToBytes(v: bigint, byteLen: number): Uint8Array {
  const out = new Uint8Array(byteLen);
  for (let i = byteLen - 1; i >= 0; i -= 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}
