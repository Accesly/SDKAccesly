/**
 * Servicio de testnet: bóveda F2 + facilitador x402 + agente de referencia.
 *
 * Variables:
 *   PORT                 (4021)
 *   DATA_DIR             (./.state/server)
 *   VAULT_SECRET         HMAC de tokens OTP (≥ 32 chars)
 *   FACILITATOR_SECRET   S... de la cuenta facilitadora (solo XLM)
 *   MERCHANT_PUBLIC      G... que cobra el agente de referencia
 *   GMAIL_USER, GMAIL_APP_PASSWORD  envío del OTP por Gmail (SMTP)
 *   RESEND_API_KEY       envío del OTP por Resend (si no hay Gmail)
 *   OTP_FROM             remitente (p. ej. "Accesly <no-reply@accesly.xyz>")
 *   DEV_OTP_ECHO=1       devuelve el OTP en la respuesta (prohibido con NODE_ENV=production)
 *   FACILITATOR_MAX_FEE_STROOPS  techo de fee por liquidación (200000000 = 20 XLM)
 */

import { mkdirSync } from 'node:fs';
import express from 'express';
import { paymentMiddleware } from '@x402/express';
import { createAcceslyResourceServer, priceEndpoint } from '@accesly/core/payments';
import { vaultRouter } from './vault.mjs';
import { facilitatorRouter } from './facilitator.mjs';

const env = process.env;
const PORT = Number(env.PORT ?? 4021);
const DATA_DIR = env.DATA_DIR ?? new URL('../.state/server', import.meta.url).pathname;
const NETWORK = 'stellar:testnet';
const RPC_URL = env.RPC_URL ?? 'https://soroban-testnet.stellar.org';
const devEcho = env.DEV_OTP_ECHO === '1';
if (devEcho && env.NODE_ENV === 'production') throw new Error('DEV_OTP_ECHO is not allowed in production');
mkdirSync(DATA_DIR, { recursive: true });

const app = express();
app.disable('x-powered-by');
app.get('/health', (_req, res) => res.json({ ok: true, network: NETWORK }));

app.use(
  '/vault',
  vaultRouter({
    dataDir: DATA_DIR,
    secret: env.VAULT_SECRET,
    resendApiKey: env.RESEND_API_KEY,
    otpFrom: env.OTP_FROM ?? 'Accesly <no-reply@accesly.xyz>',
    gmail: { user: env.GMAIL_USER, appPassword: env.GMAIL_APP_PASSWORD },
    devEcho,
  }),
);

const facilitator = facilitatorRouter({
  dataDir: DATA_DIR,
  secret: env.FACILITATOR_SECRET,
  network: NETWORK,
  rpcUrl: RPC_URL,
  maxFeeStroops: Number(env.FACILITATOR_MAX_FEE_STROOPS ?? 200_000_000),
});
app.use('/facilitator', facilitator.router);

// Agente de referencia: un endpoint con precio por llamada. El agente real de
// Opportuni vive en su repo y usa el mismo priceEndpoint con @x402/next.
if (env.MERCHANT_PUBLIC) {
  const resourceServer = await createAcceslyResourceServer({
    // El facilitador vive en este mismo proceso: no hace falta salir a internet.
    facilitatorUrl: `http://127.0.0.1:${PORT}/facilitator`,
    networks: [NETWORK],
  });
  app.use(
    paymentMiddleware(
      {
        'GET /demo/agent': priceEndpoint({
          price: '$0.01',
          payTo: env.MERCHANT_PUBLIC,
          network: NETWORK,
          description: 'Reference agent query, $0.01 USDC per call',
        }),
      },
      resourceServer,
    ),
  );
  app.get('/demo/agent', (req, res) => {
    res.json({ answer: `Paid query received: ${String(req.query.q ?? '')}`, at: new Date().toISOString() });
  });
}

app.listen(PORT, () => {
  console.log(`x402 testnet service on :${PORT} (facilitator ${facilitator.address}${devEcho ? ', DEV_OTP_ECHO' : ''})`);
});
