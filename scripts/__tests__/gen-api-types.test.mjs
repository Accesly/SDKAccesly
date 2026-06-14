import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_URL, parseArgs, resolveSpec } from '../gen-api-types.mjs';

describe('gen-api-types / parseArgs', () => {
  it('returns defaults when called with an empty argv', () => {
    expect(parseArgs([])).toEqual({ input: undefined, check: false });
  });

  it('parses --input <path>', () => {
    expect(parseArgs(['--input', 'docs/openapi.yaml'])).toEqual({
      input: 'docs/openapi.yaml',
      check: false,
    });
  });

  it('parses --check flag', () => {
    expect(parseArgs(['--check'])).toEqual({ input: undefined, check: true });
  });

  it('parses --input together with --check (order independent)', () => {
    expect(parseArgs(['--check', '--input', 'foo.yaml'])).toEqual({
      input: 'foo.yaml',
      check: true,
    });
    expect(parseArgs(['--input', 'foo.yaml', '--check'])).toEqual({
      input: 'foo.yaml',
      check: true,
    });
  });

  it('ignores unknown flags', () => {
    expect(parseArgs(['--what', '--input', 'x.yaml'])).toEqual({
      input: 'x.yaml',
      check: false,
    });
  });

  it('drops --input when no value follows', () => {
    expect(parseArgs(['--input'])).toEqual({ input: undefined, check: false });
  });
});

describe('gen-api-types / resolveSpec', () => {
  const cwd = '/repo';

  it('returns kind=url when input is an http(s) URL', async () => {
    expect(await resolveSpec('https://example.com/api.yaml')).toEqual({
      kind: 'url',
      value: 'https://example.com/api.yaml',
    });
    expect(await resolveSpec('http://example.com/api.yaml')).toEqual({
      kind: 'url',
      value: 'http://example.com/api.yaml',
    });
  });

  it('returns kind=file (resolved absolute) when input is a path that exists', async () => {
    const seen = [];
    const fake = (p) => {
      seen.push(p);
      return true;
    };
    const result = await resolveSpec('docs/openapi.yaml', {
      cwd,
      env: {},
      existsSync: fake,
    });
    expect(result).toEqual({ kind: 'file', value: resolve(cwd, 'docs/openapi.yaml') });
    expect(seen[0]).toBe(resolve(cwd, 'docs/openapi.yaml'));
  });

  it('throws when input path does not exist', async () => {
    await expect(
      resolveSpec('missing.yaml', { cwd, env: {}, existsSync: () => false }),
    ).rejects.toThrow(/spec file not found/);
  });

  it('falls back to ACCESLY_OPENAPI_PATH env when input is undefined', async () => {
    const env = { ACCESLY_OPENAPI_PATH: 'docs/api.yaml' };
    const result = await resolveSpec(undefined, { cwd, env, existsSync: () => true });
    expect(result).toEqual({ kind: 'file', value: resolve(cwd, 'docs/api.yaml') });
  });

  it('throws when ACCESLY_OPENAPI_PATH points to a missing file', async () => {
    const env = { ACCESLY_OPENAPI_PATH: 'missing.yaml' };
    await expect(resolveSpec(undefined, { cwd, env, existsSync: () => false })).rejects.toThrow(
      /spec file not found/,
    );
  });

  it('falls back to ACCESLY_OPENAPI_URL env when neither input nor path is set', async () => {
    const env = { ACCESLY_OPENAPI_URL: 'https://example.com/spec.yaml' };
    const result = await resolveSpec(undefined, { cwd, env, existsSync: () => false });
    expect(result).toEqual({ kind: 'url', value: 'https://example.com/spec.yaml' });
  });

  it('falls back to DEFAULT_URL when nothing is provided', async () => {
    const result = await resolveSpec(undefined, { cwd, env: {}, existsSync: () => false });
    expect(result).toEqual({ kind: 'url', value: DEFAULT_URL });
  });

  it('input arg takes precedence over env vars', async () => {
    const env = {
      ACCESLY_OPENAPI_PATH: 'env/path.yaml',
      ACCESLY_OPENAPI_URL: 'https://env.example.com/api.yaml',
    };
    const result = await resolveSpec('https://cli.example.com/api.yaml', {
      cwd,
      env,
      existsSync: () => true,
    });
    expect(result).toEqual({
      kind: 'url',
      value: 'https://cli.example.com/api.yaml',
    });
  });

  it('ACCESLY_OPENAPI_PATH takes precedence over ACCESLY_OPENAPI_URL', async () => {
    const env = {
      ACCESLY_OPENAPI_PATH: 'docs/api.yaml',
      ACCESLY_OPENAPI_URL: 'https://example.com/spec.yaml',
    };
    const result = await resolveSpec(undefined, { cwd, env, existsSync: () => true });
    expect(result).toEqual({ kind: 'file', value: resolve(cwd, 'docs/api.yaml') });
  });
});

describe('gen-api-types / DEFAULT_URL', () => {
  it('points at the backend repo OpenAPI yaml', () => {
    expect(DEFAULT_URL).toMatch(/^https:\/\//);
    expect(DEFAULT_URL.endsWith('openapi.yaml')).toBe(true);
  });
});
