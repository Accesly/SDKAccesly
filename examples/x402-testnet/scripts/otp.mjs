/**
 * OTP en dos pasos, para cuando el código llega a un correo real:
 *
 *   node scripts/otp.mjs request <email>          → el servicio manda el código
 *   node scripts/otp.mjs verify <email> <código>  → guarda el token (10 min)
 *
 * Los scripts siguientes (02, 03, 04 con SIGNER=mpc, 05) reusan el token.
 */
import { requestOtp, verifyOtp } from '../lib/wallet.mjs';

const [action, email, code] = process.argv.slice(2);
if (action === 'request' && email) {
  await requestOtp(email);
  console.log(`code sent to ${email}`);
} else if (action === 'verify' && email && code) {
  await verifyOtp(email, code);
  console.log('verified; release token valid for ~9 minutes');
} else {
  console.error('usage: otp.mjs request <email> | verify <email> <code>');
  process.exit(1);
}
