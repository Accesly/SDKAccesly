# @accesly/core

## 1.20.0

### Minor Changes

- feat(api): `AcceslyRestClient` — cliente server-to-server para los endpoints `/v1/*` del RestApi stack (Fase 11). Usa `X-Accesly-Api-Key` header. Métodos: `getWallet(address)`, `getTransactions(address)`, `testWebhook(input)`. Diseñado para Node 18+, Bun, edge runtimes — recibe `fetch` override + `timeoutMs`. Lanza `AcceslyRestError` con `status` + `code` machine-readable.

## 1.19.0

### Minor Changes

- feat(api): nuevos endpoints Fase 10 en `AccesslyEndpoints`:
  - `listContacts()` / `createContact(input)` / `deleteContact(id)` — CRUD del address book per-user, Cognito-auth.
  - `reserveHandle({ handle, walletAddress })` — registra handle global FCFS (lanza 409 si tomado).
  - `resolveHandle(handle)` — público + cacheable 5min, devuelve `walletAddress` o `null` si no existe (404 → null).
  - `lookupHandleByWallet(walletAddress)` — reverse lookup público.
- feat(types): nuevos tipos públicos `ContactInput` y `ContactRecord`.

## 1.16.1

### Patch Changes

- chore: matches @accesly/react@1.16.1 for the `useBranding` hook release. No core API changes.

## 1.16.0

### Minor Changes

- feat(api): new `GMissingTrustlineError extends AccesslyApiError` with `asset: 'USDC' | 'EURC'`. Constructed when the backend returns 409 with `code: 'G_MISSING_TRUSTLINE'` — the G-address bridge exists but doesn't trust the asset the caller is trying to move through it (only relevant once a dev enables EURC). The React adapter uses this in `withAutoAddTrustlineG` to dispatch `wallet.addTrustlineG(asset)` and retry the original call.
- feat(api): `endpoints.addTrustlineGSimulate` / `addTrustlineGSubmit` for the new `POST /trustlines/g/add/{simulate,submit}` endpoints. Both Cognito-authenticated. Asset allowlist (Circle USDC + EURC) enforced by the backend; the SDK simply forwards the asset code.
- feat(api): `errorForResponse` now also maps `G_MISSING_TRUSTLINE` to the new error.

## 1.15.0

### Minor Changes

- feat(api): `endpoints.appConfig(appId)` — public GET `/app-config/{appId}` for the configuration the developer authored from `dev.accesly.xyz`. Returns the full `AppConfigResponse` shape (branding, auth providers, trustlines, wallet rollout, policies, webhooks, features). Cacheable 60s edge. Read by `useAppConfig` from `@accesly/react` and consumed at runtime by integrators to drive branding, supported assets, KYC policy, etc.
- feat(types): full TypeScript surface for the appConfig schema v1 — `AppConfigResponse`, `AppConfigBranding`, `AppConfigAuth`, `AppConfigNetworks`, `AppConfigTrustline`, `AppConfigWallet`, `AppConfigPolicies`, `AppConfigWebhook`, `AppConfigFeatures` plus the supporting unions (`AppEnvironment`, `AuthProvider`, `TrustlineCode`, `RolloutStrategy`, `RolloutCohort`, `FeeStrategy`, `AppPlan`, `AppStatus`, `KycLevel`, `FiatOnrampMethod`). All optional fields are `readonly` so consumers can use them in derived `useMemo`.

## 1.14.2

### Patch Changes

- feat(api): new `GAddressNotBootstrappedError extends AccesslyApiError`. Se construye cuando el backend devuelve 409 con `code: 'G_NOT_BOOTSTRAPPED'` — flows que usan la G-address bridge classic (swap-sdex, sweep, fiat) reportan así que el user aún no llamó `wallet.bootstrapG()`. El React adapter usa esta clase para auto-disparar bootstrap en `tx.swapViaSdex` y `wallet.sweepGToSA`. Para `fiat.*` y `kyc.*` (que no reciben material), el caller sigue siendo responsable de bootstrapear explícitamente.

