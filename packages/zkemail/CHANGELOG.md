# @accesly/zkemail

## 0.1.0

### Minor Changes

- feat: initial release de `@accesly/zkemail` — prover Groth16 para SEP-30 recovery

  Nuevo package en el monorepo. Browser client que toma un `.eml` con firma DKIM
  RFC 6376 y produce una proof Groth16 sobre BLS12-381 que el verifier desplegado
  en Soroban acepta como prueba de recovery (CAP-0064 + circuito Phase 5).

  Surface API:
  - `createZkEmailProver({ artifactsBaseUrl })` — singleton-ish con caché de los
    artifacts (wasm + zkey) descargados del CDN.
  - `prover.preload()` — pre-warm de los artifacts.
  - `prover.prove({ eml, recovery, rsaModulus })` — pipeline completo:
    parse + canonicalize headers (RFC 6376 §3.4.2 relaxed) → SHA-256 padding
    (FIPS 180-4 §5.1.1) → build circuit inputs (RSA limbs, signal indices,
    recovery context) → snarkjs Groth16 → formatear proof a bytes CAP-0064
    uncompressed listos para `BytesN<>::from_array`.
  - `prover.proveFromInputs(...)` — bypass del parser cuando ya tienes los
    signals listos (tests, replays).

  Dependencias:
  - `@noble/hashes` (SHA-256 puro).
  - `snarkjs` como `peerDependency` — el consumer la instala explícita; permite
    swap por una build optimizada sin tocar el package.

  Tests: 34 vitest cases verde sobre parsing/canonicalize/padding/format/load.
