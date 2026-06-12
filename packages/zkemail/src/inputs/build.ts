/**
 * Builds the `CircuitInputs` JSON that snarkjs.groth16.fullProve consumes.
 *
 * The circuit lives in `accesly-zkemail/circuits/accesly_email.circom` and
 * expects, broadly:
 *
 *   - The DKIM-signed header bytes (relaxed-canonicalized + SHA-256 padded
 *     so the total length is a multiple of 64).
 *   - The RSA-2048 public modulus + signature as 17 × 121-bit limbs each
 *     (matches @zk-email/helpers convention).
 *   - Recovery-binding inputs: recipient email (normalized), wallet
 *     address, new passkey, domain salt — used to compute
 *     `recipient_email_hash`, `sender_hash`, etc. as public signals.
 *   - Offsets/lengths into the signed-header bytes so the circuit can
 *     locate the Subject / From / Date / To values (zk-email convention).
 *
 * All field values are decimal strings (snarkjs convention). Byte arrays
 * are zero-padded to fixed length.
 */

import { HeaderCapExceededError } from '../errors';
import { MAX_HEADERS_LENGTH } from '../index';
import type { CircuitInputs, RecoveryParams } from '../types';
import { buildSignedHeaderBytes, type ParsedEml } from '../eml/parse';
import { sha256Pad } from '../eml/sha256pad';

const MAX_EMAIL_LENGTH = 256; // zkemail HashEmailAddress convention
const RSA_LIMB_BITS = 121;
const RSA_LIMB_COUNT = 17; // 17 × 121 = 2057 > 2048

export interface BuildInputsArgs {
  readonly parsed: ParsedEml;
  /** RSA-2048 modulus (n) for the DKIM key, as a BigInt. Caller fetches this
   *  out of band (DNS, backend, hardcoded for known selectors). */
  readonly rsaModulus: bigint;
  readonly recovery: RecoveryParams;
}

export function buildCircuitInputs(args: BuildInputsArgs): CircuitInputs {
  const { parsed, rsaModulus, recovery } = args;

  // 1. Reconstruct the bytes DKIM signed and apply SHA-256 padding.
  const signedBytes = buildSignedHeaderBytes(parsed);
  if (signedBytes.length > MAX_HEADERS_LENGTH) {
    throw new HeaderCapExceededError(signedBytes.length, MAX_HEADERS_LENGTH);
  }
  const padded = sha256Pad(signedBytes);
  if (padded.length > MAX_HEADERS_LENGTH) {
    // sha256Pad adds up to 72 bytes (1 + 63 + 8). If raw bytes were < cap
    // but padded exceeds cap, that's still a failure.
    throw new HeaderCapExceededError(padded.length, MAX_HEADERS_LENGTH);
  }
  const emailHeader = bytesToCircuitArray(padded, MAX_HEADERS_LENGTH);
  const emailHeaderLength = String(signedBytes.length); // UNpadded length

  // 2. RSA modulus + signature as limbs.
  const pubkey = bigIntToLimbs(rsaModulus, RSA_LIMB_BITS, RSA_LIMB_COUNT);
  const sigBigInt = bytesToBigIntBE(parsed.dkim.b);
  const signature = bigIntToLimbs(sigBigInt, RSA_LIMB_BITS, RSA_LIMB_COUNT);

  // 3. Recipient email (normalized + padded).
  const recipientBytes = new TextEncoder().encode(recovery.recipientEmail);
  if (recipientBytes.length > MAX_EMAIL_LENGTH) {
    throw new Error(
      `recipient email is ${recipientBytes.length} bytes, max is ${MAX_EMAIL_LENGTH}`,
    );
  }
  const recipientEmailNormalized = bytesToCircuitArray(recipientBytes, MAX_EMAIL_LENGTH);
  const recipientEmailLength = String(recipientBytes.length);

  // 4. Recovery context byte arrays.
  if (recovery.domainSalt.length !== 32) {
    throw new Error(`domainSalt must be 32 bytes, got ${recovery.domainSalt.length}`);
  }
  if (recovery.newPasskeyPubkey.length !== 64) {
    throw new Error(`newPasskeyPubkey must be 64 bytes, got ${recovery.newPasskeyPubkey.length}`);
  }
  const walletAddressBytes = strkeyToRawBytes(recovery.walletAddress);
  if (walletAddressBytes.length !== 32) {
    throw new Error(
      `walletAddress decoded to ${walletAddressBytes.length} bytes, expected 32`,
    );
  }

  // 5. Locate header value ranges inside the signed bytes for the circuit's
  //    subject/from/date/to indices. The circuit hashes substrings, so we
  //    point it at the start of each value (after `name:`).
  const ranges = locateRangesInSignedBytes(parsed);

  return {
    emailHeader: emailHeader.map(String),
    emailHeaderLength,
    pubkey,
    signature,

    recipientEmailNormalized: recipientEmailNormalized.map(String),
    recipientEmailLength,
    domainSalt: Array.from(recovery.domainSalt, String),
    walletAddress: Array.from(walletAddressBytes, String),
    newPasskeyPubkey: Array.from(recovery.newPasskeyPubkey, String),

    subjectIndex: String(ranges.subject.offset),
    subjectLength: String(ranges.subject.length),
    fromIndex: String(ranges.from.offset),
    fromLength: String(ranges.from.length),
    dateIndex: String(ranges.date.offset),
    dateLength: String(ranges.date.length),
    toIndex: String(ranges.to.offset),
    toLength: String(ranges.to.length),
  };
}