## 1.14.1

### Patch Changes

- feat(api): new `WalletNotEnrolledError extends AccesslyApiError` con campo `asset: 'XLM' | 'USDC'`. Se construye cuando el backend devuelve 409 con `code: 'WALLET_NOT_ENROLLED'` y `asset` en el body. Permite al React adapter detectar el caso de forma typada y reintentar tras `activateAsset(asset)` automáticamente (ver CHANGELOG de `@accesly/react`).
- chore(api): `errorForResponse` ahora extrae `code` del body y mapea `WALLET_NOT_ENROLLED` antes del fallback genérico `ValidationError`. Backwards-compatible — callers que no usen `code` siguen viendo `ValidationError` para otros 409.

## 1.14.0

### Minor Changes

- feat(wallet): `wallet.upgrade(targetVersion)` — Soroban contract upgrade del Smart Account preservando address, signers, context rules y balances. Firma admin-cfg con owner ed25519 (no-custodia intacta).
- feat(auth): `auth.signInWithGoogle(redirectUri?)` + `auth.handleAuthCallback(code, redirectUri?)` — federated sign-in via Cognito Hosted UI.
- feat(wallet): `activateAsset('XLM')` además de `'USDC'` — necesario para wallets cuyo constructor no instaló la rule biometric-tx de XLM (cap de byte-write Soroban en deploy).

### Patch Changes

- `signTransaction` ya no acepta `expectedPublicKey` (los falsos positivos contra CredentialRecords legados lo hacían inservible; backend valida la firma on-chain de todas formas).

## 1.0.0

### Minor Changes

- feat(recovery): F2 cipher-bound a recoveryKey + orchestrator de finalize

  Completa el flujo Recovery v2 end-to-end (Fase 1 Track 2).

  `@accesly/core`:
  - `CreateWalletRequest` acepta `fragmentF2Recovery: EncryptedFragmentWire`
    opcional — F2 cifrado con la `recoveryKey`. Necesario porque Shamir 2-de-3
    exige DOS shares para reconstruir el seed durante recovery (F1 está
    perdido cuando el device se pierde).
  - `GetFragment3Response` ahora trae `fragmentF2Recovery: EncryptedFragmentWire | null`.
  - `FinalizeRecoveryRequest` reemplaza el viejo bundle por `newFragmentF1Encrypted`,
    `newFragmentF2Encrypted` (passkey-bound), `newFragmentF2Recovery` (password-bound)
    y `newFragmentF3Encrypted`.

  `@accesly/react`:
  - `wallet.createWallet({ cognitoPassword })` ahora descifra F2 + F3 plain,
    los re-cifra con la `recoveryKey` derivada, manda BOTH `fragmentF2` (PRF-bound)
    - `fragmentF2Recovery` (password-bound) + `fragmentF3` (password-bound) al
      backend.
  - `recovery` namespace ahora expone DOS métodos (en vez de `finalize` monolítico):
    - `reconstructSeed({ cognitoPassword, recoveryJwt })` → trae F2_recovery + F3 del
      backend, descifra ambos con `recoveryKey`, reconstruye seed via Shamir.
      Devuelve `{ privateSeed, publicKey, recoveryKey, recoverySalt }`. Caller
      debe zero-izar `privateSeed` y `recoveryKey`.
    - `submitFinalize({ recoveryJwt, ... })` envía la rotación al backend tras
      que el caller construya la tx `rotate_signer` y firme el auth entry.

  La separación permite que el caller intercale UI prompts (mostrar nueva
  passkey, confirmar) sin perder el orchestrator entero.

## 1.0.0

### Minor Changes

