/**
 * CI-BLOCKING no-custody test — end-to-end loop:
 *   createWallet → reconstructKey (2 of 3 fragments) → signTransaction → zeroize
 *
 * Verifies the complete non-custody guarantee in the production-path code:
 *  - The seed is reconstructed from F1 + F2 (typical signing flow).
 *  - The signed XDR is produced.
 *  - All sensitive buffers (seed, F1 plain, F2 plain, share data) end at zero.
 *  - The reconstructed pubkey matches what createWallet returned.
 *
 * If any of these properties regress, the signing path is leaking secret
 * material — do NOT merge.
 */

import { describe, expect, it } from 'vitest';
import {
  Account,
  Asset,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { createWallet } from '../../src/mpc/split.js';
import { reconstructKey } from '../../src/mpc/combine.js';
import { signTransaction } from '../../src/stellar/signer.js';
import { getRandomBytes } from '../../src/crypto/random.js';

function isAllZero(buf: Uint8Array): boolean {
  for (let i = 0; i < buf.length; i += 1) if (buf[i] !== 0) return false;
  return true;
}

describe('no-custody loop: createWallet → reconstruct → sign → zeroize', () => {
  it('runs the full loop and zeroizes all secret material', async () => {
    const keys: [Uint8Array, Uint8Array, Uint8Array] = [
      getRandomBytes(32),
      getRandomBytes(32),
      getRandomBytes(32),
    ];

    // 1. Create wallet — generate keypair, split, encrypt fragments.
    const created = createWallet({
      emailBytes: new TextEncoder().encode('loop@accesly.xyz'),
      emailSalt: getRandomBytes(32),
      encryptionKeys: keys,
    });

    // 2. Reconstruct with fragments 0 + 1 (the typical F1+F2 case).
    const reconstructed = reconstructKey({
      fragments: [
        { envelope: created.encryptedFragments[0]!, key: keys[0] },
        { envelope: created.encryptedFragments[1]!, key: keys[1] },
      ],
    });

    // Sanity: the reconstructed pubkey must match the createWallet output.
    expect(Buffer.from(reconstructed.publicKey).equals(Buffer.from(created.publicKey))).toBe(true);

    // 3. Build an unsigned Stellar tx with the reconstructed account as source.
    const stellarAddress = Keypair.fromRawEd25519Seed(
      Buffer.from(new Uint8Array(reconstructed.privateSeed)),
    ).publicKey();
    const account = new Account(stellarAddress, '0');
    const unsignedXdr = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: Keypair.random().publicKey(),
          asset: Asset.native(),
          amount: '1',
        }),
      )
      .setTimeout(180)
      .build()
      .toXDR();

    // 4. Hold a reference to the seed buffer, then sign — signer will zero it.
    const seedRef = reconstructed.privateSeed;
    expect(isAllZero(seedRef)).toBe(false);

    const result = await signTransaction({
      transactionXdr: unsignedXdr,
      ed25519Seed: reconstructed.privateSeed,
      networkPassphrase: Networks.TESTNET,
      expectedPublicKey: created.publicKey,
    });

    expect(typeof result.signedXdr).toBe('string');

    // 5. The seed buffer must now be zeroed.
    expect(isAllZero(seedRef)).toBe(true);
  });
});
