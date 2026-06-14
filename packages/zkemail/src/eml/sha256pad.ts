/**
 * FIPS 180-4 §5.1.1 — SHA-256 padding.
 *
 * zkemail's `Sha256General` circuit asserts that the padded input length
 * is a multiple of 512 bits (= 64 bytes). The browser prover must apply
 * the exact same padding the witness generator does:
 *
 *   1. Append 0x80.
 *   2. Append zeros until (len % 64) == 56.
 *   3. Append the original message length in BITS as a 64-bit big-endian integer.
 *
 * Result length is always a multiple of 64 bytes.
 *
 * Ported from `accesly-zkemail/samples/synthetic/generate.ts` with one
 * change: browser-friendly (`Uint8Array` + `DataView`, no `Buffer`).
 */

export function sha256Pad(message: Uint8Array): Uint8Array {
  const msgBitLen = BigInt(message.length) * 8n;
  const currentLen = message.length + 1; // +1 for 0x80
  const zerosNeeded = (56 - (currentLen % 64) + 64) % 64;
  const totalLen = message.length + 1 + zerosNeeded + 8;

  const out = new Uint8Array(totalLen);
  out.set(message, 0);
  out[message.length] = 0x80;
  // zeros are already zero — Uint8Array initialized to 0.
  const view = new DataView(out.buffer, out.byteOffset + totalLen - 8, 8);
  view.setBigUint64(0, msgBitLen, false /* big-endian */);

  if (out.length % 64 !== 0) {
    throw new Error(`sha256Pad: result length ${out.length} not multiple of 64`);
  }
  return out;
}