- feat(recovery): Recovery v2 namespace + wallet.createWallet con F3 password-bound

  `@accesly/core`:
  - Nuevos endpoints en `AccesslyEndpoints`: `requestRecoveryOtp`,
    `verifyRecoveryOtp`, `getFragment3`, `finalizeRecovery`.
  - Nuevos tipos: `RecoveryOtpRequestInput`, `RecoveryOtpRequestResponse`,
    `RecoveryOtpVerifyInput`, `RecoveryOtpVerifyResponse`,
    `GetFragment3Response`, `FinalizeRecoveryRequest`,
    `FinalizeRecoveryResponse`.
  - `CreateWalletRequest` ahora acepta `emailHash` (hex sha256) y
    `recoverySalt` (base64) opcionales.
  - Re-export del helper `emailHashBytes(email)` desde `crypto/`.

  `@accesly/react`:
  - Nuevo namespace `recovery` en `useAccesly()` con `requestOtp`,
    `verifyOtp`, `finalize`. El `finalize` aún devuelve
    `NotImplementedYetError` en esta release — el orchestrator full
    (descifrar F3 + reconstruir seed + registrar new passkey + firmar
    rotate_signer) se completará en el example en el siguiente PR.
  - `wallet.createWallet` acepta `cognitoPassword?: Uint8Array` opcional.
    Cuando se provee: deriva `recoveryKey = PBKDF2(password, salt, 600k)`,
    re-cifra F3 con esa key, manda `emailHash + recoverySalt` al backend.
    Las wallets creadas con esa prop son recuperables vía OTP.

## 1.0.0

### Major Changes

- BREAKING: remover `@accesly/zkemail`, recovery wire y endpoints SEP-30

  Prep para la `1.0.0` final con el nuevo flujo de recovery
  (OTP por email + password de Cognito). Ver `docs/Plan_Final_v1.md` §5
  (Fase 1).

  **`@accesly/core`:**
  - Borrado `src/recovery/` (orchestrator ZK + tipos).
  - Removidos los endpoints SEP-30 de `AccesslyEndpoints`: `configureRecovery`,
    `getRecoveryConfig`, `requestRecoverySignature`, `deleteRecoveryConfig`,
    `recoverWallet`.
  - Removidos los tipos asociados: `ConfigureRecoveryRequest`, `RecoveryConfigResponse`,
    `RecoverySignerRequest`, `RecoverySignerPublic`, `RecoveryIdentity`,
    `RecoveryAuthenticationMethod`, `RecoverySignRequest`, `RecoverySignResponse`,
    `RecoveryDeleteResponse`.

  **`@accesly/react`:**
  - `auth.recover()` y `RecoveryNotAvailableError` removidos.
  - `RecoveryNamespace`, `RecoverInput`, `RecoverResult`, `ZkEmailProverLike`
    removidos.
  - Prop `zkEmailProver` removida de `<AcceslyProvider>`.
  - `ZkEmailProverHandle` removido de `AcceslyContextValue`.

  **`@accesly/zkemail`:**
  - Paquete eliminado del monorepo. La versión publicada `0.1.0` se deprecará
    en npm apuntando a la nueva `1.0.0` de core.

  Migración: si dependes de `auth.recover()` o de los endpoints SEP-30, quédate
  en `0.7.0` hasta que `1.0.0` final salga con el nuevo flujo. El tag npm
  `latest` sigue apuntando a `0.7.x` durante la transición.

## 0.7.0

### Minor Changes

