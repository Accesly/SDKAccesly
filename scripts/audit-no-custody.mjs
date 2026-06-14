#!/usr/bin/env node
/**
 * audit-no-custody.mjs
 *
 * CI-blocking guard that enforces the non-custodial premise of the Accesly SDK
 * (mirrors `scripts/audit-no-custody.js` of the CloudServices-accesly backend repo).
 *
 * Rules:
 *  1. ALWAYS-BLOCK patterns trigger a failure anywhere they appear. Used for things that
 *     should never exist in source: writing seeds to localStorage, console.log'ing
 *     secrets, etc.
 *  2. ALLOWLISTED patterns may appear only in explicitly listed files. These are the
 *     files that are *supposed* to touch raw key material (Shamir combine, the signer
 *     module, etc.). Outside those files, any match fails the build.
 *
 * Run: `node scripts/audit-no-custody.mjs` from the repo root. Exit code 0 = clean,
 * 1 = violation, 2 = misconfiguration.
 *
 * Add new allowlisted files via the ALLOWLIST map below. Adding a file is a security
 * decision — require a code review when touching this script.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(process.cwd());

/**
 * Always-block: these patterns MUST NOT appear anywhere in package source.
 * Each entry: { id, pattern, why }.
 */
export const ALWAYS_BLOCK = [
  {
    id: 'localStorage-secret',
    pattern: /localStorage\.setItem\s*\([^)]*(secret|seed|privateKey|private_key|privKey)/i,
    why: 'Storing raw secret/seed/privateKey in localStorage is forbidden. Encrypt first.',
  },
  {
    id: 'sessionStorage-secret',
    pattern: /sessionStorage\.setItem\s*\([^)]*(secret|seed|privateKey|private_key|privKey)/i,
    why: 'Storing raw secret/seed/privateKey in sessionStorage is forbidden. Encrypt first.',
  },
  {
    id: 'console-secret',
    pattern:
      /console\.(log|debug|info|warn|error)\s*\([^)]*(secret|seed|privateKey|private_key|privKey|mnemonic)/i,
    why: 'Never log secret/seed/privateKey/mnemonic. Even in error paths.',
  },
  {
    id: 'mnemonic-anywhere',
    pattern: /\bmnemonic\b/i,
    why: 'Accesly does not use BIP-39 mnemonics. If you need one, raise an ADR first.',
  },
  {
    id: 'bip39',
    pattern: /\bbip-?39\b/i,
    why: 'BIP-39 is not part of the Accesly trust model. See ADR-003.',
  },
];

/**
 * Allowlisted patterns: these may appear ONLY in the listed files.
 * Outside the allowlist, a match fails the build.
 *
 * Paths are relative to repo root, forward-slash, exact match.
 */
export const ALLOWLIST = {
  'Keypair.fromSecret': new Set([
    // Stellar Keypair.fromSecret is forbidden — we never reconstruct a Stellar
    // Keypair from a secret string. Signing is done with raw seeds via @noble.
  ]),
  'Keypair.fromRawEd25519Seed': new Set(['packages/core/src/stellar/signer.ts']),
  'ed25519.sign': new Set([
    'packages/core/src/stellar/signer.ts',
    'packages/core/src/crypto/keypair.ts',
  ]),
  'shamir.combine': new Set([
    'packages/core/src/mpc/combine.ts',
    'packages/core/src/crypto/shamir.ts',
  ]),
  shamirCombine: new Set([
    'packages/core/src/mpc/combine.ts',
    'packages/core/src/mpc/index.ts',
    'packages/core/src/crypto/shamir.ts',
    'packages/core/src/crypto/index.ts',
  ]),
  splitSecret: new Set([
    'packages/core/src/mpc/split.ts',
    'packages/core/src/crypto/shamir.ts',
    'packages/core/src/crypto/index.ts',
  ]),
};

const SCAN_ROOTS = ['packages']; // recurse into packages/*/src/**
const EXTENSIONS = ['.ts', '.tsx'];

function walk(dir, acc) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.turbo') continue;
      walk(full, acc);
    } else if (EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      // Only scan files under a `src` segment
      const rel = relative(ROOT, full).replace(/\\/g, '/');
      if (rel.includes('/src/')) acc.push(rel);
    }
  }
}

function collectFiles() {
  const files = [];
  for (const root of SCAN_ROOTS) {
    walk(resolve(ROOT, root), files);
  }
  return files;
}

export function checkAlwaysBlock(relPath, source, rules = ALWAYS_BLOCK) {
  const violations = [];
  for (const rule of rules) {
    const lines = source.split('\n');
    lines.forEach((line, idx) => {
      // Strip trivial comment lines so commentary explaining the rule
      // (e.g., this file) does not self-trigger.
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
        return;
      }
      if (rule.pattern.test(line)) {
        violations.push({
          file: relPath,
          line: idx + 1,
          rule: rule.id,
          why: rule.why,
          excerpt: line.trim().slice(0, 140),
        });
      }
    });
  }
  return violations;
}

export function checkAllowlist(relPath, source, allowlist = ALLOWLIST) {
  const violations = [];
  for (const [needle, allowed] of Object.entries(allowlist)) {
    if (allowed.has(relPath)) continue;
    const lines = source.split('\n');
    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
      if (line.includes(needle)) {
        violations.push({
          file: relPath,
          line: idx + 1,
          rule: `allowlist:${needle}`,
          why: `'${needle}' may only appear in allowlisted files. Add the file to ALLOWLIST in scripts/audit-no-custody.mjs if it legitimately handles key material (requires code review).`,
          excerpt: line.trim().slice(0, 140),
        });
      }
    });
  }
  return violations;
}

function main() {
  console.log('[audit-no-custody] scanning packages/*/src...');
  const files = collectFiles();
  if (files.length === 0) {
    console.warn('[audit-no-custody] no source files found under packages/*/src — nothing to scan');
    process.exit(0);
  }

  const allViolations = [];
  for (const file of files) {
    const abs = resolve(ROOT, file);
    const source = readFileSync(abs, 'utf8');
    const rel = relative(ROOT, abs).replace(/\\/g, '/');
    allViolations.push(...checkAlwaysBlock(rel, source));
    allViolations.push(...checkAllowlist(rel, source));
  }

  if (allViolations.length === 0) {
    console.log(`[audit-no-custody] clean — ${files.length} files scanned, 0 violations`);
    process.exit(0);
  }

  console.error(`\n[audit-no-custody] FAILED — ${allViolations.length} violation(s):\n`);
  for (const v of allViolations) {
    console.error(`  ${v.file}:${v.line}  [${v.rule}]`);
    console.error(`    ${v.excerpt}`);
    console.error(`    why: ${v.why}\n`);
  }
  console.error(`Fix the violations above. If a usage is legitimate, add the file to the`);
  console.error(`ALLOWLIST in scripts/audit-no-custody.mjs (requires code review).`);
  process.exit(1);
}

// CLI entry guard: only run main() when invoked as a script, not on import.
const isCliEntry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCliEntry) {
  try {
    main();
  } catch (err) {
    console.error('[audit-no-custody] internal error:', err);
    process.exit(2);
  }
}

// Re-export resolved path of this module — useful for tests that want
// to construct fixtures relative to the script's location.
export const __scriptPath = fileURLToPath(import.meta.url);
