import { describe, expect, it } from 'vitest';
import { canonicalizeHeaders, relaxedHeader } from '../src/eml/canonicalize';

describe('relaxedHeader', () => {
  it('lowercases the header name', () => {
    expect(relaxedHeader('Subject', 'hi')).toBe('subject:hi\r\n');
  });

  it('collapses internal whitespace runs to a single space', () => {
    expect(relaxedHeader('Subject', 'a   b\t\tc')).toBe('subject:a b c\r\n');
  });

  it('strips leading and trailing whitespace', () => {
    expect(relaxedHeader('Subject', '   hello world   ')).toBe('subject:hello world\r\n');
  });

  it('unfolds CRLF + WSP continuation lines', () => {
    // Folded header value with a CRLF + space continuation.
    expect(relaxedHeader('Subject', 'part one\r\n part two')).toBe('subject:part one part two\r\n');
  });

  it('ends with CRLF', () => {
    expect(relaxedHeader('From', 'a@b').endsWith('\r\n')).toBe(true);
  });
});

describe('canonicalizeHeaders', () => {
  it('concatenates h= order and records value ranges', () => {
    const { bytes, ranges } = canonicalizeHeaders([
      { name: 'From', value: 'a@b' },
      { name: 'Subject', value: 'hello' },
    ]);
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).toBe('from:a@b\r\nsubject:hello\r\n');

    const fromRange = ranges.get('from');
    expect(fromRange).toEqual({ offset: 5, length: 3 }); // "from:" is 5 bytes, value "a@b" is 3
    expect(decoded.slice(fromRange!.offset, fromRange!.offset + fromRange!.length)).toBe('a@b');

    const subjRange = ranges.get('subject');
    // "from:a@b\r\n" = 10 bytes, then "subject:" = 8 → value at offset 18.
    expect(subjRange).toEqual({ offset: 18, length: 5 });
    expect(decoded.slice(subjRange!.offset, subjRange!.offset + subjRange!.length)).toBe('hello');
  });

  it('returns empty bytes for empty header list', () => {
    const { bytes, ranges } = canonicalizeHeaders([]);
    expect(bytes.length).toBe(0);
    expect(ranges.size).toBe(0);
  });
});
