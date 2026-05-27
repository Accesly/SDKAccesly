/**
 * WebAuthn / passkey subsystem.
 *
 * - `registerPasskey` — creates a new credential with PRF if available.
 * - `unlockPasskey` — assertion + PRF re-eval to unlock F1.
 * - `DeviceStore` — pluggable persistent storage (IndexedDB default).
 */

export type { CredentialRecord, PasskeyDescriptor } from './types.js';
export {
  normalizeSecp256r1Pubkey,
  registerPasskey,
  type RegisterPasskeyParams,
  type RegisterPasskeyResult,
} from './register.js';
export { unlockPasskey, type UnlockPasskeyParams, type UnlockPasskeyResult } from './verify.js';
export { IndexedDbDeviceStore, InMemoryDeviceStore, type DeviceStore } from './storage.js';
