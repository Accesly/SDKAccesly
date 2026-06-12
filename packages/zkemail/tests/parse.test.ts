import { describe, expect, it } from 'vitest';
import { DkimSignatureError, EmlParseError } from '../src/errors';
import { buildSignedHeaderBytes, parseEml } from '../src/eml/parse';

const SAMPLE_EML = [
  'From: alice@example.com',
  'To: bob@example.com',
  'Date: Thu, 12 Jun 2026 10:00:00 +0000',
  'Subject: Accesly Recovery',
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=UTF-8',
  'DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=example.com;',
  ' s=test2026; h=from:to:date:subject:mime-version:content-type;',
  ' bh=47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=; b=AAAA',
  '',
  'body content',
].join('\r\n');

describe('parseEml', () => {
  it('parses headers, unfolding continuation lines', () => {
    const parsed = parseEml(SAMPLE_EML);
    const names = parsed.headers.map((h) => h.name);
    expect(names).toContain('DKIM-Signature');
    const dkimHeader = parsed.headers.find((h) => h.name === 'DKIM-Signature')!;
    // Continuation lines are joined with a single space.
    expect(dkimHeader.value).toContain('s=test2026');
    expect(dkimHeader.value).toContain('bh=');
  });

  it('extracts DKIM tags', () => {
    const { dkim } = parseEml(SAMPLE_EML);
    expect(dkim.v).toBe('1');
    expect(dkim.a).toBe('rsa-sha256');
    expect(dkim.c).toBe('relaxed/relaxed');
    expect(dkim.d).toBe('example.com');
    expect(dkim.s).toBe('test2026');
    expect(dkim.h).toEqual(['from', 'to', 'date', 'subject', 'mime-version', 'content-type']);
    expect(dkim.b.length).toBeGreaterThan(0);
  });

  it('throws when there is no header/body separator', () => {
    expect(() => parseEml('no-separator-here')).toThrow(EmlParseError);
  });

  it('throws when DKIM-Signature is missing', () => {
    const noDkim = 'From: a@b\r\nSubject: hi\r\n\r\nbody';
    expect(() => parseEml(noDkim)).toThrow(DkimSignatureError);
  });

  it('rejects non-relaxed canonicalization', () => {
    const simple = SAMPLE_EML.replace('c=relaxed/relaxed', 'c=simple/simple');
    expect(() => parseEml(simple)).toThrow(DkimSignatureError);
  });

  it('rejects non rsa-sha256 algorithm', () => {
    const ed = SAMPLE_EML.replace('a=rsa-sha256', 'a=ed25519-sha256');
    expect(() => parseEml(ed)).toThrow(DkimSignatureError);
  });

  it('builds signed header bytes that reproduce the h= order with relaxed canonicalization', () => {
    const parsed = parseEml(SAMPLE_EML);
    const bytes = buildSignedHeaderBytes(parsed);
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded.startsWith('from:alice@example.com\r\n')).toBe(true);
    expect(decoded).toContain('to:bob@example.com\r\n');
    expect(decoded).toContain('subject:Accesly Recovery\r\n');
    // Trailing DKIM-Signature line has no CRLF.
    expect(decoded.endsWith('\r\n')).toBe(false);
    // b= must be cleared in the trailing DKIM-Signature line.
    expect(decoded).toContain('dkim-signature:');
    expect(decoded).not.toContain('b=AAAA');
  });
});
