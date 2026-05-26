/**
 * Persistent device storage for `CredentialRecord` entries.
 *
 * Default implementation: IndexedDB under DB `accesly` / store `credentials`.
 * Consumers (SSR, React Native, Electron) can pass their own `DeviceStore`
 * implementation to `AcceslyProvider` if they need a different backend.
 */

import type { CredentialRecord } from './types.js';

export interface DeviceStore {
  saveCredential(record: CredentialRecord): Promise<void>;
  loadCredential(username: string): Promise<CredentialRecord | null>;
  deleteCredential(username: string): Promise<void>;
  listCredentials(): Promise<readonly CredentialRecord[]>;
}

const DB_NAME = 'accesly';
const DB_VERSION = 1;
const STORE_NAME = 'credentials';

/**
 * In-memory device store. Use for tests, SSR, or apps that intentionally
 * forget credentials between sessions (re-register every time).
 */
export class InMemoryDeviceStore implements DeviceStore {
  private readonly entries = new Map<string, CredentialRecord>();

  saveCredential(record: CredentialRecord): Promise<void> {
    this.entries.set(record.username, record);
    return Promise.resolve();
  }

  loadCredential(username: string): Promise<CredentialRecord | null> {
    return Promise.resolve(this.entries.get(username) ?? null);
  }

  deleteCredential(username: string): Promise<void> {
    this.entries.delete(username);
    return Promise.resolve();
  }

  listCredentials(): Promise<readonly CredentialRecord[]> {
    return Promise.resolve([...this.entries.values()]);
  }
}

/**
 * IndexedDB-backed device store. Stable across browser sessions and
 * isolated per origin.
 */
export class IndexedDbDeviceStore implements DeviceStore {
  private readonly idbFactory: IDBFactory;

  constructor(idbFactory?: IDBFactory) {
    if (idbFactory) {
      this.idbFactory = idbFactory;
    } else if (typeof indexedDB !== 'undefined') {
      this.idbFactory = indexedDB;
    } else {
      throw new Error(
        'IndexedDbDeviceStore: indexedDB is not available. ' +
          'Pass a custom IDBFactory or use InMemoryDeviceStore.',
      );
    }
  }

  async saveCredential(record: CredentialRecord): Promise<void> {
    const db = await this.openDb();
    try {
      await runTx(db, 'readwrite', (store) => store.put(record));
    } finally {
      db.close();
    }
  }

  async loadCredential(username: string): Promise<CredentialRecord | null> {
    const db = await this.openDb();
    try {
      const value = await runTx<CredentialRecord | undefined>(db, 'readonly', (store) =>
        store.get(username),
      );
      return value ?? null;
    } finally {
      db.close();
    }
  }

  async deleteCredential(username: string): Promise<void> {
    const db = await this.openDb();
    try {
      await runTx(db, 'readwrite', (store) => store.delete(username));
    } finally {
      db.close();
    }
  }

  async listCredentials(): Promise<readonly CredentialRecord[]> {
    const db = await this.openDb();
    try {
      const value = await runTx<CredentialRecord[]>(db, 'readonly', (store) => store.getAll());
      return value;
    } finally {
      db.close();
    }
  }

  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = this.idbFactory.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'username' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    });
  }
}

function runTx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const request = op(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}
