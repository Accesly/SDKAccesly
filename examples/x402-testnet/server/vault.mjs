/**
 * Bóveda de F2 con OTP por email (sustituto de testnet del stack de AWS).
 *
 * Guarda SOLO el sobre cifrado de F2: el cliente lo cifró con material de su
 * device antes de mandarlo, así que la bóveda no puede reconstruir nada (tiene
 * 1 de 3 fragmentos y cifrado). Lo libera únicamente a quien demuestre control
 * del email con un OTP de 6 dígitos.
 *
 *   POST /vault/otp/request   { email }               → manda el OTP
 *   POST /vault/otp/verify    { email, code }         → { token } (10 min)
 *   POST /vault/fragments     { smartAccount, f2 }    (Bearer token) guarda F2
 *   POST /vault/fragments/release                     (Bearer token) → { f2 }
 *
 * Envío del OTP: Gmail (SMTP con contraseña de aplicación) o Resend.
 * En AWS esto lo hacían Cognito + KMS + DynamoDB. Aquí: HMAC + archivo JSON.
 */

import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import nodemailer from 'nodemailer';

const OTP_TTL_MS = 10 * 60 * 1000;
const TOKEN_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export function vaultRouter({ dataDir, secret, resendApiKey, otpFrom, gmail, devEcho }) {
  if (!secret || secret.length < 32) throw new Error('VAULT_SECRET must be at least 32 chars');
  const storePath = join(dataDir, 'vault.json');
  const load = () => (existsSync(storePath) ? JSON.parse(readFileSync(storePath, 'utf8')) : {});
  const save = (s) => writeFileSync(storePath, JSON.stringify(s, null, 2), { mode: 0o600 });
  const otps = new Map();

  const emailId = (email) =>
    createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex');
  const hmac = (s) => createHmac('sha256', secret).update(s).digest('base64url');

  function issueToken(id) {
    const body = Buffer.from(JSON.stringify({ id, exp: Date.now() + TOKEN_TTL_MS })).toString(
      'base64url',
    );
    return `${body}.${hmac(body)}`;
  }

  function readToken(req) {
    const raw = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    const [body, sig] = raw.split('.');
    if (!body || !sig) return null;
    const expected = Buffer.from(hmac(body));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
    return claims.exp > Date.now() ? claims : null;
  }

  const smtp =
    gmail?.user && gmail?.appPassword
      ? nodemailer.createTransport({
          host: 'smtp.gmail.com',
          port: 587,
          requireTLS: true,
          auth: { user: gmail.user, pass: gmail.appPassword },
        })
      : null;
  const subject = (code) => `Your Accesly code: ${code}`;
  const text = (code) =>
    `Your Accesly verification code is ${code}. It expires in 10 minutes.\n\nIf you did not request it, ignore this email.`;

  async function sendOtp(email, code) {
    if (smtp) {
      // Gmail exige que el remitente sea la propia cuenta.
      await smtp.sendMail({
        from: `Accesly <${gmail.user}>`,
        to: email,
        subject: subject(code),
        text: text(code),
      });
      return;
    }
    if (resendApiKey) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: otpFrom,
          to: [email],
          subject: subject(code),
          text: text(code),
        }),
      });
      if (!res.ok) throw new Error(`email provider ${res.status}`);
      return;
    }
    if (!devEcho) throw new Error('no email provider configured');
  }

  const r = express.Router();
  r.use(express.json({ limit: '32kb' }));

  r.post('/otp/request', async (req, res) => {
    const { email } = req.body ?? {};
    if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: 'invalid email' });
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    otps.set(emailId(email), {
      codeHash: hmac(code),
      expires: Date.now() + OTP_TTL_MS,
      attempts: 0,
    });
    try {
      await sendOtp(email, code);
    } catch (err) {
      return res.status(502).json({ error: String(err.message) });
    }
    // devEcho solo existe para correr el ejemplo sin proveedor de email.
    res.json(devEcho ? { sent: true, devCode: code } : { sent: true });
  });

  r.post('/otp/verify', (req, res) => {
    const { email, code } = req.body ?? {};
    const id = emailId(email);
    const otp = otps.get(id);
    if (!otp || otp.expires < Date.now()) return res.status(401).json({ error: 'code expired' });
    otp.attempts += 1;
    if (otp.attempts > MAX_ATTEMPTS) {
      otps.delete(id);
      return res.status(429).json({ error: 'too many attempts' });
    }
    const ok = Buffer.from(hmac(String(code)));
    const want = Buffer.from(otp.codeHash);
    if (ok.length !== want.length || !timingSafeEqual(ok, want)) {
      return res.status(401).json({ error: 'wrong code' });
    }
    otps.delete(id);
    res.json({ token: issueToken(id) });
  });

  r.post('/fragments', (req, res) => {
    const claims = readToken(req);
    if (!claims) return res.status(401).json({ error: 'otp token required' });
    const { smartAccount, f2 } = req.body ?? {};
    if (typeof smartAccount !== 'string' || !f2?.ciphertext || !f2?.nonce) {
      return res.status(400).json({ error: 'smartAccount and encrypted f2 required' });
    }
    const store = load();
    store[claims.id] = { smartAccount, f2, storedAt: new Date().toISOString() };
    save(store);
    res.json({ stored: true });
  });

  r.post('/fragments/release', (req, res) => {
    const claims = readToken(req);
    if (!claims) return res.status(401).json({ error: 'otp token required' });
    const rec = load()[claims.id];
    if (!rec) return res.status(404).json({ error: 'no fragment for this email' });
    res.json({ smartAccount: rec.smartAccount, f2: rec.f2 });
  });

  return r;
}
