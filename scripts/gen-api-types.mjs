#!/usr/bin/env node
/**
 * gen-api-types.mjs
 *
 * Generates TypeScript types from the backend OpenAPI spec into
 * `packages/core/src/types/api.generated.ts`.
 *
 * Sources (resolved in order):
 *   1. `--input <path>` CLI flag
 *   2. `ACCESLY_OPENAPI_PATH` env var (local file path)
 *   3. `ACCESLY_OPENAPI_URL` env var (URL)
 *   4. Default URL pointing to the backend repo on GitHub (raw)
 *
 * Requires `openapi-typescript` installed (root devDependency, added on demand).
 * Run: `pnpm run gen:api-types`
 *
 * CI behaviour: after generation, the script checks `git diff` to detect drift.
 * If the generated file changed without being committed alongside the change to
 * the spec, CI will fail (run `pnpm run gen:api-types` locally and commit).
 */

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(process.cwd());
const OUT_PATH = resolve(ROOT, 'packages/core/src/types/api.generated.ts');

export const DEFAULT_URL =
  'https://raw.githubusercontent.com/daniellagart4-sys/CloudServices-accesly/main/docs/openapi.yaml';

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { input: undefined, check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--input' && argv[i + 1]) {
      out.input = argv[i + 1];
      i += 1;
    } else if (a === '--check') {
      out.check = true;
    }
  }
  return out;
}

/**
 * Resolves which OpenAPI spec to feed `openapi-typescript`. Order:
 *   1. `input` arg (CLI `--input <path|url>`)
 *   2. `ACCESLY_OPENAPI_PATH` env var (file)
 *   3. `ACCESLY_OPENAPI_URL` env var (url)
 *   4. Default GitHub URL
 *
 * Tests can pass `opts` to override `cwd`, `env`, and the `existsSync`
 * dependency so resolution can be exercised without touching the real
 * filesystem.
 */
export async function resolveSpec(input, opts = {}) {
  const cwd = opts.cwd ?? ROOT;
  const env = opts.env ?? process.env;
  const fsExists = opts.existsSync ?? existsSync;
  if (input) {
    if (input.startsWith('http://') || input.startsWith('https://')) {
      return { kind: 'url', value: input };
    }
    const abs = resolve(cwd, input);
    if (!fsExists(abs)) {
      throw new Error(`spec file not found: ${abs}`);
    }
    return { kind: 'file', value: abs };
  }
  if (env['ACCESLY_OPENAPI_PATH']) {
    const abs = resolve(cwd, env['ACCESLY_OPENAPI_PATH']);
    if (!fsExists(abs)) throw new Error(`spec file not found: ${abs}`);
    return { kind: 'file', value: abs };
  }
  if (env['ACCESLY_OPENAPI_URL']) {
    return { kind: 'url', value: env['ACCESLY_OPENAPI_URL'] };
  }
  return { kind: 'url', value: DEFAULT_URL };
}

function ensureOpenapiTypescript() {
  const result = spawnSync('pnpm', ['exec', 'openapi-typescript', '--version'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.status === 0) return;
  console.log('[gen-api-types] installing openapi-typescript on demand...');
  const install = spawnSync('pnpm', ['add', '-Dw', 'openapi-typescript@^7'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (install.status !== 0) {
    throw new Error('failed to install openapi-typescript');
  }
}

function generate(spec) {
  ensureOpenapiTypescript();
  mkdirSync(dirname(OUT_PATH), { recursive: true });

  const args = ['exec', 'openapi-typescript', spec.value, '-o', OUT_PATH];
  console.log(`[gen-api-types] generating from ${spec.kind}: ${spec.value}`);
  const result = spawnSync('pnpm', args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`openapi-typescript exited with code ${result.status}`);
  }

  const banner = `/**
 * AUTO-GENERATED — do not edit by hand.
 * Regenerate via: pnpm run gen:api-types
 * Source: ${spec.value}
 */

`;
  const current = readFileSync(OUT_PATH, 'utf8');
  if (!current.startsWith('/**\n * AUTO-GENERATED')) {
    writeFileSync(OUT_PATH, banner + current, 'utf8');
  }
  console.log(`[gen-api-types] wrote ${OUT_PATH}`);
}

function checkClean() {
  try {
    const out = execSync(`git diff --name-only -- ${OUT_PATH}`, { encoding: 'utf8' });
    if (out.trim().length > 0) {
      console.error('[gen-api-types] generated file differs from committed version:');
      console.error(out);
      console.error('Run `pnpm run gen:api-types` locally and commit the result.');
      process.exit(1);
    }
    console.log('[gen-api-types] generated file matches committed version');
  } catch {
    console.warn('[gen-api-types] git not available, skipping drift check');
  }
}

async function main() {
  const { input, check } = parseArgs();
  const spec = await resolveSpec(input);
  generate(spec);
  if (check) checkClean();
}

// CLI entry guard: only run main() when invoked as a script, not on import.
const isCliEntry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCliEntry) {
  main().catch((err) => {
    console.error('[gen-api-types] error:', err.message);
    process.exit(1);
  });
}
