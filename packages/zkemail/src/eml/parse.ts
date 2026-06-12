/**
 * Minimal RFC 5322 / RFC 6376 parser — enough to extract the
 * DKIM-Signature header, its tags, and the headers listed under `h=`.
 *
 * We deliberately do NOT validate signatures, MIME, or body contents.
 * Body is irrelevant for header-only DKIM (zk-email's model). MIME parts
 * never enter the circuit. Signature validity is proven IN the circuit,
 * not pre-checked off-chain.
 */

import { DkimSignatureError, EmlParseError } from '../errors';

const CRLF = '\r\n';

/** A single header occurrence with its position in the original headers section. */
export interface ParsedHeader {
  readonly name: string; // original case preserved
  readonly value: string; // unfolded (continuation lines joined with single space)
}

/** Tags parsed from the `DKIM-Signature:` value. */
export interface DkimTags {
  readonly v: string; // version, always "1"
  readonly a: string; // algorithm, e.g. "rsa-sha256"
  readonly c: string; // canonicalization, e.g. "relaxed/relaxed"
  readonly d: string; // signing domain
  readonly s: string; // selector
  readonly h: readonly string[]; // header names (lowercased, in signing order)
  readonly bh: string; // base64 body hash
  readonly b: Uint8Array; // raw signature bytes (decoded from base64)
}

export interface ParsedEml {
  /** All headers in original case + display order. */
  readonly headers: readonly ParsedHeader[];
  /** Parsed DKIM-Signature tags. */
  readonly dkim: DkimTags;
  /** The raw, unmodified headers section (for diagnostics). */
  readonly headersRaw: string;
}

/**
 * Parses an .eml file. Throws `EmlParseError` if the structure is invalid
 * or `DkimSignatureError` if no/bad DKIM-Signature is present.
 */
export function parseEml(eml: string): ParsedEml {
  // Normalize to CRLF — Gmail's .eml downloads are already CRLF, but
  // some MTAs serve LF. RFC 5322 mandates CRLF.
  const normalized = eml.includes('\r\n') ? eml : eml.replace(/\n/g, CRLF);

  const headerBodySep = normalized.indexOf(CRLF + CRLF);
  if (headerBodySep < 0) {
    throw new EmlParseError('no CRLF CRLF header/body separator found');
  }
  const headersRaw = normalized.slice(0, headerBodySep);
  const headers = unfoldHeaders(headersRaw);
  const dkimRaw = headers.find((h) => h.name.toLowerCase() === 'dkim-signature');
  if (!dkimRaw) {
    throw new DkimSignatureError('no DKIM-Signature header');
  }
  const dkim = parseDkimTags(dkimRaw.value);
  return { headers, dkim, headersRaw };
}

function unfoldHeaders(headersRaw: string): ParsedHeader[] {
  const lines = headersRaw.split(CRLF);
  const out: ParsedHeader[] = [];
  let current: { name: string; valueParts: string[] } | null = null;

  for (const line of lines) {
    if (line.length === 0) continue;
    if (line.startsWith(' ') || line.startsWith('\t')) {
      // continuation of previous header (RFC 5322 §2.2.3)
      if (!current) {
        throw new EmlParseError(`continuation line with no header: ${line.slice(0, 40)}`);
      }
      current.valueParts.push(' ' + line.replace(/^[\t ]+/, ''));
      continue;
    }
    if (current) {
      out.push({ name: current.name, value: current.valueParts.join('') });
    }
    const colon = line.indexOf(':');
    if (colon < 0) {
      throw new EmlParseError(`malformed header (no colon): ${line.slice(0, 40)}`);
    }
    const name = line.slice(0, colon);
    const value = line.slice(colon + 1).trimStart();
    current = { name, valueParts: [value] };
  }
  if (current) {
    out.push({ name: current.name, value: current.valueParts.join('') });
  }
  return out;
}

