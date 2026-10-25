/**
 * Paso 4 — el cliente paga al agente por uso con x402.
 *
 * Cada llamada al endpoint del agente responde 402; `createAcceslyX402Fetch`
 * firma la auth entry del Smart Account y reintenta; el facilitador liquida
 * el `transfer` de USDC on-chain y el agente responde. Cada pago queda con su
 * tx hash en `.state/state.json`.
 *
 *   AGENT_URL   endpoint con precio (default: agente de referencia /demo/agent)
 *   COUNT       número de pagos (default 3)
 *   SIGNER      session (default) | mpc
 *               session → session key acotada por x402-spending-policy (regla 3)
 *               mpc     → llave maestra 2-de-3 reconstruida tras OTP (regla x402-owner)
 */

import { decodePaymentResponseHeader } from '@x402/core/http';
import {
  createAcceslyX402Fetch,
  mpcX402Signer,
  sessionKeyX402Signer,
} from '@accesly/core/payments';
import { cfg, loadJson, state, usd } from '../lib/config.mjs';
import { otpLogin, reconstructOwnerSeed, unb64 } from '../lib/wallet.mjs';

const AGENT_URL = process.env.AGENT_URL ?? `${cfg.serviceUrl}/demo/agent`;
const COUNT = Number(process.env.COUNT ?? '3');
const SIGNER = process.env.SIGNER ?? 'session';
const QUERIES = (
  process.env.QUERIES ??
  'vacantes de analista de datos en CDMX|practicas de marketing remotas|desarrollador junior en Bogota'
).split('|');

const device = loadJson('.secrets', 'device');
const s = state.get();

let signer;
if (SIGNER === 'mpc') {
  const token = await otpLogin(device.email);
  signer = mpcX402Signer({
    smartAccount: device.smartAccount,
    ownerPubkey: unb64(device.ownerPubkey),
    ed25519VerifierAddress: cfg.ed25519Verifier,
    contextRuleId: s.rules.x402Owner,
    reconstructSeed: () => reconstructOwnerSeed(token),
  });
} else {
  const session = loadJson('.secrets', 'session');
  signer = sessionKeyX402Signer({
    smartAccount: device.smartAccount,
    sessionPubkey: unb64(session.pubkey),
    sessionSeed: unb64(session.seed),
    ed25519VerifierAddress: cfg.ed25519Verifier,
    contextRuleId: session.ruleId,
  });
}

const paidFetch = await createAcceslyX402Fetch(signer, { maxAmountPerPayment: usd(0.05) });

let ok = 0;
for (let i = 0; i < COUNT; i += 1) {
  const q = QUERIES[i % QUERIES.length];
  const url = new URL(AGENT_URL);
  url.searchParams.set('q', q);
  const started = Date.now();
  try {
    const res = await paidFetch(url, { headers: { Accept: 'application/json' } });
    const header = res.headers.get('PAYMENT-RESPONSE') ?? res.headers.get('X-PAYMENT-RESPONSE');
    const settle = header ? decodePaymentResponseHeader(header) : null;
    const body = await res.json().catch(() => ({}));
    if (res.ok && settle?.success) {
      ok += 1;
      state.logTx({
        kind: 'payment',
        label: `x402 payment #${i + 1} ($0.01 USDC, signer=${SIGNER}) for "${q}"`,
        hash: settle.transaction,
        status: 'SUCCESS',
        payer: settle.payer,
        resource: url.pathname,
        ms: Date.now() - started,
      });
      console.log(
        `#${i + 1} paid ${settle.transaction} (${Date.now() - started} ms) → ${JSON.stringify(body).slice(0, 80)}`,
      );
    } else {
      console.log(`#${i + 1} not paid: HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
    }
  } catch (err) {
    console.log(`#${i + 1} error: ${err.message}`);
  }
}
console.log(`${ok}/${COUNT} payments settled`);
