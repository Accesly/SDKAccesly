# Security note: x402 payments from Accesly Smart Accounts (testnet)

Scope: the `@accesly/core/payments` module, the `x402-spending-policy` Soroban contract, the
testnet facilitator and F2 vault in `server/`, and the Opportuni pilot agent. Network: Stellar
testnet only. Written 25 Oct 2026.

## 1. Custody model

- **The master key never exists outside the customer's device.** It is generated client-side,
  split 2-of-3 with Shamir (`createWallet`), and each share is encrypted before it leaves the
  function. F1 stays on the device, F2 is stored by the vault, F3 is sealed with a key derived
  from the recovery password (PBKDF2, 600k iterations).
- **The vault only holds F2 ciphertext.** F2 is encrypted with a key that never leaves the
  device (passkey PRF in the web SDK; a local file in this Node example). A full compromise of
  the vault yields one encrypted share out of three.
- **Reconstruction is local and short-lived.** `reconstructKey` combines F1 + F2 for a single
  signature; the seed is zeroized as soon as the signature exists (`withZeroize`). The payments
  module never reconstructs keys itself: it receives a `loadSeed()` callback and is outside the
  `audit-no-custody` allowlist, which CI enforces.

## 2. What the customer signs

- The customer signs one `SorobanAuthorizationEntry` for a single SEP-41 `transfer(from = Smart
Account, to = payTo, amount)`. The signature covers the network id, the nonce, the expiration
  ledger (about 60 s) and the exact invocation, so the facilitator **cannot change the asset, the
  recipient or the amount, and cannot replay the entry** (the nonce is consumed on-chain).
- The signature goes inside the Smart Account `AuthPayload` (`Signer::External(ed25519_verifier,
pubkey)` plus `context_rule_ids`). It is verified by `__check_auth`, which also runs every
  policy attached to the selected context rule.

## 3. Facilitator trust

- The facilitator builds the final transaction, pays the fee and submits it. It can delay or
  refuse a payment; it cannot move funds the customer did not authorize.
- Verification (from `@x402/stellar`) requires a single `transfer` of the requested asset to the
  requested `payTo` for the requested amount, a successful simulation (where `__check_auth` and the
  policy run), and no contract events other than that `transfer`.
- The fee ceiling is configurable (`FACILITATOR_MAX_FEE_STROOPS`). On testnet the first payment
  through a rule cost 2.6 to 6 XLM (it creates the policy's storage entry and restores archived
  shared entries); every later payment cost about 0.002 XLM. The default ceiling of `@x402/stellar`
  (0.5 XLM) rejects that first payment, so the ceiling was raised.
- The resource server only settles after the agent answers with a status below 400, so a failed
  query is not charged (`withX402Payment` cancels the verified payment).

## 4. On-chain spending policy

`x402-spending-policy` extends OpenZeppelin Stellar Accounts (v0.7.1 `Policy` trait). Per (Smart
Account, context rule) it stores the token, a per-request cap, a monthly cap, a window length and
an allowlist. `enforce` rejects, in this order:

| Check                                                           | Error                       |
| --------------------------------------------------------------- | --------------------------- |
| Call is not `transfer` (e.g. `approve`, `transfer_from`)        | 10003 FunctionNotAllowed    |
| Contract is not the configured token                            | 10004 WrongToken            |
| `from` is not the Smart Account, or `to` is not a plain address | 10005 InvalidTransfer       |
| Amount ≤ 0                                                      | 10006 InvalidAmount         |
| Amount > per-request cap                                        | 10007 PerRequestCapExceeded |
| Recipient not in allowlist (an empty list rejects everything)   | 10008 RecipientNotAllowed   |
| Spent in window + amount > monthly cap                          | 10009 MonthlyCapExceeded    |

- Changing caps or the allowlist requires the Smart Account's own authorization, which goes
  through the `admin-cfg` rule (owner key, MPC 2-of-3 after email OTP).
- **Trade-off:** the monthly window is fixed, not rolling. Around a window boundary a customer can
  be charged up to twice the monthly cap within a short period. Cheaper storage and simpler logic
  were chosen over a rolling window.
- The policy emits no events, on purpose (see 6.1).

## 5. Session keys and email OTP

- The session key is a fresh ed25519 key that stays on the device. It is installed as its own
  context rule: `CallContract(USDC)`, one signer, the x402 policy, and `valid_until` (30 days).
  If it leaks, the attacker can only pay allowlisted recipients, within the caps, until expiry or
  until the owner removes the rule (`remove_context_rule`).
- Installing or changing the rule requires the owner key, which needs F2, which the vault only
  releases after an email OTP: 6 digits, 10-minute expiry, 5 attempts, HMAC-signed 10-minute
  release token.
- Known limits of the testnet vault: OTP state is in memory (lost on restart), there is no per-IP
  rate limit and it runs on a single node. `DEV_OTP_ECHO` returns the code in the HTTP response and
  exists only for local development; it is refused when `NODE_ENV=production` and is off on the
  deployed service.

## 6. Findings during the build

1. **OpenZeppelin's `spending_limit` policy is incompatible with x402.** It emits an event in
   `enforce`, and the x402 "exact" verification rejects any simulation with a contract event
   other than the `transfer` (`invalid_exact_stellar_payload_event_not_transfer`). This applies to
   every x402 facilitator, not just ours. MPC-signed x402 payments therefore go through a rule
   with `x402-spending-policy` (rule `x402-owner`), not through the existing `biometric-tx` rule.
2. **Testnet storage rent exceeds the uint32 fee field.** Restoring the archived Smart Account
   WASM cost about 1,348 XLM in resource fees, above the 429 XLM a normal transaction can declare.
   It works with a fee-bump transaction, because Soroban's `resourceFee` is int64.
3. **`@stellar/stellar-sdk` 16 in CommonJS needs Node ≥ 22.12** (`require` of ES modules).
   ESM consumers are unaffected.

## 7. Not covered

- The new policy contract has unit tests (25 passing) and on-chain rejection evidence, but **no
  third-party audit**.
- The testnet services on the Hetzner server replace AWS (Cognito, KMS, DynamoDB) for this
  demonstration only. They are not the production backend.
- The Node example keeps device material in a local file instead of IndexedDB plus a passkey PRF.