function parseDkimTags(rawValue: string): DkimTags {
  // Tags: key=value; key=value; ... (RFC 6376 §3.2)
  // base64 values may contain '/', '+', '=' — split on semicolons not
  // preceded by an escape (none in DKIM, simple split is fine).
  const parts = rawValue.split(/\s*;\s*/).map((p) => p.trim()).filter(Boolean);
  const map = new Map<string, string>();
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    map.set(k, v);
  }
  const required = ['v', 'a', 'd', 's', 'h', 'bh', 'b'] as const;
  for (const k of required) {
    if (!map.has(k)) {
      throw new DkimSignatureError(`DKIM-Signature missing required tag "${k}="`);
    }
  }
  const v = map.get('v')!;
  if (v !== '1') {
    throw new DkimSignatureError(`unsupported DKIM version "${v}", expected "1"`);
  }
  const a = map.get('a')!;
  if (a !== 'rsa-sha256') {
    throw new DkimSignatureError(`unsupported DKIM algorithm "${a}", expected "rsa-sha256"`);
  }
  const c = map.get('c') ?? 'simple/simple';
  if (!c.startsWith('relaxed/')) {
    throw new DkimSignatureError(
      `unsupported canonicalization "${c}". Circuit expects relaxed header canonicalization. ` +
        `Gmail uses relaxed/relaxed by default — this email may be from a non-supported provider.`,
    );
  }
  const h = map.get('h')!.split(/\s*:\s*/).map((s) => s.toLowerCase()).filter(Boolean);
  const b = base64ToBytes(map.get('b')!.replace(/\s+/g, ''));
  return {
    v,
    a,
    c,
    d: map.get('d')!,
    s: map.get('s')!,
    h,
    bh: map.get('bh')!,
    b,
  };
}

function base64ToBytes(b64: string): Uint8Array {
  // Pad to multiple of 4 (RFC 4648 §4 — DKIM may omit padding).
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  if (typeof atob !== 'undefined') {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Node fallback (tests run in Node).
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

/**
 * Reconstructs the exact byte sequence that DKIM signed: the h= headers
 * (relaxed-canonicalized in h= order) followed by the DKIM-Signature
 * header itself (relaxed-canonicalized, with `b=` cleared) WITHOUT a
 * trailing CRLF. Per RFC 6376 §3.7.
 *
 * The circuit hashes this exact byte sequence in its `EmailVerifier`
 * component, so the browser must reproduce it identically.
 */
export function buildSignedHeaderBytes(parsed: ParsedEml): Uint8Array {
  const encoder = new TextEncoder();
  const lookup = new Map<string, ParsedHeader>();
  for (const h of parsed.headers) lookup.set(h.name.toLowerCase(), h);

  const parts: Uint8Array[] = [];
  for (const name of parsed.dkim.h) {
    const header = lookup.get(name);
    if (!header) {
      throw new DkimSignatureError(
        `DKIM h= references header "${name}" but it's not in the message`,
      );
    }
    parts.push(encoder.encode(relaxedHeaderLine(header.name, header.value)));
  }

  // Append the DKIM-Signature header itself, with b= cleared, no trailing CRLF.
  const dkimHeader = lookup.get('dkim-signature')!;
  const cleared = clearDkimB(dkimHeader.value);
  const dkimCanon = relaxedHeaderLine(dkimHeader.name, cleared);
  parts.push(encoder.encode(dkimCanon.replace(/\r\n$/, '')));

  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// Inline copy of relaxedHeader to avoid a circular import with canonicalize.ts —
// they're the same function, but keeping parse.ts self-contained makes the
// header-byte reconstruction path easy to audit.
function relaxedHeaderLine(name: string, value: string): string {
  const lowerName = name.toLowerCase();
  const collapsed = value
    .replace(/\r?\n/g, '')
    .replace(/[\t ]+/g, ' ')
    .replace(/^\s+/, '')
    .replace(/\s+$/, '');
  return `${lowerName}:${collapsed}\r\n`;
}

function clearDkimB(value: string): string {
  // Replace the b= tag's value with empty, preserving structure.
  // DKIM tags can appear in any order; b= is always at the end in
  // practice but the spec allows anywhere.
  return value.replace(/(\bb\s*=)\s*[^;]*/, '$1');
}
