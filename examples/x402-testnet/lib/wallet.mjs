/**
 * Wallet del cliente: fragmentos, OTP con la bóveda y reconstrucción 2-de-3.
 *
 * En el SDK web, F1 vive en IndexedDB y la llave de F2 sale de la PRF del
 * passkey. En este ejemplo de Node ambas viven en `.secrets/device.json`
 * (el "device"). La bóveda solo tiene el sobre cifrado de F2.
 */

import { createInterface } from 'node:readline/promises';
import { reconstructKey } from '@accesly/core/mpc';
import { cfg, loadJson } from './config.mjs';

const b64 = (u8) => Buffer.from(u8).toString('base64');
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

export const envelopeToWire = (e) => ({
  nonce: b64(e.nonce),
  ciphertext: b64(e.ciphertext),
  ...(e.aad ? { aad: b64(e.aad) } : {}),
});
export const envelopeFromWire = (w) => ({
  nonce: unb64(w.nonce),
  ciphertext: unb64(w.ciphertext),
  ...(w.aad ? { aad: unb64(w.aad) } : {}),
});
export { b64, unb64 };

async function post(path, body, token) {
  const res = await fetch(`${cfg.serviceUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} → ${res.status} ${data.error ?? ''}`);
  return data;
}

/**
 * OTP por email: pide el código y lo verifica. Con DEV_OTP_ECHO en el
 * servicio, el código viene en la respuesta; si no, se pide por consola.
 */
export async function otpLogin(email) {
  const sent = await post('/vault/otp/request', { email });
  let code = sent.devCode ?? process.env.OTP_CODE;
  if (!code) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    code = (await rl.question(`OTP sent to ${email}. Code: `)).trim();
    rl.close();
  }
  const { token } = await post('/vault/otp/verify', { email, code });
  return token;
}

export const storeF2 = (token, smartAccount, f2Envelope) =>
  post('/vault/fragments', { smartAccount, f2: envelopeToWire(f2Envelope) }, token);

export async function releaseF2(token) {
  const { f2 } = await post('/vault/fragments/release', {}, token);
  return envelopeFromWire(f2);
}

/**
 * Reconstruye la seed del owner con F1 (device) + F2 (bóveda, tras OTP).
 * Devuelve una seed fresca; quien la use para firmar la zero-iza.
 */
export async function reconstructOwnerSeed(token) {
  const device = loadJson('.secrets', 'device');
  const f2 = await releaseF2(token);
  const { privateSeed, publicKey } = reconstructKey({
    fragments: [
      { envelope: envelopeFromWire(device.f1), key: unb64(device.f1Key) },
      { envelope: f2, key: unb64(device.f2Key) },
    ],
  });
  if (b64(publicKey) !== device.ownerPubkey) {
    privateSeed.fill(0);
    throw new Error('reconstructed key does not match the wallet owner');
  }
  return privateSeed;
}
