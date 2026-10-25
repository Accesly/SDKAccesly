/**
 * Paso 3 — session key autorizada por email/OTP, con topes on-chain.
 *
 * 1. OTP al email → la bóveda libera F2 → F1 + F2 reconstruyen la llave del
 *    owner (2-de-3) solo para esta firma, y se zero-iza.
 * 2. El owner firma (regla 1, admin-cfg) un `add_context_rule` que instala:
 *      tipo      CallContract(USDC)
 *      signer    Signer::External(ed25519_verifier, session_pubkey)
 *      política  x402-spending-policy { tope por pago, tope mensual, allowlist }
 *      vigencia  valid_until = hoy + SESSION_DAYS
 * 3. La session key queda en el device. Desde aquí el agente cobra sin volver
 *    a tocar la llave maestra, y la política acota cuánto y a quién.
 *
 *   MAX_PER_REQUEST_USD (0.05)   MONTHLY_CAP_USD (5)   SESSION_DAYS (30)
 *   RULE_SIGNER=owner  instala la misma política para la llave maestra (regla
 *                      `x402-owner`): pagos x402 firmados 2-de-3 bajo topes.
 *                      La regla 0 (biometric-tx) no sirve para x402: su
 *                      spending-limit de OZ emite un evento y la spec "exact"
 *                      rechaza simulaciones con eventos que no son `transfer`.
 */

import { randomBytes } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519';
import { Keypair } from '@stellar/stellar-sdk';
import { mpcX402Signer } from '@accesly/core/payments';
import { cfg, loadJson, saveJson, state, usd } from '../lib/config.mjs';
import { invoke, scv, server } from '../lib/stellar.mjs';
import { b64, otpLogin, reconstructOwnerSeed, unb64 } from '../lib/wallet.mjs';

const MAX_PER_REQUEST = usd(Number(process.env.MAX_PER_REQUEST_USD ?? '0.05'));
const MONTHLY_CAP = usd(Number(process.env.MONTHLY_CAP_USD ?? '5'));
const SESSION_DAYS = Number(process.env.SESSION_DAYS ?? '30');
const LEDGERS_PER_DAY = 17280;
const MONTH_IN_LEDGERS = 518400;

const accounts = loadJson('.secrets', 'accounts');
const device = loadJson('.secrets', 'device');
const s = state.get();
const funder = Keypair.fromSecret(accounts.funder.secret);

// 1. OTP → la bóveda libera F2 para esta sesión.
const token = await otpLogin(device.email);
const owner = mpcX402Signer({
  smartAccount: device.smartAccount,
  ownerPubkey: unb64(device.ownerPubkey),
  ed25519VerifierAddress: cfg.ed25519Verifier,
  contextRuleId: s.rules.adminCfg,
  reconstructSeed: () => reconstructOwnerSeed(token),
});

const forOwner = process.env.RULE_SIGNER === 'owner';

// 2. Session key nueva (vive solo en el device), o la pubkey del owner.
const sessionSeed = new Uint8Array(randomBytes(32));
const sessionPubkey = forOwner ? unb64(device.ownerPubkey) : ed25519.getPublicKey(sessionSeed);
const latest = await server.getLatestLedger();
const validUntil = latest.sequence + SESSION_DAYS * LEDGERS_PER_DAY;

const policyParams = scv.struct({
  token: scv.address(cfg.usdc),
  max_per_request: scv.i128(MAX_PER_REQUEST),
  monthly_cap: scv.i128(MONTHLY_CAP),
  period_ledgers: scv.u32(MONTH_IN_LEDGERS),
  allowlist: scv.vec([scv.address(accounts.merchant.publicKey)]),
});

const res = await invoke({
  source: funder,
  contractId: device.smartAccount,
  method: 'add_context_rule',
  args: [
    scv.variant('CallContract', scv.address(cfg.usdc)),
    scv.string(forOwner ? 'x402-owner' : 'x402-session'),
    scv.u32(validUntil),
    scv.vec([scv.ed25519Signer(cfg.ed25519Verifier, sessionPubkey)]),
    scv.addressMap([[cfg.x402Policy, policyParams]]),
  ],
  saSigner: owner,
});
const ruleId = res.returnValue?.id;
const who = forOwner ? 'owner key (MPC 2-of-3)' : 'session key';
state.logTx({
  kind: 'policy',
  label: `install x402 rule ${ruleId} for ${who}: cap $${Number(MAX_PER_REQUEST) / 1e7}/payment, $${Number(MONTHLY_CAP) / 1e7}/month, allowlist = merchant; signed by the owner under MPC 2-of-3 after email OTP`,
  hash: res.hash,
  status: res.status,
});
console.log(`${who} rule ${ruleId} ${res.status} (${res.hash})`);

const ruleInfo = {
  ruleId,
  pubkey: Buffer.from(sessionPubkey).toString('hex'),
  validUntil,
  maxPerRequest: MAX_PER_REQUEST.toString(),
  monthlyCap: MONTHLY_CAP.toString(),
  allowlist: [accounts.merchant.publicKey],
};
if (forOwner) {
  state.merge({ ownerX402: ruleInfo, rules: { ...s.rules, x402Owner: ruleId } });
} else {
  saveJson('.secrets', 'session', {
    seed: b64(sessionSeed),
    pubkey: b64(sessionPubkey),
    ruleId,
    validUntil,
  });
  state.merge({ session: ruleInfo });
}
sessionSeed.fill(0);
