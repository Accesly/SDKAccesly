/**
 * CI-BLOCKING no-custody test #4.
 *
 * The crypto and MPC layers must not write to `localStorage`,
 * `sessionStorage`, or `indexedDB`. Persistent storage belongs in the
 * application layer (Hito 4+), and even there it MUST receive
 * already-encrypted material. A regression that leaks here would silently
 * persist plaintext seeds on every device the SDK runs on.
 *
 * Strategy: install fake globals before the createWallet call, count calls,
 * and assert nothing was attempted.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWallet } from '../../src/mpc/split.js';
import { reconstructKey } from '../../src/mpc/combine.js';
import { getRandomBytes } from '../../src/crypto/random.js';

interface StorageSpy {
  setItem: ReturnType<typeof spyFn>;
  getItem: ReturnType<typeof spyFn>;
  removeItem: ReturnType<typeof spyFn>;
}

function spyFn(): { calls: unknown[][]; fn: (...args: unknown[]) => void } {
  const calls: unknown[][] = [];
  const fn = (...args: unknown[]): void => {
    calls.push(args);
  };
  return { calls, fn } as unknown as { calls: unknown[][]; fn: (...args: unknown[]) => void } & {
    calls: unknown[][];
  };
}

function installFakeStorage(): { local: StorageSpy; session: StorageSpy; idbCalls: unknown[][] } {
  const local = {
    setItem: spyFn(),
    getItem: spyFn(),
    removeItem: spyFn(),
  };
  const session = {
    setItem: spyFn(),
    getItem: spyFn(),
    removeItem: spyFn(),
  };
  const idbCalls: unknown[][] = [];

  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      setItem: local.setItem.fn,
      getItem: local.getItem.fn,
      removeItem: local.removeItem.fn,
    },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: {
      setItem: session.setItem.fn,
      getItem: session.getItem.fn,
      removeItem: session.removeItem.fn,
    },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'indexedDB', {
    value: {
      open: (...args: unknown[]) => {
        idbCalls.push(args);
        // Return a non-functional fake to avoid hanging the test if used.
        throw new Error('indexedDB.open called from non-custody-tested code');
      },
    },
    configurable: true,
    writable: true,
  });

  return { local, session, idbCalls };
}

function uninstallFakeStorage(): void {
  delete (globalThis as Record<string, unknown>)['localStorage'];
  delete (globalThis as Record<string, unknown>)['sessionStorage'];
  delete (globalThis as Record<string, unknown>)['indexedDB'];
}

describe('no-custody #4: crypto + mpc never touch persistent storage', () => {
  let spies: ReturnType<typeof installFakeStorage>;

  beforeEach(() => {
    spies = installFakeStorage();
  });

  afterEach(() => {
    uninstallFakeStorage();
  });

  it('createWallet does not write to localStorage, sessionStorage, or indexedDB', () => {
    const keys = [getRandomBytes(32), getRandomBytes(32), getRandomBytes(32)] as const;
    const result = createWallet({
      emailBytes: new TextEncoder().encode('storage@accesly.xyz'),
      emailSalt: getRandomBytes(32),
      encryptionKeys: keys,
    });
    expect(result.publicKey.length).toBe(32);
    expect(spies.local.setItem.calls.length).toBe(0);
    expect(spies.session.setItem.calls.length).toBe(0);
    expect(spies.idbCalls.length).toBe(0);
  });

  it('reconstructKey does not write to any storage', () => {
    const keys = [getRandomBytes(32), getRandomBytes(32), getRandomBytes(32)] as const;
    const created = createWallet({
      emailBytes: new TextEncoder().encode('recon@accesly.xyz'),
      emailSalt: getRandomBytes(32),
      encryptionKeys: keys,
    });

    // Reset spy counters from the createWallet call above.
    spies.local.setItem.calls.length = 0;
    spies.session.setItem.calls.length = 0;
    spies.idbCalls.length = 0;

    reconstructKey({
      fragments: [
        { envelope: created.encryptedFragments[0]!, key: keys[0]! },
        { envelope: created.encryptedFragments[1]!, key: keys[1]! },
      ],
    });

    expect(spies.local.setItem.calls.length).toBe(0);
    expect(spies.session.setItem.calls.length).toBe(0);
    expect(spies.idbCalls.length).toBe(0);
  });
});