- feat(recovery): SEP-30 recovery namespace + `auth.recover()` via ZK email proof

  **`@accesly/core`**
  - `AccesslyEndpoints` gana 4 métodos contra los endpoints `/sep30/accounts/*`:
    `configureRecovery`, `getRecoveryConfig`, `requestRecoverySignature`,
    `deleteRecoveryConfig`.
  - Nuevos tipos: `RecoveryIdentity`, `RecoveryAuthMethod`, `RecoverySignerRequest`,
    `RecoverySignerPublic`, `ConfigureRecoveryRequest`, `RecoveryConfigResponse`,
    `RecoverySignRequest`, `RecoverySignResponse`, `RecoveryDeleteResponse`.
  - Sin runtime nuevo — son wrappers HTTP idiomáticos sobre `AccesslyApiClient`.

  **`@accesly/react`**
  - Nueva namespace `recovery` en `useAccesly()`: `configure`, `get`,
    `requestSignature`, `remove` — todos pegan a los endpoints SEP-30 con el
    JWT de Cognito ya inyectado.
  - `auth.recover(input)` ahora está disponible cuando `<AcceslyProvider>` recibe
    un `zkEmailProver={...}` (instancia de `@accesly/zkemail`). El SDK genera la
    proof Groth16 client-side y devuelve `{ proof, publicSignals, elapsedMs }`
    listo para que el backend Lambda lo submita a Soroban.
  - Si no se pasa el prover, `auth.recover()` lanza `RecoveryNotAvailableError`
    con instrucciones de instalación. Mantiene `@accesly/react` sin hard dep
    sobre `@accesly/zkemail`.

## 0.6.0

### Minor Changes

- feat(tx): mandar XLM end-to-end desde un Smart Account de Accesly

  **`@accesly/core`**
  - Nuevo `stellar/sorobanAuth.ts` con `signSorobanAuthEntry({...})` que firma la `SorobanAuthorizationEntry` del Smart Account: calcula `auth_digest = sha256(signature_payload || context_rule_ids.to_xdr())`, ed25519-firma con la seed reconstruida vía Shamir y empaqueta el `AuthPayload { signers, context_rule_ids }` reemplazando la signature placeholder. Match exacto con `OZ SmartAccount::do_check_auth` v0.7.1.
  - Nuevo `crypto/sessionFragment.ts` con `unwrapSessionFragment2(response, ephemeralPrivKey)` para deshacer la capa session-key (X25519 ECDH + HKDF-SHA256 → AES-256-GCM) que el backend pone alrededor de F2 en `POST /fragments/2`. Zero-iza shared, sessionKey y la privKey efímera al terminar.
  - `AccesslyEndpoints` gana `simulateTx({ amountStroops, destinationAddress })` y `submitTx({ unsignedXdr, signedAuthEntryXdr })` con sus tipos `SimulateTxRequest/Response`, `SubmitTxRequest/Response`.
  - Re-exports nuevos en el root: `signSorobanAuthEntry`, `unwrapSessionFragment2`, `generateX25519Keypair`, `decryptAesGcm`, `encryptAesGcm` y sus tipos.

  **`@accesly/react` — BREAKING**
  - `tx.signPayment(...)` reemplazado por `tx.send(input: SendXlmInput): Promise<SendXlmResult>` que orquesta el flujo completo no-custodial: simulate → ECDH F2 → reconstruct seed → sign Soroban auth entry → submit. Devuelve `{ txHash, status, explorerUrl }`.
  - Removido `SignPaymentInput` del export. Nuevo `SendXlmInput` / `SendXlmResult`.
  - `EnvironmentDefaults.stellar` ahora requiere `ed25519VerifierAddress` (testnet: `CALVIIGIOMODZMWTMKZLSD4PZFFEPWQBSYERHUFM6MH5FLWKCHW4E4G5`). Es la address del contrato verifier que el Smart Account compara dentro de `Signer::External(verifier, pubkey)`.

## 0.5.0

### Minor Changes

- feat(wallet): testnet auto-funding via Stellar friendbot
  - `@accesly/core`: añade campo opcional `testnetFunded?: boolean` en `CredentialRecord` como flag de idempotencia para no spamear friendbot en cada login.
  - `@accesly/react`: nuevo método `wallet.fundTestnet(walletAddress)` que dispara `https://friendbot.stellar.org?addr=<C…>` (la SDF soporta contratos Soroban directamente post protocolo 23). `ensureWallet` lo invoca fire-and-forget cuando el deploy ya está `on-chain`, así la UI no tiene que orquestar el funding manualmente. En `prod` (mainnet) es no-op y devuelve `reason: 'mainnet-not-supported'`.

