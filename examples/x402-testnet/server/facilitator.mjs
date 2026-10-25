/**
 * Facilitador x402 propio (spec "exact" de Stellar), con `@x402/stellar`.
 *
 *   GET  /facilitator/supported
 *   POST /facilitator/verify   { paymentPayload, paymentRequirements }
 *   POST /facilitator/settle   { paymentPayload, paymentRequirements }
 *
 * Verifica que el payload sea un único `transfer` del asset pedido, al payTo
 * pedido y por el monto pedido; simula (ahí corre `__check_auth` del Smart
 * Account y la política on-chain), re-arma la tx con su propia cuenta como
 * source, paga el fee y la manda. Cada liquidación queda en settlements.jsonl.
 */

import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import { x402Facilitator } from '@x402/core/facilitator';
import { createEd25519Signer } from '@x402/stellar';
import { ExactStellarScheme } from '@x402/stellar/exact/facilitator';

export function facilitatorRouter({ dataDir, secret, network, rpcUrl, maxFeeStroops }) {
  const signer = createEd25519Signer(secret, network);
  const facilitator = new x402Facilitator().register(
    network,
    new ExactStellarScheme([signer], {
      rpcConfig: { url: rpcUrl },
      // El primer pago por regla crea el storage de la política y puede
      // restaurar entradas archivadas: en testnet costó de 2.6 a 6 XLM. Los
      // siguientes cuestan ~0.002 XLM. El techo default (0.5 XLM) no alcanza.
      maxTransactionFeeStroops: maxFeeStroops,
    }),
  );
  const log = (rec) => appendFileSync(join(dataDir, 'settlements.jsonl'), JSON.stringify(rec) + '\n');

  const r = express.Router();
  r.use(express.json({ limit: '256kb' }));

  r.get('/supported', (_req, res) => res.json(facilitator.getSupported()));

  r.post('/verify', async (req, res) => {
    try {
      res.json(await facilitator.verify(req.body.paymentPayload, req.body.paymentRequirements));
    } catch (err) {
      res.status(500).json({ isValid: false, invalidReason: 'unexpected_verify_error', invalidMessage: String(err.message) });
    }
  });

  r.post('/settle', async (req, res) => {
    const { paymentPayload, paymentRequirements } = req.body;
    try {
      const out = await facilitator.settle(paymentPayload, paymentRequirements);
      log({
        at: new Date().toISOString(),
        success: out.success,
        transaction: out.transaction,
        payer: out.payer,
        payTo: paymentRequirements.payTo,
        amount: paymentRequirements.amount,
        asset: paymentRequirements.asset,
        resource: paymentPayload.resource?.url,
        errorReason: out.errorReason,
      });
      res.json(out);
    } catch (err) {
      log({ at: new Date().toISOString(), success: false, errorReason: String(err.message) });
      res.status(500).json({ success: false, errorReason: 'unexpected_settle_error', errorMessage: String(err.message) });
    }
  });

  return { router: r, address: signer.address };
}
