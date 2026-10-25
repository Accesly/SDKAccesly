import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha2';
import { Address, Keypair, StrKey, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import {
  AcceslyExactStellarScheme,
  X402PaymentError,
  X402PolicyRejectedError,
  authorizeSmartAccountEntry,
  parseContractErrorCode,
  priceEndpoint,
  sessionKeyX402Signer,
  type AcceslyX402Signer,
} from '../../../src/payments/index.js';

const PASSPHRASE = 'Test SDF Network ; September 2015';
const USDC = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const VERIFIER = 'CALVIIGIOMODZMWTMKZLSD4PZFFEPWQBSYERHUFM6MH5FLWKCHW4E4G5';
const SMART_ACCOUNT = StrKey.encodeContract(Buffer.alloc(32, 7));
const PAY_TO = Keypair.random().publicKey();

function isAllZero(buf: Uint8Array): boolean {
  return buf.every((b) => b === 0);
}

function placeholderEntry(nonce: bigint): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(SMART_ACCOUNT).toScAddress(),
        nonce: xdr.Int64.fromString(nonce.toString()),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: Address.fromString(USDC).toScAddress(),
          functionName: 'transfer',
          args: [
            nativeToScVal(SMART_ACCOUNT, { type: 'address' }),
            nativeToScVal(PAY_TO, { type: 'address' }),
            nativeToScVal(100000n, { type: 'i128' }),
          ],
        }),
      ),
      subInvocations: [],
    }),
  });
}

function makeSigner(seed: Uint8Array, ruleId = 4): AcceslyX402Signer & { lastSeed?: Uint8Array } {
  const signer: AcceslyX402Signer & { lastSeed?: Uint8Array } = {
    smartAccount: SMART_ACCOUNT,
    signerPubkey: ed25519.getPublicKey(seed),
    ed25519VerifierAddress: VERIFIER,
    contextRuleIds: [ruleId],
    loadSeed: async () => {
      signer.lastSeed = seed.slice();
      return signer.lastSeed;
    },
  };
  return signer;
}

describe('payments/x402: authorizeSmartAccountEntry', () => {
  it('builds the Smart Account AuthPayload with a valid ed25519 signature', async () => {
    const seed = ed25519.utils.randomPrivateKey();
    const signer = makeSigner(seed, 4);
    const entry = placeholderEntry(42n);

    const signed = await authorizeSmartAccountEntry(signer, entry, 1234, PASSPHRASE);
    const creds = signed.credentials().address();
    expect(creds.signatureExpirationLedger()).toBe(1234);

    // AuthPayload { context_rule_ids, signers } en orden alfabético de campos.
    const payload = creds.signature().map()!;
    expect(payload.map((e) => e.key().sym().toString())).toEqual(['context_rule_ids', 'signers']);
    const ruleIds = payload[0]!.val();
    expect(ruleIds.vec()!.map((v) => v.u32())).toEqual([4]);

    const signerEntry = payload[1]!.val().map()![0]!;
    const signerKey = signerEntry.key().vec()!;
    expect(signerKey[0]!.sym().toString()).toBe('External');
    expect(Address.fromScVal(signerKey[1]!).toString()).toBe(VERIFIER);
    expect(Buffer.from(signerKey[2]!.bytes())).toEqual(Buffer.from(signer.signerPubkey));

    // Recalcula el digest que verifica el contrato y comprueba la firma.
    const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
      new xdr.HashIdPreimageSorobanAuthorization({
        networkId: Buffer.from(sha256(new TextEncoder().encode(PASSPHRASE))),
        nonce: xdr.Int64.fromString('42'),
        signatureExpirationLedger: 1234,
        invocation: entry.rootInvocation(),
      }),
    );
    const signaturePayload = sha256(new Uint8Array(preimage.toXDR()));
    const digest = sha256(new Uint8Array([...signaturePayload, ...ruleIds.toXDR()]));
    const sig = new Uint8Array(signerEntry.val().bytes());
    expect(ed25519.verify(sig, digest, signer.signerPubkey)).toBe(true);
  });

  it('zeroizes the seed returned by loadSeed after signing', async () => {
    const signer = makeSigner(ed25519.utils.randomPrivateKey());
    await authorizeSmartAccountEntry(signer, placeholderEntry(1n), 10, PASSPHRASE);
    expect(signer.lastSeed).toBeDefined();
    expect(isAllZero(signer.lastSeed!)).toBe(true);
  });

  it('does not touch the original entry', async () => {
    const entry = placeholderEntry(5n);
    const before = entry.toXDR('base64');
    await authorizeSmartAccountEntry(
      makeSigner(ed25519.utils.randomPrivateKey()),
      entry,
      99,
      PASSPHRASE,
    );
    expect(entry.toXDR('base64')).toBe(before);
  });
});