function locateRangesInSignedBytes(parsed: ParsedEml) {
  // The signed bytes are produced by buildSignedHeaderBytes: h= headers
  // in order, each as `lowername:value\r\n`, then DKIM-Signature.
  // We need the offset of each value WITHIN those bytes.
  const encoder = new TextEncoder();
  const lookup = new Map<string, { name: string; value: string }>();
  for (const h of parsed.headers) lookup.set(h.name.toLowerCase(), h);

  const result: Record<string, { offset: number; length: number }> = {};
  let cursor = 0;
  for (const name of parsed.dkim.h) {
    const header = lookup.get(name)!;
    const collapsedValue = header.value
      .replace(/\r?\n/g, '')
      .replace(/[\t ]+/g, ' ')
      .replace(/^\s+/, '')
      .replace(/\s+$/, '');
    const lineLen = header.name.length + 1 + collapsedValue.length + 2; // "name:" + value + "\r\n"
    const valueOffset = cursor + header.name.length + 1;
    const valueLength = encoder.encode(collapsedValue).length;
    result[name] = { offset: valueOffset, length: valueLength };
    cursor += encoder.encode(`${header.name.toLowerCase()}:${collapsedValue}\r\n`).length;
    // Use byte length, not char length, for cursor accuracy.
    void lineLen;
  }

  const subj = result['subject'];
  const from = result['from'];
  const date = result['date'];
  const to = result['to'];
  if (!subj || !from || !date || !to) {
    throw new Error(
      `signed headers missing one of subject/from/date/to (found: ${Object.keys(result).join(',')})`,
    );
  }
  return { subject: subj, from, date, to };
}

function bytesToCircuitArray(bytes: Uint8Array, maxLen: number): number[] {
  if (bytes.length > maxLen) {
    throw new Error(`bytes length ${bytes.length} exceeds maxLen ${maxLen}`);
  }
  const arr = new Array<number>(maxLen).fill(0);
  for (let i = 0; i < bytes.length; i += 1) arr[i] = bytes[i]!;
  return arr;
}

function bigIntToLimbs(value: bigint, limbBits: number, limbCount: number): string[] {
  const mask = (1n << BigInt(limbBits)) - 1n;
  const out: string[] = [];
  for (let i = 0; i < limbCount; i += 1) {
    out.push(((value >> BigInt(i * limbBits)) & mask).toString());
  }
  return out;
}

function bytesToBigIntBE(bytes: Uint8Array): bigint {
  let acc = 0n;
  for (const b of bytes) acc = (acc << 8n) | BigInt(b);
  return acc;
}

/**
 * Decodes a Stellar G... strkey to its 32-byte ed25519 public key payload.
 *
 * Strkey layout (SEP-23 §3):  version(1) || payload(32) || checksum(2)  → base32.
 * For G addresses, version byte is 0x30 (0b00110000).
 *
 * We re-implement here (instead of pulling @stellar/stellar-sdk) so this
 * package stays small for browser bundles — the SDK alone is ~1.5 MB.
 */
function strkeyToRawBytes(address: string): Uint8Array {
  if (!/^G[A-Z2-7]{55}$/.test(address)) {
    throw new Error(`invalid Stellar G-address: ${address}`);
  }
  const raw = base32Decode(address);
  if (raw.length !== 35) {
    throw new Error(`strkey decoded to ${raw.length} bytes, expected 35`);
  }
  if (raw[0] !== 0x30) {
    throw new Error(`strkey version byte 0x${raw[0]!.toString(16)}, expected 0x30 (G)`);
  }
  return raw.slice(1, 33);
}

function base32Decode(s: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const out: number[] = [];
  let bits = 0;
  let bitCount = 0;
  for (const ch of s) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) throw new Error(`invalid base32 char: ${ch}`);
    bits = (bits << 5) | idx;
    bitCount += 5;
    if (bitCount >= 8) {
      bitCount -= 8;
      out.push((bits >> bitCount) & 0xff);
    }
  }
  return Uint8Array.from(out);
}
