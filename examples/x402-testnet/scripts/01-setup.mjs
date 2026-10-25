/**
 * Paso 1 — cuentas de testnet.
 *
 *   funder       paga deploys y compra USDC de prueba en el DEX de testnet
 *   facilitator  facilitador x402: patrocina fees y liquida pagos
 *   merchant     cuenta que cobra el agente (payTo)
 *   outsider     destinatario fuera de la allowlist (para el rechazo)
 *
 * Idempotente: si ya existen en `.secrets/accounts.json`, solo completa lo
 * que falte (trustlines, saldo USDC).
 */

import { Asset, Horizon, Keypair, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { cfg, loadJson, saveJson, state } from '../lib/config.mjs';
import { friendbot } from '../lib/stellar.mjs';

const horizon = new Horizon.Server(cfg.horizonUrl);
const USDC = new Asset(cfg.usdcCode, cfg.usdcIssuer);
const ROLES = ['funder', 'facilitator', 'merchant', 'outsider'];
const USDC_TO_BUY = process.env.USDC_TO_BUY ?? '20';

const accounts = loadJson('.secrets', 'accounts', {});
for (const role of ROLES) {
  if (!accounts[role]) {
    const kp = Keypair.random();
    accounts[role] = { publicKey: kp.publicKey(), secret: kp.secret() };
  }
}
saveJson('.secrets', 'accounts', accounts);

async function exists(pub) {
  try {
    return await horizon.loadAccount(pub);
  } catch {
    return null;
  }
}

async function send(kp, ops) {
  const acc = await horizon.loadAccount(kp.publicKey());
  const b = new TransactionBuilder(acc, { fee: '10000', networkPassphrase: cfg.passphrase }).setTimeout(120);
  ops.forEach((op) => b.addOperation(op));
  const tx = b.build();
  tx.sign(kp);
  const res = await horizon.submitTransaction(tx);
  return res.hash;
}

for (const role of ROLES) {
  const { publicKey, secret } = accounts[role];
  if (!(await exists(publicKey))) {
    await friendbot(publicKey);
    console.log(`funded ${role} ${publicKey}`);
  }
  if (role !== 'facilitator') {
    const acc = await horizon.loadAccount(publicKey);
    const hasTrust = acc.balances.some((b) => b.asset_code === cfg.usdcCode && b.asset_issuer === cfg.usdcIssuer);
    if (!hasTrust) {
      const hash = await send(Keypair.fromSecret(secret), [Operation.changeTrust({ asset: USDC })]);
      state.logTx({ kind: 'setup', label: `USDC trustline (${role})`, hash, status: 'SUCCESS' });
      console.log(`trustline ${role}: ${hash}`);
    }
  }
}

// Compra USDC de prueba con XLM de friendbot (path payment en el DEX de testnet).
const funder = Keypair.fromSecret(accounts.funder.secret);
const funderAcc = await horizon.loadAccount(funder.publicKey());
const usdcBal = Number(funderAcc.balances.find((b) => b.asset_code === cfg.usdcCode)?.balance ?? 0);
if (usdcBal < Number(USDC_TO_BUY)) {
  const hash = await send(funder, [
    Operation.pathPaymentStrictReceive({
      sendAsset: Asset.native(),
      sendMax: '1000',
      destination: funder.publicKey(),
      destAsset: USDC,
      destAmount: USDC_TO_BUY,
      path: [],
    }),
  ]);
  state.logTx({ kind: 'setup', label: `buy ${USDC_TO_BUY} test USDC on testnet DEX`, hash, status: 'SUCCESS' });
  console.log(`bought ${USDC_TO_BUY} USDC: ${hash}`);
}

state.merge({
  accounts: Object.fromEntries(ROLES.map((r) => [r, accounts[r].publicKey])),
});
console.log('accounts:', Object.fromEntries(ROLES.map((r) => [r, accounts[r].publicKey])));
