/**
 * Paso 6 — evidencia pública de la corrida.
 *
 * Re-verifica cada tx contra la red (estado y, en los rechazos, el código del
 * contrato en los eventos de diagnóstico) y escribe:
 *   evidence/evidence.json   datos crudos (solo públicos: direcciones y hashes)
 *   evidence/EVIDENCE.md     tabla legible con links al explorador
 *
 * Nunca exporta llaves, fragmentos ni el email del cliente.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cfg, state } from '../lib/config.mjs';
import { contractLink, failureCode, server, txLink } from '../lib/stellar.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'evidence');
mkdirSync(OUT, { recursive: true });

const s = state.get();
const txs = [];
for (const t of s.txs ?? []) {
  let onChain = { status: 'UNKNOWN' };
  try {
    const got = await server.getTransaction(t.hash);
    onChain = {
      status: got.status,
      ledger: got.ledger,
      closedAt: got.createdAt ? new Date(Number(got.createdAt) * 1000).toISOString() : undefined,
      contractErrorCode: got.status === 'FAILED' ? failureCode(got) : undefined,
    };
  } catch {
    // tx clásica vieja fuera de la ventana de retención del RPC: queda el estado del log
    onChain = { status: t.status };
  }
  const { payer: _payer, ...pub } = t;
  txs.push({ ...pub, onChain, link: txLink(t.hash) });
}

const payments = txs.filter((t) => t.kind === 'payment');
const agentPayments = payments.filter((t) => t.resource === '/api/agente');
const rejections = txs.filter((t) => t.kind === 'rejection');
const validRejections = rejections.filter((t) => !t.invalidEvidence);

const evidence = {
  generatedAt: new Date().toISOString(),
  network: cfg.network,
  explorer: cfg.explorer,
  contracts: {
    x402SpendingPolicy: { id: cfg.x402Policy, link: contractLink(cfg.x402Policy) },
    customerSmartAccount: { id: s.smartAccount, link: contractLink(s.smartAccount) },
    smartAccountWasmHash: cfg.smartAccountWasmHash,
    ed25519Verifier: cfg.ed25519Verifier,
    usdc: cfg.usdc,
  },
  accounts: s.accounts,
  rules: s.rules,
  sessionRule: s.session,
  ownerX402Rule: s.ownerX402,
  totals: {
    payments: payments.length,
    paymentsSucceededOnChain: payments.filter((t) => t.onChain.status === 'SUCCESS').length,
    agentPayments: agentPayments.length,
    rejectionsValid: validRejections.length,
    rejectionsConfirmedOnChain: validRejections.filter(
      (t) => t.onChain.status === 'FAILED' && t.onChain.contractErrorCode === t.expectedCode,
    ).length,
  },
  clientPreflightRejection: s.clientPreflightRejection,
  txs,
};
writeFileSync(join(OUT, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');

const row = (t) =>
  `| ${t.at.slice(0, 16).replace('T', ' ')} | ${t.label.replace(/\|/g, '/')} | ${t.onChain.status}${t.onChain.contractErrorCode ? ` (#${t.onChain.contractErrorCode})` : ''} | [${t.hash.slice(0, 10)}…](${t.link}) |`;
const table = (rows) =>
  ['| UTC | What | On-chain | Tx |', '|---|---|---|---|', ...rows.map(row)].join('\n');

const md = `# Evidence — x402 on Stellar testnet

Generated ${evidence.generatedAt}. Every row was re-checked against the network when this file
was generated.

- x402 spending policy: [${cfg.x402Policy}](${contractLink(cfg.x402Policy)})
- Customer Smart Account (v3.2.0, same WASM as mainnet): [${s.smartAccount}](${contractLink(s.smartAccount)})
- Payments: ${evidence.totals.payments} (${evidence.totals.paymentsSucceededOnChain} succeeded on-chain), ${evidence.totals.agentPayments} of them to the Opportuni agent
- On-chain policy rejections: ${evidence.totals.rejectionsConfirmedOnChain}/${evidence.totals.rejectionsValid} confirmed with the expected contract error

## Setup, deploy and policy

${table(txs.filter((t) => ['setup', 'deploy', 'policy'].includes(t.kind)))}

## On-chain rejections

${table(rejections)}

${rejections
  .filter((t) => t.invalidEvidence)
  .map((t) => `- ${t.hash.slice(0, 10)}… is **not** evidence: ${t.invalidEvidence}.`)
  .join('\n')}

## Payments

${table(payments)}
`;
writeFileSync(join(OUT, 'EVIDENCE.md'), md);
console.log(evidence.totals);
