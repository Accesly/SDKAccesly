# @accesly/react

## 1.16.0

### Minor Changes

- feat(wallet): `wallet.addTrustlineG({ asset, fragmentF1Plain, fragmentF2Key, ownerPubkey })` sponsors a `ChangeTrust(asset)` on the user's existing G-address. Returns `{ txHash, successful, gAddress, asset }`. Currently allowlisted to Circle USDC + EURC; backend rejects anything else with 400. Channels-fund covers the 0.5 XLM reserve.
- feat(tx): `tx.swapViaSdex` adds a third auto-recovery layer — `withAutoAddTrustlineG` wraps the existing `withAutoBootstrapG(withAutoEnroll(...))` stack. If the backend returns `GMissingTrustlineError`, the SDK calls `wallet.addTrustlineG(err.asset)` with the same unlocked material and retries the swap. No extra passkey prompts.
- chore(internal): extracted `doAddTrustlineG` as a closure shared between the public `wallet.addTrustlineG` method and the auto-recovery wrapper, mirroring the `doBootstrapG` pattern.

## 1.15.0

### Minor Changes

- feat(hooks): `useAppConfig()` — fetches `endpoints.appConfig(appId)` at mount, refetches every 60s (matches the backend `Cache-Control: max-age=60`), and on `visibilitychange:visible` so toggling a setting on `dev.accesly.xyz` propagates to running clients within the minute. Returns `{ config, isLoading, error, refresh }`. On error the previous good config is kept so the UI doesn't flicker — integrators fall back to their own defaults via derived `useMemo`.

## 1.14.2

### Patch Changes

- feat(tx,wallet): `tx.swapViaSdex` y `wallet.sweepGToSA` ahora auto-disparan `wallet.bootstrapG()` cuando el backend reporta `GAddressNotBootstrappedError`. El SDK reusa el `material` ya unlocked (fragmentF1Plain, fragmentF2Key, ownerPubkey) — un solo prompt de passkey cubre bootstrap + operación. El primer uso paga ~10s extra (sponsor + ChangeTrust + EndSponsoring) pero queda transparente al caller.
- refactor(wallet): extraído `doBootstrapG` como closure compartido. `wallet.bootstrapG` y la auto-recovery en `wallet.sweepGToSA` apuntan a la misma implementación; cero duplicación.

## 1.14.1

### Patch Changes

- feat(tx): `tx.send`, `tx.swap` y `tx.swapViaSdex` ahora auto-disparan `wallet.activateAsset(asset)` cuando el backend devuelve `WalletNotEnrolledError`. El caller no ve el error — el SDK detecta el 409, llama el activate con el mismo `material` (fragmentF1Plain, fragmentF2Key, ownerPubkey) ya unlocked, y reintenta la operación original. Cero passkey prompts extra.
- chore: las wallets sin la rule `biometric-tx` de XLM (cuyo constructor se topó con el cap de byte-write Soroban) ahora se enroll-an de forma transparente al primer `tx.send({ asset: 'XLM' })` / swap. La UI de la app integradora ya no necesita exponer un botón "Activar XLM" en el flujo end-user — los botones manuales solo tienen sentido como herramienta de developer.

## 1.14.0

### Minor Changes

- feat: expone `wallet.upgrade`, `auth.signInWithGoogle`, `auth.handleAuthCallback` y `activateAsset('XLM')` desde el hook `useAccesly`. Ver CHANGELOG de `@accesly/core` para detalle.

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

### Patch Changes

- Updated dependencies
  - @accesly/core@1.0.0

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

### Patch Changes

- Updated dependencies
  - @accesly/core@1.0.0

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

### Patch Changes

- Updated dependencies
  - @accesly/core@1.0.0

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

### Patch Changes

- Updated dependencies
  - @accesly/core@0.7.0

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

### Patch Changes

- Updated dependencies
  - @accesly/core@0.6.0

## 0.5.1

### Patch Changes

- fix(wallet): retry friendbot mientras el contrato aparece on-chain post-deploy

  `ensureWallet` ahora dispara el auto-fund también con `status: 'unknown'`
  (el estado natural justo después de `POST /wallets` OK, antes de que el GET
  de confirmación marque `on-chain`). Friendbot necesita el Smart Account
  vivo en Soroban para invocar `XLM_SAC.transfer`, así que `fundTestnetIfNeeded`
  hace hasta 6 reintentos × 5s (~30s ventana) en ese path para esperar la
  race POST → ledger close.

  Adicionalmente discrimina mejor las 400 de friendbot: "ya fondeada"
  (idempotencia OK) vs "contrato no existe aún" (reintentar). La llamada
  manual a `wallet.fundTestnet()` mantiene 0 reintentos — mismo comportamiento.

## 0.5.0

### Minor Changes

- feat(wallet): testnet auto-funding via Stellar friendbot
  - `@accesly/core`: añade campo opcional `testnetFunded?: boolean` en `CredentialRecord` como flag de idempotencia para no spamear friendbot en cada login.
  - `@accesly/react`: nuevo método `wallet.fundTestnet(walletAddress)` que dispara `https://friendbot.stellar.org?addr=<C…>` (la SDF soporta contratos Soroban directamente post protocolo 23). `ensureWallet` lo invoca fire-and-forget cuando el deploy ya está `on-chain`, así la UI no tiene que orquestar el funding manualmente. En `prod` (mainnet) es no-op y devuelve `reason: 'mainnet-not-supported'`.

### Patch Changes

- Updated dependencies
  - @accesly/core@0.5.0

## 0.4.0

### Minor Changes

- `wallet.createWallet` (and therefore `wallet.ensureWallet`) no longer throws
  when the backend's `POST /wallets` is rejected by Soroban with a known
  deploy-pending error (`txSorobanInvalid`, `scecExceededLimit`, etc.) —
  typical after Soroban protocol v26 lowered the per-tx resource caps and
  the Smart Account constructor temporarily exceeds them.

  Instead the call resolves with:

  ```ts
  {
    walletAddress: predictedAddress,   // client-side-derived, same as backend
    publicKey,
    status: 'pending-deploy',
    pendingReason: 'soroban submit failed: ... txSorobanInvalid',
  }
  ```

  The shards remain persisted in the `DeviceStore` (crash-safety from
  `0.3.0+`), so `wallet.retryDeploy(username)` will land the same wallet
  address once the contracts team slims the constructor. Genuine 5xx
  failures (network, KMS, database, etc.) still throw `ServerError`.

  `CreatedWalletInfo` gains required `status: WalletStatus` and optional
  `pendingReason: string`. Adds the helper `isSorobanDeployPendingError(err)`
  exported from `@accesly/react` for apps that want to detect this case in
  their own catch blocks.

  Bump is `minor` (not patch) because of the additive shape change on
  `CreatedWalletInfo`.

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

- Updated dependencies
  - @accesly/core@0.3.2

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

- Updated dependencies
  - @accesly/core@0.3.1

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

### Patch Changes

- Updated dependencies
  - @accesly/core@0.3.0

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

### Patch Changes

- Updated dependencies
  - @accesly/core@0.2.0

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

- Updated dependencies
  - @accesly/core@0.1.1

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

### Patch Changes

- Updated dependencies
  - @accesly/core@0.1.0
