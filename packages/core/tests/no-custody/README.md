# No-custody tests

CI-blocking tests that verify the core non-custodial premise: the user's master
key is never exposed outside the device. These tests complement
`scripts/audit-no-custody.mjs` (which scans source code statically) by running
the actual primitives and asserting their runtime behaviour.

If any test here fails, the SDK is no longer non-custodial. Do not merge.

Files:

1. `keypair-stays-local.test.ts` — `createWallet` output never contains the raw seed.
2. `shamir-needs-two-shares.test.ts` — a single Shamir share cannot reconstruct the seed.
3. `zeroize-after-sign.test.ts` — sensitive buffers are zeroed after signing.
4. `no-plaintext-storage.test.ts` — `localStorage`/`sessionStorage`/`indexedDB` are never touched with plaintext seed.
5. `no-console-leak.test.ts` — `console.*` never logs the seed in any code path, success or error.