## 0.3.2

### Patch Changes

- Fix `Cannot read properties of undefined (reading 'HashIdPreimage')`
  (and any other access to `xdr`, `Keypair`, `Horizon`, etc.) when the
  consumer's bundler (Vite, esbuild via UMD entry, Webpack with
  `esModuleInterop: false`) wraps `@stellar/stellar-sdk`'s exports under a
  `.default` property.

  Native Node 22 ESM does not wrap, which is why a working test suite can
  ship a build that explodes in the browser. The SDK now defensively
  unwraps `.default` before destructuring, transparently to consumers.

  Applied to all 4 stellar/\* helpers: `contractAddress`, `builder`,
  `signer`, `horizon`.

  No API change.

## 0.3.1

### Patch Changes

- Fix `computeSmartAccountAddress` (and therefore `wallet.computeAddress` and
  `wallet.createWallet`) on apps that have `@stellar/stellar-sdk` v15+
  installed — which is required for Soroban protocol 26 support.

  Bug: `0.3.0` called `hash(...)` from `@stellar/stellar-sdk`'s top-level
  namespace. That symbol was removed/relocated in v15, so consumers got
  `TypeError: hash is not a function` the moment they tried to create a
  wallet.

  Fix: replace the call with `sha256` from `@noble/hashes` — same SHA-256,
  already a transitive dep, version-stable. No API change for SDK consumers.

## 0.3.0

### Minor Changes

- Adds support for the backend's new `onChain` field on `GET /wallets`,
  deterministic client-side wallet address computation, and ghost-wallet
  retry. Designed for the post-Soroban-v26 reality where the constructor
  may exceed resource caps and the deploy can land in a record-without-
  contract state.

  **`@accesly/core`**
  - New `computeSmartAccountAddress({ ownerPubkey, deployerAddress,
networkPassphrase })` in `@accesly/core/stellar` — derives the
    Soroban contract address client-side via the same Stellar Core
    algorithm the backend Lambda uses. Lazy-imports `@stellar/stellar-sdk`.
  - `GetWalletResponse` now includes `onChain: boolean | null`.
  - `CredentialRecord` gains optional `publicKey`, `emailCommitment`,
    `fragmentF2Encrypted`, `fragmentF3Encrypted`, `onChain` — all needed
    for `wallet.retryDeploy` to re-submit without regenerating the keypair.
    Existing records keep working unchanged.

  **`@accesly/react`**
  - `wallet.computeAddress(ownerPubkey)` — pure client-side address
    derivation using the env-configured deployer. Show the user the
    address before any network call.
  - `wallet.createWallet` now pre-computes the deterministic address and
    persists a complete `CredentialRecord` (all 3 encrypted fragments +
    pubkey + emailCommitment + initial `onChain: null`) BEFORE the POST.
    Eliminates ghost wallets that lose recoverable state on POST failure.
  - `wallet.ensureWallet` returns `{ walletAddress, status, createdNow,
publicKey? }` where `status: 'on-chain' | 'pending-deploy' | 'unknown'`
    reflects the backend's Soroban check. Ghost wallets auto-trigger a
    `retryDeploy` attempt.
  - New `wallet.retryDeploy(username)` re-submits POST `/wallets` with the
    saved encrypted fragments. Backend dedupes by ownerPubkey → guaranteed
    same address.
  - `ENVIRONMENT_DEFAULTS.stellar.deployerAddress` added (dev:
    `GDRHSVLY3VCEHCHCSR5MZR2ALYLCERDDFT3ULCUIELGFVYHTZFCMNU4E`).

  Non-breaking: existing apps keep working. The new `status` field on
  `EnsureWalletResult` is additive; the new optional fields on
  `CreateWalletInput`/`CredentialRecord` enable the safety net when used.

  Tests: 200/200 passing (195 core + 5 react), +9 new (contract address
  derivation, `onChain` field decoding).

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
