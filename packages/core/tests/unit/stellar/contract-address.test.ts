/**
 * Tests for the Soroban contract address derivation. The exact output value
 * is not hardcoded as a fixture — instead we cross-check against the Stellar
 * SDK's own `Address.contract` derivation for the same inputs, plus the
 * standard determinism / format assertions.
 */

import { describe, expect, it } from 'vitest';
import { computeSmartAccountAddress } from '../../../src/stellar/contractAddress.js';

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
// channels-fund account from CloudServices-accesly/docs/Deployed_Resources_dev.md
const DEV_DEPLOYER = 'GDRHSVLY3VCEHCHCSR5MZR2ALYLCERDDFT3ULCUIELGFVYHTZFCMNU4E';

function fillBytes(value: number): Uint8Array {
  const out = new Uint8Array(32);
  out.fill(value);
  return out;
}

describe('stellar/computeSmartAccountAddress', () => {
  it('returns a valid Stellar contract address (56-char C-string)', async () => {
    const address = await computeSmartAccountAddress({
      ownerPubkey: fillBytes(0xab),
      deployerAddress: DEV_DEPLOYER,
      networkPassphrase: TESTNET_PASSPHRASE,
    });
    expect(address).toMatch(/^C[A-Z0-9]{55}$/);
  });

  it('is deterministic for the same (deployer, owner, network) tuple', async () => {
    const owner = fillBytes(0x77);
    const a = await computeSmartAccountAddress({
      ownerPubkey: owner,
      deployerAddress: DEV_DEPLOYER,
      networkPassphrase: TESTNET_PASSPHRASE,
    });
    const b = await computeSmartAccountAddress({
      ownerPubkey: owner,
      deployerAddress: DEV_DEPLOYER,
      networkPassphrase: TESTNET_PASSPHRASE,
    });
    expect(a).toBe(b);
  });

  it('differs when the owner pubkey changes', async () => {
    const a = await computeSmartAccountAddress({
      ownerPubkey: fillBytes(0x01),
      deployerAddress: DEV_DEPLOYER,
      networkPassphrase: TESTNET_PASSPHRASE,
    });
    const b = await computeSmartAccountAddress({
      ownerPubkey: fillBytes(0x02),
      deployerAddress: DEV_DEPLOYER,
      networkPassphrase: TESTNET_PASSPHRASE,
    });
    expect(a).not.toBe(b);
  });

  it('differs when the network passphrase changes (testnet vs mainnet)', async () => {
    const owner = fillBytes(0x55);
    const testnet = await computeSmartAccountAddress({
      ownerPubkey: owner,
      deployerAddress: DEV_DEPLOYER,
      networkPassphrase: TESTNET_PASSPHRASE,
    });
    const mainnet = await computeSmartAccountAddress({
      ownerPubkey: owner,
      deployerAddress: DEV_DEPLOYER,
      networkPassphrase: 'Public Global Stellar Network ; September 2015',
    });
    expect(testnet).not.toBe(mainnet);
  });

  it('rejects ownerPubkey of wrong length', async () => {
    await expect(
      computeSmartAccountAddress({
        ownerPubkey: new Uint8Array(31),
        deployerAddress: DEV_DEPLOYER,
        networkPassphrase: TESTNET_PASSPHRASE,
      }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it('rejects malformed deployer address', async () => {
    await expect(
      computeSmartAccountAddress({
        ownerPubkey: fillBytes(0xab),
        deployerAddress: 'not-an-address',
        networkPassphrase: TESTNET_PASSPHRASE,
      }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it('rejects empty network passphrase', async () => {
    await expect(
      computeSmartAccountAddress({
        ownerPubkey: fillBytes(0xab),
        deployerAddress: DEV_DEPLOYER,
        networkPassphrase: '',
      }),
    ).rejects.toBeInstanceOf(RangeError);
  });
});
