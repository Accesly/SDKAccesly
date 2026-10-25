/**
 * Config de testnet y estado local de la corrida.
 *
 * - `.state/state.json`: datos públicos (direcciones, hashes). Lo lee el reporte.
 * - `.secrets/*.json`: llaves de prueba y fragmentos cifrados. Gitignored.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const cfg = {
  network: 'stellar:testnet',
  passphrase: 'Test SDF Network ; September 2015',
  rpcUrl: process.env.RPC_URL ?? 'https://soroban-testnet.stellar.org',
  horizonUrl: process.env.HORIZON_URL ?? 'https://horizon-testnet.stellar.org',
  explorer: 'https://stellar.expert/explorer/testnet',

  // USDC de Circle en testnet (SAC) y su issuer clásico.
  usdc: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
  usdcCode: 'USDC',
  usdcIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',

  // Contratos compartidos de Accesly en testnet (SmartContracts/scripts/*.env).
  ed25519Verifier: 'CALVIIGIOMODZMWTMKZLSD4PZFFEPWQBSYERHUFM6MH5FLWKCHW4E4G5',
  secp256r1Verifier: 'CD2MD76Z2CBULDENT5P7CM5AFEFS5TA4PF4SWRNPHJWBBEX73EKGIOUS',
  spendingLimitPolicy: 'CBZVHDQTXTG76OQTIJF2EM6Z6UWGPKZU4B6DL2RZMGYYMMVELOVVOR72',
  x402Policy: process.env.X402_POLICY ?? 'CBWNUGXOJWNNQ5FGLRD3HCREU7XD2RTZNFPZDDRKE3RL4JEH3N75VZZV',

  // smart-account-v3.2.0: mismo hash que el WASM desplegado en mainnet el 5 jul 2026.
  smartAccountWasmHash:
    process.env.SMART_ACCOUNT_WASM_HASH ??
    'f1c549e2491e0f8d9cc7683f6056da2edd8a8c3d6786723ab1c86dae74a96b0e',

  // Servicios (facilitador, bóveda F2, agente). En el Hetzner van detrás de Caddy.
  serviceUrl: process.env.SERVICE_URL ?? 'http://localhost:4021',

  // USDC tiene 7 decimales en Stellar.
  usdcUnit: 10_000_000n,
};

export const usd = (dollars) => BigInt(Math.round(dollars * 1e7));

// RUN_DIR separa corridas (otra wallet, otro log) que comparten el código.
const RUN_ROOT = process.env.RUN_DIR ?? ROOT;

function file(kind, name) {
  const dir = join(RUN_ROOT, kind);
  mkdirSync(dir, { recursive: true });
  return join(dir, `${name}.json`);
}

export function loadJson(kind, name, fallback = undefined) {
  const p = file(kind, name);
  if (!existsSync(p)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing ${kind}/${name}.json — run the previous step first`);
  }
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function saveJson(kind, name, data) {
  writeFileSync(file(kind, name), JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
}

export const state = {
  get: () => loadJson('.state', 'state', {}),
  merge(patch) {
    const next = { ...state.get(), ...patch };
    saveJson('.state', 'state', next);
    return next;
  },
  /** Agrega una tx al log de evidencia. */
  logTx(entry) {
    const s = state.get();
    const txs = s.txs ?? [];
    txs.push({ at: new Date().toISOString(), ...entry });
    return state.merge({ txs });
  },
};
