/**
 * Client-side derivation of a Soroban contract address before deployment.
 *
 * Mirrors the algorithm used by Stellar Core (and by the Accesly backend
 * Lambda when invoking `CreateContract`):
 *
 *   contractId = sha256(
 *     networkId ||
 *     ENVELOPE_TYPE_CONTRACT_ID ||
 *     HashIdPreimageContractId {
 *       networkId,
 *       contractIdPreimage: ContractIdPreimageFromAddress { address, salt }
 *     }
 *   )
 *   walletAddress = StrKey.encodeContract(contractId)
 *
 * For Accesly's Smart Account convention:
 *   - `address` is the OZ Relayer's `channels-fund` Stellar account
 *   - `salt` is `sha256(ownerPubkey)`
 *
 * Determinism: the address is fixed once `(deployerAddress, ownerPubkey)` is
 * fixed, regardless of when the deploy actually settles. Lets the SDK show
 * the address to the user instantly and detect "ghost wallets" (record OK
 * locally / on backend but deploy never landed on chain).
 *
 * `@stellar/stellar-sdk` is lazy-imported so apps that never call this
 * helper don't pay the bundle cost. SHA-256 comes from `@noble/hashes`
 * (already a dep) instead of `stellar-sdk.hash` — the latter was renamed
 * away from the top-level namespace in stellar-sdk v15+.
 */

import { sha256 } from '@noble/hashes/sha2';

export interface ComputeSmartAccountAddressParams {
  /** 32-byte ed25519 public key of the wallet owner (used as the salt seed). */
  readonly ownerPubkey: Uint8Array;
  /**
   * Stellar G-address of the deployer (the OZ Relayer `channels-fund`
   * account for the target environment). The backend's Lambda uses this
   * exact account when invoking `CreateContract`.
   */
  readonly deployerAddress: string;
  /** e.g. `'Test SDF Network ; September 2015'` for testnet. */
  readonly networkPassphrase: string;
}

/**
 * Computes the deterministic Soroban contract address that the backend will
 * (or did) deploy the Smart Account at. Same algorithm Stellar Core uses; the
 * returned string is a 56-char `C…` address ready for `Horizon` /
 * `stellar.expert` URLs.
 */
export async function computeSmartAccountAddress(
  params: ComputeSmartAccountAddressParams,
): Promise<string> {
  if (params.ownerPubkey.length !== 32) {
    throw new RangeError(
      `computeSmartAccountAddress: ownerPubkey must be 32 bytes, got ${params.ownerPubkey.length}`,
    );
  }
  if (!params.deployerAddress.startsWith('G') || params.deployerAddress.length !== 56) {
    throw new RangeError(
      `computeSmartAccountAddress: deployerAddress must be a 56-char G-address, got ${params.deployerAddress.length}-char "${params.deployerAddress.slice(0, 6)}…"`,
    );
  }
  if (!params.networkPassphrase) {
    throw new RangeError('computeSmartAccountAddress: networkPassphrase is required');
  }

  const sdk = await import('@stellar/stellar-sdk');
  const { StrKey, xdr, Address } = sdk;

  // SHA-256 from @noble/hashes — stable across browsers and runtimes, and
  // avoids stellar-sdk's `hash()` which was removed from the top-level
  // namespace in v15+.
  const salt = sha256(params.ownerPubkey);
  const networkId = sha256(new TextEncoder().encode(params.networkPassphrase));

  // The xdr constructors are TypeScript-typed as `Buffer` but accept any
  // Uint8Array at runtime (the XDR encoder just iterates bytes). The casts
  // here are types-only.
  const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: networkId as unknown as Buffer,
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
        new xdr.ContractIdPreimageFromAddress({
          address: Address.fromString(params.deployerAddress).toScAddress(),
          salt: salt as unknown as Buffer,
        }),
      ),
    }),
  );

  const contractIdHash = sha256(preimage.toXDR());
  return StrKey.encodeContract(contractIdHash as unknown as Buffer);
}
