/**
 * Soroban CustomAccountInterface auth-entry signer.
 *
 * Esta es la pieza que hace posible mandar XLM (o cualquier SAC asset) desde
 * un Smart Account de Accesly. El Smart Account es un contrato Soroban; sus
 * transfers se autorizan vía `__check_auth(signature_payload, AuthPayload,
 * auth_contexts)`.
 *
 * El SDK hace, en orden:
 *   1. Decodifica `signature_payload` (32 bytes — viene del backend simulate).
 *   2. XDR-codifica `context_rule_ids: Vec<u32>` como ScVal::Vec([U32]).
 *   3. Calcula `auth_digest = sha256(signature_payload || rule_ids_xdr)`.
 *   4. Firma `auth_digest` con la ed25519 seed reconstruida (F1+F2+F3) —
 *      ALLOW-LISTED en `audit-no-custody`.
 *   5. Construye el `AuthPayload` ScVal:
 *        AuthPayload {
 *          signers: { Signer::External(ed25519_verifier, pubkey): sig_bytes },
 *          context_rule_ids: [0, ...],
 *        }
 *   6. Reemplaza `credentials.address.signature` en la placeholder entry y
 *      devuelve el XDR base64 listo para mandar a `/tx/submit`.
 *
 * Referencia Rust:
 *   stellar_accounts::smart_account::storage::do_check_auth (OZ v0.7.1)
 *   auth_digest = sha256(signature_payload || context_rule_ids.to_xdr())
 *
 * Toda la criptografía respeta la non-custodial guarantee: la seed se
 * zero-iza en cuanto sale del scope, y nadie fuera del device la ve.
 */

import { sha256 } from '@noble/hashes/sha2';
import { signEd25519 } from '../crypto/keypair.js';
import { withZeroize } from '../crypto/zeroize.js';
import { loadStellarSdk } from './loadSdk.js';

export interface SignSorobanAuthEntryParams {
  /**
   * Hash de 32 bytes (base64) que el backend devuelve en
   * `simulateTx().signaturePayloadHashBase64`. Es el digest base de Soroban,
   * NO el final que firma el seed (ese se computa aquí).
   */
  readonly signaturePayloadHashBase64: string;
  /**
   * IDs de context rule del Smart Account, alineados por índice con los
   * `auth_contexts` que Soroban host valida. Para un `transfer` desde un
   * Smart Account de Accesly normalmente es `[0]` (regla `biometric-tx`).
   */
  readonly contextRuleIds: readonly number[];
  /**
   * XDR base64 de la `SorobanAuthorizationEntry` placeholder que devuelve
   * el backend. El SDK la usa como template — copia `rootInvocation`,
   * `credentials.address.nonce`, `signatureExpirationLedger`, y solo
   * reemplaza `credentials.address.signature` con el AuthPayload firmado.
   */
  readonly placeholderAuthEntryXdr: string;
  /**
   * Raw 32-byte ed25519 seed reconstruida via Shamir. Se zero-iza
   * automáticamente al salir de esta función — el caller NO debe reusarla.
   */
  readonly ed25519Seed: Uint8Array;
  /**
   * Address del contrato `ed25519-verifier` desplegado en la misma red. Va
   * dentro de `Signer::External(verifier, pubkey)` — el Smart Account
   * compara con la verifier address que tiene en su context rule.
   */
  readonly ed25519VerifierAddress: string;
  /**
   * Pubkey ed25519 raw (32 bytes) del dueño del Smart Account — el
   * `key_data` de la entrada `Signer::External`. Debe matchear lo que el
   * Smart Account tiene almacenado en su context rule.
   */
  readonly ownerPubkey: Uint8Array;
}

export interface SignSorobanAuthEntryResult {
  /**
   * XDR base64 de la `SorobanAuthorizationEntry` con la firma del owner
   * dentro del AuthPayload. Esto va directo al body de `/tx/submit`.
   */
  readonly signedAuthEntryXdr: string;
}

/**
 * Firma la auth entry de un Smart Account para autorizar un único
 * `auth_context` (el caso XLM-transfer MVP).
 */
export async function signSorobanAuthEntry(
  params: SignSorobanAuthEntryParams,
): Promise<SignSorobanAuthEntryResult> {
  const { xdr, Address, nativeToScVal } = await loadStellarSdk();

  // 1. Decode signature_payload (32 bytes).
  const signaturePayload = base64ToBytes(params.signaturePayloadHashBase64);
  if (signaturePayload.length !== 32) {
    throw new Error(
      `signSorobanAuthEntry: signature payload must be 32 bytes, got ${signaturePayload.length}`,
    );
  }

  if (params.ownerPubkey.length !== 32) {
    throw new Error(
      `signSorobanAuthEntry: ownerPubkey must be 32 bytes, got ${params.ownerPubkey.length}`,
    );
  }

  // 2. XDR-encode context_rule_ids: Vec<u32> → ScVal::Vec([U32, ...]).
  // Esto debe matchear EXACTAMENTE `Vec<u32>::to_xdr(env)` del lado contrato.
  const ridScVal = xdr.ScVal.scvVec(params.contextRuleIds.map((id) => xdr.ScVal.scvU32(id)));
  const ridXdrBytes = new Uint8Array(ridScVal.toXDR());

  // 3. auth_digest = sha256(signature_payload || ridXdrBytes).
  const preimage = new Uint8Array(signaturePayload.length + ridXdrBytes.length);
  preimage.set(signaturePayload, 0);
  preimage.set(ridXdrBytes, signaturePayload.length);
  const authDigest = sha256(preimage);

  // 4. ed25519 sign authDigest. La seed se zero-iza tras este bloque.
  const sigBytes = withZeroize([params.ed25519Seed], () =>
    signEd25519(authDigest, params.ed25519Seed),
  );
  if (sigBytes.length !== 64) {
    throw new Error(`signSorobanAuthEntry: expected 64-byte ed25519 sig, got ${sigBytes.length}`);
  }

  // 5. Build Signer::External(Address, Bytes) ScVal. Soroban contracttype
  // enum con payload serializa como ScVal::Vec([Symbol(variant), ...payload]).
  const signerScVal = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('External'),
    Address.fromString(params.ed25519VerifierAddress).toScVal(),
    nativeToScVal(params.ownerPubkey, { type: 'bytes' }),
  ]);

  // 6. Build AuthPayload struct:
  //    AuthPayload {
  //      signers: Map<Signer, Bytes>,
  //      context_rule_ids: Vec<u32>,
  //    }
  //    Soroban serializa structs como ScVal::Map con keys = Symbol del campo,
  //    sorted alphabetically (context_rule_ids < signers).
  const authPayloadScVal = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('context_rule_ids'),
      val: ridScVal,
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('signers'),
      val: xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: signerScVal,
          val: nativeToScVal(sigBytes, { type: 'bytes' }),
        }),
      ]),
    }),
  ]);

  // 7. Parse the placeholder entry, replace credentials.address.signature.
  const entry = xdr.SorobanAuthorizationEntry.fromXDR(params.placeholderAuthEntryXdr, 'base64');
  const credentials = entry.credentials();
  if (credentials.switch().name !== 'sorobanCredentialsAddress') {
    throw new Error(
      `signSorobanAuthEntry: placeholder credentials must be Address variant, got ${credentials.switch().name}`,
    );
  }
  credentials.address().signature(authPayloadScVal);

  return { signedAuthEntryXdr: entry.toXDR('base64') };
}

function base64ToBytes(s: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(s);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  // Node fallback
  return new Uint8Array(Buffer.from(s, 'base64'));
}
