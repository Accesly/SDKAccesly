import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDbDeviceStore, InMemoryDeviceStore } from '../../../src/webauthn/storage.js';
import type { CredentialRecord } from '../../../src/webauthn/types.js';

function makeRecord(username: string): CredentialRecord {
  return {
    username,
    credentialId: new Uint8Array(32).fill(1),
    secp256r1Pubkey: new Uint8Array(65).fill(2),
    fragmentF1Encrypted: {
      ciphertext: new Uint8Array(48).fill(3),
      nonce: new Uint8Array(12).fill(4),
    },
    prfSalt: new Uint8Array(32).fill(5),
    fallbackKeyMaterial: new Uint8Array(0),
    walletAddress: null,
    createdAt: Date.now(),
  };
}

describe('webauthn/storage InMemoryDeviceStore', () => {
  it('round-trips a record', async () => {
    const store = new InMemoryDeviceStore();
    const rec = makeRecord('alice@accesly.xyz');
    await store.saveCredential(rec);
    expect(await store.loadCredential('alice@accesly.xyz')).toEqual(rec);
  });

  it('returns null for missing username', async () => {
    const store = new InMemoryDeviceStore();
    expect(await store.loadCredential('missing')).toBeNull();
  });

  it('deletes a record', async () => {
    const store = new InMemoryDeviceStore();
    await store.saveCredential(makeRecord('x'));
    await store.deleteCredential('x');
    expect(await store.loadCredential('x')).toBeNull();
  });

  it('lists all records', async () => {
    const store = new InMemoryDeviceStore();
    await store.saveCredential(makeRecord('a'));
    await store.saveCredential(makeRecord('b'));
    const all = await store.listCredentials();
    expect(all).toHaveLength(2);
  });
});

describe('webauthn/storage IndexedDbDeviceStore (fake-indexeddb)', () => {
  it('round-trips a record via the fake IDB', async () => {
    const store = new IndexedDbDeviceStore();
    const rec = makeRecord('idb@accesly.xyz');
    await store.saveCredential(rec);
    const loaded = await store.loadCredential('idb@accesly.xyz');
    expect(loaded?.username).toBe('idb@accesly.xyz');
    expect(loaded?.credentialId.length).toBe(32);
  });

  it('deletes via the fake IDB', async () => {
    const store = new IndexedDbDeviceStore();
    await store.saveCredential(makeRecord('del@accesly.xyz'));
    await store.deleteCredential('del@accesly.xyz');
    expect(await store.loadCredential('del@accesly.xyz')).toBeNull();
  });
});
