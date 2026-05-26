/**
 * MPC orchestration — create wallet (split) and reconstruct key (combine).
 * Built on top of `@accesly/core/crypto`. Allow-listed in `audit-no-custody`.
 */

export {
  RECONSTRUCT_THRESHOLD,
  TOTAL_FRAGMENTS,
  createWallet,
  type CreateWalletParams,
  type CreateWalletResult,
  type EncryptedFragments,
  type FragmentEncryptionKeys,
} from './split.js';

export {
  reconstructFromPlainAndEncrypted,
  reconstructKey,
  type EncryptedFragmentInput,
  type ReconstructFromPlainParams,
  type ReconstructKeyParams,
  type ReconstructKeyResult,
} from './combine.js';