describe('payments/x402: sessionKeyX402Signer', () => {
  it('hands out a copy of the session seed so it survives zeroization', async () => {
    const seed = ed25519.utils.randomPrivateKey();
    const original = seed.slice();
    const signer = sessionKeyX402Signer({
      smartAccount: SMART_ACCOUNT,
      sessionPubkey: ed25519.getPublicKey(seed),
      sessionSeed: seed,
      ed25519VerifierAddress: VERIFIER,
      contextRuleId: 4,
    });
    await authorizeSmartAccountEntry(signer, placeholderEntry(3n), 10, PASSPHRASE);
    expect(Buffer.from(seed)).toEqual(Buffer.from(original));
  });
});

describe('payments/x402: AcceslyExactStellarScheme validation', () => {
  const base = {
    scheme: 'exact',
    network: 'stellar:testnet',
    asset: USDC,
    payTo: PAY_TO,
    amount: '100000',
    maxTimeoutSeconds: 60,
    extra: { areFeesSponsored: true },
  } as const;
  const scheme = (opts = {}) =>
    new AcceslyExactStellarScheme(makeSigner(ed25519.utils.randomPrivateKey()), opts);

  it('rejects other schemes and networks before touching the network', async () => {
    await expect(scheme().createPaymentPayload(2, { ...base, scheme: 'upto' })).rejects.toThrow(
      X402PaymentError,
    );
    await expect(
      scheme().createPaymentPayload(2, { ...base, network: 'eip155:8453' }),
    ).rejects.toThrow(/unsupported network/);
  });

  it('rejects non-positive or non-integer amounts', async () => {
    await expect(scheme().createPaymentPayload(2, { ...base, amount: '0' })).rejects.toThrow(
      /invalid amount/,
    );
    await expect(scheme().createPaymentPayload(2, { ...base, amount: '1.5' })).rejects.toThrow(
      /invalid amount/,
    );
  });

  it('enforces the client-side cap', async () => {
    await expect(
      scheme({ maxAmountPerPayment: 50000n }).createPaymentPayload(2, base),
    ).rejects.toThrow(/exceeds client cap/);
  });

  it('requires an rpcUrl on pubnet', async () => {
    await expect(
      scheme().createPaymentPayload(2, { ...base, network: 'stellar:pubnet' }),
    ).rejects.toThrow(/rpcUrl is required/);
  });
});

describe('payments/x402: policy errors', () => {
  it('parses the x402 policy code from a simulation error', () => {
    const msg =
      'HostError: Error(Auth, InvalidAction)\nEvent log: ... Error(Contract, #10007) ... Error(Contract, #3)';
    expect(parseContractErrorCode(msg)).toBe(10007);
    expect(parseContractErrorCode('Error(Contract, #3)')).toBe(3);
    expect(parseContractErrorCode('no code here')).toBeUndefined();
  });

  it('names the rejected rule', () => {
    const err = new X402PolicyRejectedError(10009, 'detail');
    expect(err.reason).toBe('MonthlyCapExceeded');
    expect(err).toBeInstanceOf(X402PaymentError);
  });
});

describe('payments/server: priceEndpoint', () => {
  it('builds an exact route config priced per call', () => {
    const route = priceEndpoint({ price: '$0.01', payTo: PAY_TO, network: 'stellar:testnet' });
    expect(route.accepts).toEqual({
      scheme: 'exact',
      price: '$0.01',
      payTo: PAY_TO,
      network: 'stellar:testnet',
      maxTimeoutSeconds: 60,
    });
    expect(route).not.toHaveProperty('description');
  });
});
