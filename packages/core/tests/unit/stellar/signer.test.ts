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
import { signTransaction } from '../../../src/stellar/signer.js';
import { generateKeypair } from '../../../src/crypto/keypair.js';

const PASSPHRASE = Networks.TESTNET;

function buildUnsignedXdr(sourcePubKey: string): string {
  const sourceAccount = new Account(sourcePubKey, '0');
  return new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
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
}

function isAllZero(buf: Uint8Array): boolean {
  for (let i = 0; i < buf.length; i += 1) if (buf[i] !== 0) return false;
  return true;
}

describe('stellar/signer', () => {
  it('signs an unsigned XDR and the signature verifies', async () => {
    const { privateSeed, publicKey } = generateKeypair();
    // Keep a copy of the seed for verification — the signer zeroes the original.
    const seedCopy = new Uint8Array(privateSeed);
    const verifierKeypair = Keypair.fromRawEd25519Seed(Buffer.from(seedCopy));
    const derivedAddress = verifierKeypair.publicKey();
    const unsignedXdr = buildUnsignedXdr(derivedAddress);

    const result = await signTransaction({
      transactionXdr: unsignedXdr,
      ed25519Seed: privateSeed,
      networkPassphrase: PASSPHRASE,
    });

    expect(typeof result.signedXdr).toBe('string');
    expect(result.publicKey.length).toBe(32);

    // The result.publicKey must match the keypair derived from the original seed.
    expect(Buffer.from(result.publicKey).equals(Buffer.from(publicKey))).toBe(true);

    // Parse the signed XDR and verify it has a signature.
    const sdk = await import('@stellar/stellar-sdk');
    const signedTx = sdk.TransactionBuilder.fromXDR(
      result.signedXdr,
      PASSPHRASE,
    ) as sdk.Transaction;
    expect(signedTx.signatures.length).toBeGreaterThan(0);

    // ed25519 verify check via the SDK's Keypair
    const ok = verifierKeypair.verify(signedTx.hash(), signedTx.signatures[0]!.signature());
    expect(ok).toBe(true);
    // Make sure unused `publicKey` import is still referenced.
    expect(publicKey.length).toBe(32);
  });

  it('zeroizes the provided seed even on success', async () => {
    const { privateSeed, publicKey } = generateKeypair();
    const seedRef = privateSeed; // keep ref to assert after
    expect(isAllZero(seedRef)).toBe(false);

    const seedCopy = new Uint8Array(privateSeed);
    const derivedAddress = Keypair.fromRawEd25519Seed(Buffer.from(seedCopy)).publicKey();
    const unsignedXdr = buildUnsignedXdr(derivedAddress);

    await signTransaction({
      transactionXdr: unsignedXdr,
      ed25519Seed: privateSeed,
      networkPassphrase: PASSPHRASE,
    });

    expect(isAllZero(seedRef)).toBe(true);
    // Pubkey buffer is NOT zeroized — only secret material is.
    expect(isAllZero(publicKey)).toBe(false);
  });

  it('zeroizes the seed even when signing throws', async () => {
    const seed = new Uint8Array(32).fill(0x99);
    const seedRef = seed;

    await expect(
      signTransaction({
        transactionXdr: 'this is not valid XDR',
        ed25519Seed: seed,
        networkPassphrase: PASSPHRASE,
      }),
    ).rejects.toThrow();

    expect(isAllZero(seedRef)).toBe(true);
  });

  it('rejects seed of wrong length', async () => {
    await expect(
      signTransaction({
        transactionXdr: 'xxx',
        ed25519Seed: new Uint8Array(31),
        networkPassphrase: PASSPHRASE,
      }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  // Test "rejects when expectedPublicKey does not match" eliminado en
  // 1.14.x — el check defensivo fue removido en 1.13.5 (commit 6ac137a)
  // por falsos positivos contra CredentialRecords persistidos por versiones
  // viejas. El param sigue aceptándose como no-op por backwards compat de
  // la signature, pero ya no se valida (Stellar/Soroban validan la firma
  // on-chain — el check client-side era redundante).
});
