/**
 * RFC 6376 §3.4.2 — relaxed header canonicalization.
 *
 * The DKIM signature in a Gmail email is computed over the relaxed-canonical
 * form of the listed headers. To hash the same bytes in-circuit, we must
 * reproduce this canonicalization exactly.
 *
 * Rules:
 *   - Header name is lower-cased.
 *   - Header value: any continuation lines are unfolded, then runs of WSP
 *     (SP/TAB) collapsed to a single SP, then leading/trailing WSP stripped.
 *   - Output ends with CRLF.
 *
 * Ported from `accesly-zkemail/samples/synthetic/generate.ts` with one
 * change: browser-friendly (no `Buffer`).
 */

export function relaxedHeader(name: string, value: string): string {
  const lowerName = name.toLowerCase();
  const collapsed = value
    .replace(/\r?\n/g, '') // unfold continuation lines first
    .replace(/[\t ]+/g, ' ') // collapse WSP runs
    .replace(/^\s+/, '') // strip leading
    .replace(/\s+$/, ''); // strip trailing
  return `${lowerName}:${collapsed}\r\n`;
}

/**
 * Builds the concatenated relaxed-canonicalized header bytes for the
 * `h=` list, in DKIM-Signature order. Returns the UTF-8 bytes plus a
 * lookup table mapping each header name (lowercased) to its byte range
 * inside the concatenation. The ranges are what the circuit references
 * via `subjectIndex/Length`, `fromIndex/Length`, etc.
 */
export interface CanonicalizedHeaders {
  readonly bytes: Uint8Array;
  /** lowercased name → range of the VALUE (not name) inside `bytes`. */
  readonly ranges: ReadonlyMap<string, { offset: number; length: number }>;
}

export function canonicalizeHeaders(
  headers: ReadonlyArray<{ name: string; value: string }>,
): CanonicalizedHeaders {
  const encoder = new TextEncoder();
  const ranges = new Map<string, { offset: number; length: number }>();
  const parts: Uint8Array[] = [];
  let cursor = 0;
  for (const h of headers) {
    const canon = relaxedHeader(h.name, h.value);
    const canonBytes = encoder.encode(canon);
    // Value starts after `name:` in the canon line.
    const valueOffset = cursor + h.name.length + 1;
    const valueLength = encoder.encode(h.value).length;
    ranges.set(h.name.toLowerCase(), { offset: valueOffset, length: valueLength });
    parts.push(canonBytes);
    cursor += canonBytes.length;
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    bytes.set(p, off);
    off += p.length;
  }
  return { bytes, ranges };
}
