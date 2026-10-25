/**
 * Paso 2 — wallet del cliente (Smart Account v3 de Accesly).
 *
 * 1. El cliente genera la llave, la parte 2-de-3 con Shamir y cifra cada
 *    fragmento (`createWallet` de @accesly/core). La llave nunca sale entera.
 * 2. Se despliega el Smart Account v3 y se hace `bootstrap` con la pubkey del
 *    owner. Reglas: 0 biometric-tx (USDC), 1 admin-cfg, 2 sep10-auth.
 * 3. OTP por email → F2 cifrado a la bóveda. F1 y la llave de F2 quedan en el
 *    device; F3 queda cifrado con la llave de recuperación (password).
 * 4. El funder le manda USDC de prueba al Smart Account.
 *
 *   DEMO_EMAIL      email del cliente (OTP)
 *   DEMO_PASSWORD   password de recuperación (cifra F3)
 */

import { randomBytes } from 'node:crypto';
import { p256 } from '@noble/curves/p256';
import { Address, Keypair, Operation, StrKey, TransactionBuilder, rpc } from '@stellar/stellar-sdk';
import { createWallet } from '@accesly/core/mpc';
import { deriveRecoveryKeyFromPasswordString, generateRecoverySalt } from '@accesly/core/crypto';
import { cfg, loadJson, saveJson, state, usd } from '../lib/config.mjs';
import {
  assembleAndSign,
  invoke,
  restoreCodeIfArchived,
  scv,
  server,
  submit,
} from '../lib/stellar.mjs';
import { b64, envelopeToWire, otpLogin, storeF2 } from '../lib/wallet.mjs';

const email = process.env.DEMO_EMAIL ?? 'customer@demo.accesly.xyz';
const password = process.env.DEMO_PASSWORD ?? 'demo-recovery-password-testnet';
const FUND_USDC = Number(process.env.FUND_USDC ?? '5');

const accounts = loadJson('.secrets', 'accounts');
const funder = Keypair.fromSecret(accounts.funder.secret);

async function sorobanOp(op) {
  const acc = await server.getAccount(funder.publicKey());
  const tx = new TransactionBuilder(acc, { fee: '1000000', networkPassphrase: cfg.passphrase })
    .addOperation(op)
    .setTimeout(300)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`simulation failed: ${sim.error}`);
  return submit(assembleAndSign(tx, sim, funder));
}

// 1. Llave + fragmentos, client-side.
const f1Key = randomBytes(32);
const f2Key = randomBytes(32); // en el SDK web: PRF del passkey
const recoverySalt = generateRecoverySalt();
const f3Key = deriveRecoveryKeyFromPasswordString(password, recoverySalt);
const emailSalt = randomBytes(32);
const wallet = createWallet({
  emailBytes: new TextEncoder().encode(email.toLowerCase()),
  emailSalt,
  encryptionKeys: [f1Key, f2Key, f3Key],
});
const [F1, F2, F3] = wallet.encryptedFragments;

// Stand-in del passkey (sep10-auth): P-256 uncompressed, 65 bytes.
const secpPubkey = p256.getPublicKey(p256.utils.randomPrivateKey(), false);

// 2. Deploy + bootstrap del Smart Account v3.
// Mismo WASM que corre en mainnet (smart-account-v3.2.0). Si en testnet está
// archivado, se restaura primero (fee-bump: la renta pasa del tope uint32).
const wasmHash = cfg.smartAccountWasmHash;
const restored = await restoreCodeIfArchived(funder, wasmHash);
if (restored) {
  state.logTx({
    kind: 'deploy',
    label: 'restore archived smart-account-v3.2.0 WASM',
    hash: restored.hash,
    status: restored.status,
  });
}

// Reanudable: si un deploy anterior quedó sin bootstrap, se reusa.
let smartAccount = state.get().pendingSmartAccount;
if (!smartAccount) {
  const deployed = await sorobanOp(
    Operation.createCustomContract({
      address: Address.fromString(funder.publicKey()),
      wasmHash: Buffer.from(wasmHash, 'hex'),
      salt: randomBytes(32),
      constructorArgs: [scv.address(funder.publicKey())],
    }),
  );
  smartAccount = StrKey.encodeContract(Address.fromScVal(deployed.raw.returnValue).toBuffer());
  state.logTx({
    kind: 'deploy',
    label: 'deploy customer Smart Account v3',
    hash: deployed.hash,
    status: deployed.status,
  });
  state.merge({ pendingSmartAccount: smartAccount });
  console.log(`smart account ${smartAccount} (${deployed.hash})`);
}

const boot = await invoke({
  source: funder,
  contractId: smartAccount,
  method: 'bootstrap',
  args: [
    scv.bytes(wallet.publicKey),
    scv.bytes(wallet.emailCommitment),
    scv.bytes(secpPubkey),
    scv.address(cfg.ed25519Verifier),
    scv.address(cfg.secp256r1Verifier),
    scv.address(cfg.spendingLimitPolicy),
    // biometric-tx: hasta 2 USDC por día firmando con la llave maestra.
    scv.struct({ spending_limit: scv.i128(usd(2)), period_ledgers: scv.u32(17280) }),
    scv.vec([scv.address(cfg.usdc)]),
  ],
});
state.logTx({
  kind: 'deploy',
  label: 'bootstrap Smart Account (owner = MPC 2-of-3 key)',
  hash: boot.hash,
  status: boot.status,
});
console.log(`bootstrap ${boot.status} (${boot.hash})`);

// 3. OTP → F2 a la bóveda; F1 + llaves al device; F3 a recuperación.
const token = await otpLogin(email);
await storeF2(token, smartAccount, F2);
saveJson('.secrets', 'device', {
  email,
  smartAccount,
  ownerPubkey: b64(wallet.publicKey),
  f1: envelopeToWire(F1),
  f1Key: b64(f1Key),
  f2Key: b64(f2Key),
});
saveJson('.secrets', 'recovery', { f3: envelopeToWire(F3), recoverySalt: b64(recoverySalt) });
f1Key.fill(0);
f2Key.fill(0);
f3Key.fill(0);
console.log('F2 stored in vault after OTP; F1 on device; F3 sealed with recovery key');

// 4. USDC de prueba al Smart Account.
const fund = await invoke({
  source: funder,
  contractId: cfg.usdc,
  method: 'transfer',
  args: [scv.address(funder.publicKey()), scv.address(smartAccount), scv.i128(usd(FUND_USDC))],
});
state.logTx({
  kind: 'setup',
  label: `fund Smart Account with ${FUND_USDC} test USDC`,
  hash: fund.hash,
  status: fund.status,
});
console.log(`funded ${FUND_USDC} USDC (${fund.hash})`);

state.merge({
  smartAccount,
  ownerPubkey: Buffer.from(wallet.publicKey).toString('hex'),
  emailCommitment: Buffer.from(wallet.emailCommitment).toString('hex'),
  pendingSmartAccount: undefined,
  rules: { biometricTx: 0, adminCfg: 1, sep10Auth: 2 },
});
