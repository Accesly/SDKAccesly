/**
 * CI-BLOCKING no-custody test #5.
 *
 * The crypto and MPC layers must never emit anything to `console.*`. Logs are
 * the most common way a secret accidentally lands in a developer's terminal,
 * a Sentry breadcrumb, an OS clipboard, or a CI artifact.
 *
 * Strategy: replace every console method with a recording spy, run the entire
 * happy path AND the error paths (wrong key on reconstruct, malformed input),
 * and assert no recorded call contains the known seed bytes or any
 * suspicious-looking literal.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setRandomSourceForTests, getRandomBytes } from '../../src/crypto/random.js';
import { createWallet } from '../../src/mpc/split.js';
import { reconstructKey } from '../../src/mpc/combine.js';

interface ConsoleSpies {
  log: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
}

function spyConsole(): ConsoleSpies {
  const spies: ConsoleSpies = {
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  for (const method of Object.keys(spies) as Array<keyof ConsoleSpies>) {
    vi.spyOn(console, method).mockImplementation(spies[method]);
  }
  return spies;
}

function allCalls(spies: ConsoleSpies): unknown[] {
  return [
    ...spies.log.mock.calls.flat(),
    ...spies.debug.mock.calls.flat(),
    ...spies.info.mock.calls.flat(),
    ...spies.warn.mock.calls.flat(),
    ...spies.error.mock.calls.flat(),
  ];
}

function containsSensitive(needle: Uint8Array, args: unknown[]): boolean {
  for (const arg of args) {
    if (arg instanceof Uint8Array) {
      for (let i = 0; i <= arg.length - needle.length; i += 1) {
        let match = true;
        for (let j = 0; j < needle.length; j += 1) {
          if (arg[i + j] !== needle[j]) {
            match = false;
            break;
          }
        }
        if (match) return true;
      }
      continue;
    }
    if (typeof arg === 'string') {
      // Hex / base64 / decimal representations
      const hex = Buffer.from(needle).toString('hex');
      const b64 = Buffer.from(needle).toString('base64');
      if (arg.includes(hex) || arg.includes(b64)) return true;
      // Also check for keywords that indicate a likely secret leak.
      const lower = arg.toLowerCase();
      if (lower.includes('seed=') || lower.includes('private_key=')) return true;
    }
  }
  return false;
}

describe('no-custody #5: crypto + mpc never log to console', () => {
  let spies: ConsoleSpies;
  const KNOWN_SEED = new Uint8Array(32).fill(0x5a);

  beforeEach(() => {
    spies = spyConsole();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('happy path createWallet → reconstructKey produces zero console output', () => {
    let callIndex = 0;
    const restore = __setRandomSourceForTests((length) => {
      const out = new Uint8Array(length);
      if (callIndex === 0) {
        out.set(KNOWN_SEED.subarray(0, length));
      } else {
        globalThis.crypto.getRandomValues(out);
      }
      callIndex += 1;
      return out;
    });
    try {
      const keys = [getRandomBytes(32), getRandomBytes(32), getRandomBytes(32)] as const;
      const created = createWallet({
        emailBytes: new TextEncoder().encode('quiet@accesly.xyz'),
        emailSalt: getRandomBytes(32),
        encryptionKeys: keys,
      });
      reconstructKey({
        fragments: [
          { envelope: created.encryptedFragments[0]!, key: keys[0]! },
          { envelope: created.encryptedFragments[1]!, key: keys[1]! },
        ],
      });
    } finally {
      restore();
    }

    const calls = allCalls(spies);
    expect(calls).toHaveLength(0);
    expect(containsSensitive(KNOWN_SEED, calls)).toBe(false);
  });

  it('error path (wrong key) does not leak any console output', () => {
    const keys = [getRandomBytes(32), getRandomBytes(32), getRandomBytes(32)] as const;
    const created = createWallet({
      emailBytes: new TextEncoder().encode('err@accesly.xyz'),
      emailSalt: getRandomBytes(32),
      encryptionKeys: keys,
    });
    expect(() =>
      reconstructKey({
        fragments: [
          { envelope: created.encryptedFragments[0]!, key: keys[0]! },
          { envelope: created.encryptedFragments[1]!, key: getRandomBytes(32) }, // wrong
        ],
      }),
    ).toThrow();

    const calls = allCalls(spies);
    expect(calls).toHaveLength(0);
  });

  it('error path (validation) does not leak any console output', () => {
    expect(() =>
      createWallet({
        emailBytes: new Uint8Array(0),
        emailSalt: new Uint8Array(0),
        encryptionKeys: [new Uint8Array(32), new Uint8Array(32), new Uint8Array(32)],
      }),
    ).toThrow();

    const calls = allCalls(spies);
    expect(calls).toHaveLength(0);
  });
});
