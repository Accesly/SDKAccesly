import { describe, expect, it } from 'vitest';

import { ALLOWLIST, ALWAYS_BLOCK, checkAllowlist, checkAlwaysBlock } from '../audit-no-custody.mjs';

describe('audit-no-custody / checkAlwaysBlock', () => {
  it('flags localStorage.setItem with secret-like keys', () => {
    const src = `localStorage.setItem('seed', mySeed);`;
    const v = checkAlwaysBlock('packages/x/src/a.ts', src);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('localStorage-secret');
    expect(v[0].file).toBe('packages/x/src/a.ts');
    expect(v[0].line).toBe(1);
  });

  it('flags sessionStorage.setItem with privateKey', () => {
    const src = `sessionStorage.setItem("user_privateKey", k);`;
    const v = checkAlwaysBlock('p.ts', src);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('sessionStorage-secret');
  });

  it('flags console.log of seed/secret/etc.', () => {
    const src = `console.log('seed=', seed);\nconsole.error("secret:", x);`;
    const v = checkAlwaysBlock('p.ts', src);
    expect(v.map((x) => x.line).sort()).toEqual([1, 2]);
    expect(v.every((x) => x.rule === 'console-secret')).toBe(true);
  });

  it('flags any usage of the word mnemonic', () => {
    const src = `const mnemonic = derive(seed);`;
    const v = checkAlwaysBlock('p.ts', src);
    expect(v.some((x) => x.rule === 'mnemonic-anywhere')).toBe(true);
  });

  it('flags bip-39 and BIP39 variants', () => {
    expect(
      checkAlwaysBlock('p.ts', `import bip39 from 'bip-39';`).some((x) => x.rule === 'bip39'),
    ).toBe(true);
    expect(
      checkAlwaysBlock('p.ts', `// uses BIP39 wordlists`).some((x) => x.rule === 'bip39'),
    ).toBe(false); // comments are stripped before scanning
  });

  it('ignores single-line // and * comments so docs do not self-trigger', () => {
    const src = [
      `// localStorage.setItem('seed', x)`,
      `* console.log("privateKey", k)`,
      `const ok = true;`,
    ].join('\n');
    expect(checkAlwaysBlock('p.ts', src)).toEqual([]);
  });

  it('returns no violations on clean source', () => {
    const src = `export function add(a, b) { return a + b; }`;
    expect(checkAlwaysBlock('p.ts', src)).toEqual([]);
  });

  it('preserves the file + line + excerpt fields', () => {
    const src = `\n\nlocalStorage.setItem('seed', x);`;
    const [v] = checkAlwaysBlock('packages/core/src/foo.ts', src);
    expect(v).toMatchObject({
      file: 'packages/core/src/foo.ts',
      line: 3,
      rule: 'localStorage-secret',
    });
    expect(v.excerpt).toContain('localStorage.setItem');
  });

  it('accepts a custom rules array to keep the helper pure', () => {
    const rules = [{ id: 'no-foo', pattern: /\bfoo\b/, why: 'no foo' }];
    const v = checkAlwaysBlock('p.ts', 'foo bar', rules);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('no-foo');
  });
});

describe('audit-no-custody / checkAllowlist', () => {
  it('flags shamirCombine outside allowlisted files', () => {
    const src = `import { shamirCombine } from './crypto/shamir.js';`;
    const v = checkAllowlist('packages/react/src/forbidden.ts', src);
    const hit = v.find((x) => x.rule === 'allowlist:shamirCombine');
    expect(hit).toBeDefined();
    expect(hit.line).toBe(1);
  });

  it('allows shamirCombine inside an allowlisted file', () => {
    const allowed = [...ALLOWLIST.shamirCombine][0];
    const src = `import { shamirCombine } from '../crypto/shamir.js';`;
    const v = checkAllowlist(allowed, src);
    expect(v.find((x) => x.rule === 'allowlist:shamirCombine')).toBeUndefined();
  });

  it('strips comment-only lines before scanning the allowlist', () => {
    const src = `// uses shamirCombine elsewhere\n* shamirCombine docs\nconst x = 1;`;
    const v = checkAllowlist('packages/react/src/foo.ts', src);
    expect(v).toEqual([]);
  });

  it('flags ed25519.sign outside allowlisted files', () => {
    const src = `await ed25519.sign(msg, seed);`;
    const v = checkAllowlist('packages/core/src/anywhere.ts', src);
    expect(v.some((x) => x.rule === 'allowlist:ed25519.sign')).toBe(true);
  });

  it('accepts a custom allowlist for hermetic testing', () => {
    const allow = { fancyOp: new Set(['packages/x/src/ok.ts']) };
    const src = `fancyOp(payload);`;
    expect(checkAllowlist('packages/x/src/ok.ts', src, allow)).toEqual([]);
    expect(checkAllowlist('packages/x/src/nope.ts', src, allow)).toHaveLength(1);
  });

  it('returns empty when needles do not appear', () => {
    const src = `export function noop() {}`;
    expect(checkAllowlist('packages/x/src/foo.ts', src)).toEqual([]);
  });
});

describe('audit-no-custody / config invariants', () => {
  it('ALWAYS_BLOCK rules each carry id + pattern + why', () => {
    for (const r of ALWAYS_BLOCK) {
      expect(typeof r.id).toBe('string');
      expect(r.pattern).toBeInstanceOf(RegExp);
      expect(typeof r.why).toBe('string');
    }
  });

  it('ALLOWLIST values are Set instances with string paths', () => {
    for (const [needle, paths] of Object.entries(ALLOWLIST)) {
      expect(typeof needle).toBe('string');
      expect(paths).toBeInstanceOf(Set);
      for (const p of paths) {
        expect(typeof p).toBe('string');
        // Allowlist entries are repo-relative and forward-slashed.
        expect(p.includes('\\')).toBe(false);
      }
    }
  });
});
