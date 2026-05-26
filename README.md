# Accesly SDK

Wallets [Stellar](https://stellar.org) **no-custodiales** para apps web. Auth biométrica con passkey, recovery por email, fee abstraction, yield de CETES — todo desde un hook de React, sin que la llave del usuario toque tu backend.

[![npm @accesly/core](https://img.shields.io/npm/v/@accesly/core?label=%40accesly%2Fcore)](https://www.npmjs.com/package/@accesly/core)
[![npm @accesly/react](https://img.shields.io/npm/v/@accesly/react?label=%40accesly%2Freact)](https://www.npmjs.com/package/@accesly/react)
[![license MIT](https://img.shields.io/npm/l/@accesly/core)](./LICENSE)

---

## Instalación

```bash
pnpm add @accesly/react @accesly/core
```

## Quick start

```tsx
import { AcceslyProvider, useAccesly } from '@accesly/react';

function App() {
  return (
    <AcceslyProvider appId="my-app" env="dev">
      <Login />
    </AcceslyProvider>
  );
}

function Login() {
  const { auth } = useAccesly();

  if (auth.status === 'authenticated') {
    return (
      <div>
        <p>Hola {auth.username}</p>
        <button onClick={() => auth.signOut()}>Cerrar sesión</button>
      </div>
    );
  }

  return (
    <button
      onClick={async () => {
        await auth.signIn('user@example.com', 'Password1!');
      }}
    >
      Iniciar sesión
    </button>
  );
}
```

Eso es todo. Cognito real, JWT real, `auth.status` reactivo. Funciona contra el backend `dev` de Accesly desde el primer commit.

---

## Por qué Accesly

| Para...              | Lo que recibes                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| **Usuarios finales** | Wallet Stellar tan fácil como crear una cuenta de Gmail. Sin seed phrases. Sin instalar nada.   |
| **Desarrolladores**  | Integra wallets Stellar en cualquier app React con un Provider + un hook.                       |
| **Reguladores**      | El backend **nunca** tiene capacidad técnica de mover los fondos de un usuario. No es custodia. |

---

## Premisa no-custodial

El SDK genera el keypair ed25519 **en el dispositivo del usuario**, lo divide con Shamir Secret Sharing 2-of-3, cifra los fragmentos antes de enviarlos al backend, y **destruye la llave reconstruida de memoria inmediatamente después de firmar**.

| Material                     | Vive en                       | Cómo se protege                                                |
| ---------------------------- | ----------------------------- | -------------------------------------------------------------- |
| Keypair ed25519 generado     | Dispositivo (memoria volátil) | Existe milisegundos, se zeroiza                                |
| Fragmento F1                 | IndexedDB del dispositivo     | Cifrado con key derivada vía WebAuthn PRF (passkey biométrico) |
| Fragmento F2                 | Backend DynamoDB              | Cifrado por el SDK + KMS encryption-at-rest                    |
| Fragmento F3                 | Backend DynamoDB              | Cifrado por el SDK con PBKDF2(email + salt) — para recovery    |
| Llave reconstruida al firmar | Dispositivo (memoria volátil) | `withZeroizeAsync` garantiza limpieza incluso en throw         |

Cualquier 2 de 3 fragmentos reconstruyen la llave. Un solo fragmento no revela nada. El backend nunca tiene 2 fragmentos con sus keys al mismo tiempo.

Esta premisa está verificada por **6 tests CI-blocking** que escanean código + runtime para asegurarse de que ningún cambio futuro la rompa.

---

## Packages

| Package              | Versión                                                                                             | Qué hace                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **`@accesly/core`**  | [![npm](https://img.shields.io/npm/v/@accesly/core)](https://www.npmjs.com/package/@accesly/core)   | Framework-agnostic. Funciona en browser, Node y React Native. |
| **`@accesly/react`** | [![npm](https://img.shields.io/npm/v/@accesly/react)](https://www.npmjs.com/package/@accesly/react) | Adapter para React 18+. `AcceslyProvider` + `useAccesly()`.   |

### Subpaths de `@accesly/core` para tree-shaking

```ts
import { generateKeypair, signEd25519 } from '@accesly/core/crypto';
import { createWallet, reconstructKey } from '@accesly/core/mpc';
import { CognitoAuthClient, TokenManager } from '@accesly/core/auth';
import { AccesslyApiClient, AccesslyEndpoints } from '@accesly/core/api';
import { registerPasskey, IndexedDbDeviceStore } from '@accesly/core/webauthn';
import { signTransaction, buildPaymentTransaction } from '@accesly/core/stellar';
```

---

## API del hook

`useAccesly()` devuelve namespaces. Cada uno expone métodos tipados.

### `auth` — autenticación

```ts
const { auth } = useAccesly();

await auth.signUp(email, password); // Cognito sign-up + email de verificación
await auth.confirmSignUp(email, code); // confirma el código del email
await auth.resendConfirmation(email); // re-envía código

await auth.signIn(email, password); // USER_SRP_AUTH (password jamás sale en plain)
await auth.signOut(); // revoca refresh token + clear local

auth.status; // 'anonymous' | 'authenticated' | 'expired' (reactivo)
auth.username; // string | null (reactivo)

// Recovery por ZK email — disponible cuando el circuito ZK shippea
await auth.recover(email); // throws RecoveryNotAvailableError por ahora
```

### `wallet` — Smart Account on-chain

```ts
const { wallet } = useAccesly();

const { walletAddress, publicKey } = await wallet.createWallet({
  email,
  emailSalt, // 32 bytes random
  encryptionKeys: [f1Key, f2Key, f3Key], // derivadas vía WebAuthn PRF + PBKDF2(email)
  secp256r1Pubkey, // del passkey registrado
});
// → walletAddress es el Smart Account deployado en Stellar (testnet/mainnet)

const credential = await wallet.getStoredCredential(username);
```

### `tx` — firma de transacciones

```ts
const { tx } = useAccesly();

const { signedXdr } = await tx.signPayment({
  sourceAddress,
  destinationAddress,
  asset: 'XLM', // o { code: 'USDC', issuer: '...' }
  amount: '10.5',
  fragmentF1Plain, // desbloqueado vía WebAuthn PRF
  fragmentF2Envelope, // del backend /fragments/2
  fragmentF2Key, // derivada vía ECDH + HKDF
});

// Firma un XDR arbitrario
const result = await tx.signRawXdr({ transactionXdr, ed25519Seed, expectedPublicKey });
```

### `kyc` — verificación de identidad vía Etherfuse

```ts
const { kyc } = useAccesly();

await kyc.start(); // POST /kyc → devuelve hostedUrl con el flow KYC
await kyc.status(); // GET /kyc → estado actual
```

### Helpers de bajo nivel

Para casos avanzados (custom IdP, custom storage, scripts Node):

```ts
// WebAuthn directo (sin pasar por el hook)
import { registerPasskey, unlockPasskey } from '@accesly/core/webauthn';

const passkey = await registerPasskey({
  rpId: 'mi-app.com',
  rpName: 'Mi App',
  userId: sha256(email),
  userName: email,
});
// passkey.prfOutput → 32 bytes deterministas, úsalos como key AES-256

const assertion = await unlockPasskey({
  rpId: 'mi-app.com',
  credentialId: passkey.credentialId,
  challenge: getRandomBytes(32),
  prfSalt: passkey.prfSalt,
});

// Crypto primitives auditadas
import { hkdfSha256, pbkdf2Sha256, encryptAesGcm, withZeroizeAsync } from '@accesly/core/crypto';
```

---

## Configuración del Provider

```tsx
<AcceslyProvider
  appId="my-app-id"
  env="dev" // 'dev' | 'staging' | 'prod'
  apiUrl="https://custom.example.com" // opcional, override del default por env
  cognitoConfig={{
    // opcional, override del default
    region: 'us-east-1',
    userPoolId: '...',
    userPoolClientId: '...',
  }}
  overrides={{
    // tests / custom backends
    authClient: customAuthClient,
    sessionStorage: customStorage,
    deviceStore: customDeviceStore,
  }}
  telemetry={(event) => {
    // opcional, hook para Sentry/DataDog
    console.log(event);
  }}
>
  <YourApp />
</AcceslyProvider>
```

### Defaults por `env`

| env       | API URL                                                                |
| --------- | ---------------------------------------------------------------------- |
| `dev`     | `https://3fki7eiio5.execute-api.us-east-1.amazonaws.com/dev` (testnet) |
| `staging` | TBD                                                                    |
| `prod`    | TBD (mainnet)                                                          |

---

## Estado del SDK

### Funciona end-to-end hoy (`0.1.0`)

- ✅ Cognito sign-up / sign-in / sign-out con USER_SRP_AUTH
- ✅ Token refresh automático con dedup de requests concurrentes
- ✅ Generación de keypair + Shamir split + cifrado de fragmentos client-side
- ✅ Deploy de Smart Account en Stellar testnet via backend
- ✅ Firma de transacciones con `withZeroizeAsync` obligatorio
- ✅ WebAuthn passkey + PRF extension (Chrome 116+, Safari 18+)
- ✅ IndexedDB device store
- ✅ Read-only Horizon (balances + history)

### Stubs intencionados (throw explícito con mensaje claro)

- ⏸️ `auth.recover()` — `RecoveryNotAvailableError`. Requiere circuito ZK groth16 + backend `sep30Handler`. ETA 6-10 semanas.
- ⏸️ `session.*`, `settings.*`, `yieldOps.*` — `NotImplementedYetError`. Desbloqueado por el dashboard de developers + Etherfuse activation.

Estos stubs throwean con mensajes específicos para que tu código pueda capturarlos y mostrar UX apropiado.

---

## Trust model resumido

| Capa                   | Material                                                     | Quién puede acceder                             |
| ---------------------- | ------------------------------------------------------------ | ----------------------------------------------- |
| **Sólo dispositivo**   | keypair generado, llave reconstruida, F1 plain               | Sólo el usuario, vía passkey biométrico         |
| **Cifrado al backend** | F2, F3                                                       | Sólo el dispositivo, después de WebAuthn unlock |
| **Público**            | pubkey ed25519, pubkey passkey, emailCommitment, JWT Cognito | Cualquiera (es OK)                              |

Ningún operador de Accesly puede mover fondos de un usuario, ni en producción ni con acceso root al backend. La premisa es verificada por tests CI-blocking que escanean código + runtime.

---

## Compatibilidad

| Entorno        | Soporte                                                           |
| -------------- | ----------------------------------------------------------------- |
| Chrome 116+    | ✅ Completo (incluye WebAuthn PRF)                                |
| Safari 18+     | ✅ Completo (incluye WebAuthn PRF)                                |
| Edge 116+      | ✅ Completo                                                       |
| Firefox actual | ⚠️ Sin PRF — fallback con random key (documentado en trust model) |
| Node 20+       | ✅ Crypto + MPC + Stellar (sin WebAuthn — el browser lo provee)   |
| React Native   | ⏸️ Adapter dedicado en roadmap (`@accesly/react-native`)          |

---

## Stack interno

- **Crypto:** [`@noble/curves`](https://github.com/paulmillr/noble-curves) + [`@noble/hashes`](https://github.com/paulmillr/noble-hashes) + [`@noble/ciphers`](https://github.com/paulmillr/noble-ciphers) — auditadas por Trail of Bits + Cure53
- **Shamir SSS:** implementación propia GF(256) byte-wise (~230 LOC, tests con 1000 round-trips + vectores RFC)
- **Auth:** [`amazon-cognito-identity-js`](https://www.npmjs.com/package/amazon-cognito-identity-js) (sin Amplify completo)
- **Stellar:** [`@stellar/stellar-sdk`](https://github.com/stellar/js-stellar-sdk) v13 (lazy-loaded para no inflar bundles que sólo autentican)
- **Build:** [`tsup`](https://tsup.egoist.dev/) (ESM + CJS + d.ts dual)
- **Tests:** [`vitest`](https://vitest.dev/) con `happy-dom` para el adapter React

### Tamaño del bundle

| Entry                        | Gzipped |
| ---------------------------- | ------: |
| `@accesly/core` (re-exports) |   ~9 KB |
| `@accesly/core/auth`         |  2.3 KB |
| `@accesly/core/api`          |  2.6 KB |
| `@accesly/core/crypto`       |  2.8 KB |
| `@accesly/core/mpc`          |  2.8 KB |
| `@accesly/react`             |   ~3 KB |

Más deps externas que tu bundler tree-shakea: `@noble/*` ~50 KB gz, `amazon-cognito-identity-js` ~30 KB gz, `@stellar/stellar-sdk` ~200 KB gz (lazy, sólo al firmar).

---

## Desarrollo (contribuyentes)

Requisitos: Node 20+, pnpm 9+.

```bash
git clone https://github.com/daniellagart4-sys/SDKAccesly.git
cd SDKAccesly
pnpm install
```

Scripts más usados:

```bash
pnpm verify              # pipeline completa: format + lint + typecheck + test + audit + build
pnpm test                # vitest run
pnpm build               # tsup en todos los packages
pnpm audit:no-custody    # guard que verifica la premisa no-custodial
pnpm smoke-test:dev      # E2E ligero contra backend dev
```

### Premisa no-custodial en CI

El script `pnpm audit:no-custody` escanea el código fuente buscando patrones prohibidos (`Keypair.fromSecret`, `localStorage.setItem` con seed/secret, `console.log` con material sensible, etc.). Tiene una allowlist explícita para los archivos que LEGÍTIMAMENTE manejan material criptográfico — añadir uno requiere code review.

Plus 6 tests CI-blocking en `packages/core/tests/no-custody/`:

| Test                      | Garantía                                                    |
| ------------------------- | ----------------------------------------------------------- |
| `keypair-stays-local`     | La salida de `createWallet` jamás contiene la seed en plain |
| `shamir-needs-two-shares` | Un fragmento solo no permite reconstruir                    |
| `zeroize-after-sign`      | Buffers en ceros tras `signTransaction` (incluso en throw)  |
| `no-plaintext-storage`    | No escribe en localStorage/sessionStorage/indexedDB         |
| `no-console-leak`         | No emite material sensible por `console.*`                  |
| `full-loop`               | E2E: createWallet → reconstruct → sign → zeroize            |

### Release

Versionado vía [Changesets](https://github.com/changesets/changesets):

```bash
pnpm changeset          # añade entry de changelog
git push                # CI abre PR "Version Packages"; al mergearse, publica a npm
```

`@accesly/core` y `@accesly/react` están **linked** — siempre suben de versión juntos.

---

## Licencia

MIT © Accesly Core
