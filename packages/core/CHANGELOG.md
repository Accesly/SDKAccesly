# @accesly/core

## 0.2.0

### Minor Changes

- Adds the `GET /wallets` idempotent recovery path and crash-safe wallet
  creation. Two related changes:

  **`@accesly/core` / `@accesly/api`:**
  - New endpoint wrapper `AccesslyEndpoints.getWallet(): Promise<GetWalletResponse | null>` —
    hits the new backend `GET /wallets`, returns the user's already-deployed
    Smart Account metadata, or `null` if the user has no wallet yet.
  - New type `GetWalletResponse = { walletAddress, appId, createdAt }`.

  **`@accesly/react` / `useAccesly().wallet`:**
  - New `wallet.ensureWallet(input)` — the recommended entry-point at the top
    of every authenticated session. Calls `GET /wallets` first; if a wallet
    already exists, returns it (no keypair regen, no extra cost); otherwise
    falls through to the full create flow. Returns `{ walletAddress,
createdNow, publicKey? }`.
  - New `wallet.fetchRemote()` — raw read of the backend metadata.
  - `wallet.createWallet(input)` now accepts optional `credentialId` and
    `prfSalt`. When both are provided, the SDK persists a
    `CredentialRecord` (with the encrypted F1 + passkey metadata) to the
    configured `DeviceStore` **before** the network call. If the POST then
    fails (timeout, network drop, tab close), the encrypted F1 + passkey
    metadata survive locally and the wallet is recoverable via
    `wallet.ensureWallet` on the next session.
  - New `wallet.getPendingWallets()` — lists `CredentialRecord`s whose
    `walletAddress` is still `null` (POST never confirmed). Diagnostic aid.
  - New `wallet.clearStoredCredential(username)` — removes a stored credential
    after reconciliation.

  Non-breaking: existing `wallet.createWallet({ email, emailSalt,
encryptionKeys, secp256r1Pubkey })` calls keep working, just without the
  crash-safety net. Apps that pass `credentialId` + `prfSalt` get the safety
  automatically.

## 0.1.1

### Patch Changes

- Hardens `secp256r1Pubkey` handling on wallet creation so the backend never
  rejects with `"secp256r1Pubkey must be hex 65 bytes (uncompressed)"`:
  - **`@accesly/core`**: exports new helper `normalizeSecp256r1Pubkey(input)`
    that coerces any of the common P-256 pubkey shapes (65-byte uncompressed,
    64-byte raw `X||Y`, 91-byte SPKI) into the canonical 65-byte `0x04 || X || Y`
    form. Throws with a precise message on compressed or unknown formats.
  - **`@accesly/core/webauthn`**: `registerPasskey` now uses the normalizer
    internally and surfaces SPKI length + first bytes on extraction failure for
    easier diagnosis.
  - **`@accesly/react`**: `useAccesly().wallet.createWallet(...)` now applies
    `normalizeSecp256r1Pubkey` before hex-encoding the pubkey, so an input that
    happens to lack the `0x04` prefix (or comes wrapped in an SPKI) still ends
    up as the 130-char hex the backend expects.

  No API breakage. Apps that already pass the canonical 65-byte buffer keep
  working unchanged.

## 0.1.0

### Minor Changes

- Initial release `0.1.0`.

  **`@accesly/core`** — framework-agnostic primitives:
  - `crypto/*` — Ed25519 + Shamir SSS (GF(256)) + AES-256-GCM + HKDF + PBKDF2 + X25519 + zeroize
  - `mpc/*` — `createWallet`, `reconstructKey`, `reconstructFromPlainAndEncrypted`
  - `auth/*` — `CognitoAuthClient` (USER_SRP_AUTH), `TokenManager`, `SessionStorage`
  - `api/*` — `AccesslyApiClient` (retry + telemetry + auth header), `AccesslyEndpoints`, typed error hierarchy
  - `webauthn/*` — `registerPasskey` + `unlockPasskey` (with PRF extension), `IndexedDbDeviceStore`
  - `stellar/*` — `buildPaymentTransaction`, `signTransaction` (allow-listed, with `withZeroizeAsync`), `getBalances`

  **`@accesly/react`** — React adapter:
  - `<AcceslyProvider appId env>` with environment defaults for `dev`
  - `useAccesly()` hook with namespaces: `auth`, `wallet`, `tx`, `kyc`, plus stub `session`/`settings`/`yieldOps` (Fase 7+)
  - `auth.recover()` exposed but throws `RecoveryNotAvailableError` until Track C ZK ships

  Tested: 179/179 tests passing. Non-custody premise verified by 6 CI-blocking tests + `audit-no-custody.mjs` guard.
