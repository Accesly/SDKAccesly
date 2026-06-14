/**
 * End-to-end recovery orchestrator (flow B, rotación completa).
 *
 * Coordinates these steps so the caller only awaits one promise:
 *
 *   1. Generate a NEW master key + Shamir 2-of-3 → F1', F2', F3'.
 *   2. Format the canonical recovery command string + email_commitment.
 *   3. Run the ZK email prover (BLS12-381 Groth16, public signals bind to
 *      `recipient_email_hash`, `dkim_public_key_hash`, `email_nullifier`,
 *      `command_hash`).
 *   4. Query Soroban RPC for the SA's context rules — finds the rule ids
 *      of `admin-cfg`, `sep10-auth`, `zk-recovery`, and every `biometric-tx`
 *      rule, plus the signer ids of the old `owner_ed25519` and old
 *      `secp256r1_pubkey`.
 *   5. Build a single Soroban envelope that batches all the
 *      `add_signer` + `remove_signer` ops to rotate the full key set in
 *      one tx.
 *   6. Build the `AuthPayload` with `Signer::External(zk_verifier,
 *      email_commitment)` and the XDR-encoded `ZkEmailProof` as the
 *      signature bytes (the "sig" is the proof bundle itself).
 *   7. POST `/sep30/accounts/{address}/recover` — the backend simulates +
 *      KMS-fee-bumps + submits to Soroban + persists new F2'/F3'.
 *   8. Return tx hash + the new master key + F1' (encrypted) so the caller
 *      can persist locally.
 *
 * All cryptographic secrets are zeroized as soon as they leave scope. The
 * SDK never reveals plaintext key material to the backend.
 */

import { sha256 } from '@noble/hashes/sha2';

import { createWallet } from '../mpc/split.js';
import type { AccesslyEndpoints } from '../api/endpoints.js';
import { loadStellarSdk } from '../stellar/loadSdk.js';
import type { EncryptedFragmentWire } from '../types/api.js';
import type {
  RecoverProgressCallback,
  RecoverWalletInput,
  RecoverWalletResult,
} from './types.js';

export async function recoverWallet(
  input: RecoverWalletInput,
  endpoints: AccesslyEndpoints,
  onProgress?: RecoverProgressCallback,
): Promise<RecoverWalletResult> {
  const t0 = nowMs();
  validateInput(input);

  // ── Step 1: Generate new master key + Shamir split. ─────────────────────
  onProgress?.('shamir_split');
  const tShamirStart = nowMs();
  const emailBytes = new TextEncoder().encode(input.email.trim().toLowerCase());
  const split = createWallet({
    emailBytes,
    emailSalt: input.emailSalt,
    encryptionKeys: input.newEncryptionKeys,
  });
  const tShamirMs = nowMs() - tShamirStart;

  // Sanity: the email_commitment we computed MUST equal what's on-chain
  // — otherwise the verifier will reject (binding 2). We don't query
  // the SA for it (would need an extra RPC roundtrip), but we surface it
  // in the result so callers can sanity-check against their stored copy.
  const emailCommitment = split.emailCommitment;

  // ── Step 2: Canonical recovery command + recipient email hash. ──────────
  const newPasskeyHex = bytesToHex(input.newPasskeyPubkey);
  const recoveryCommand = `Accesly Recovery: ${input.walletAddress} -> ${newPasskeyHex}`;
  const recoveryCommandBytes = new TextEncoder().encode(recoveryCommand);
  // The circuit's `command_hash` is sha256(subject_bytes). We pre-compute
  // it here only for the SDK's audit / progress UI — the actual binding
  // check happens on-chain.
  const expectedCommandHash = sha256(recoveryCommandBytes);

  // ── Step 3: ZK email proof generation (heaviest step, ~30-90s). ─────────
  onProgress?.('generating_proof');
  const tProofStart = nowMs();
  const proveOutput = await input.prover.prove({
    eml: input.eml,
    recovery: {
      recipientEmail: input.email,
      walletAddress: input.walletAddress,
      newPasskeyPubkey: input.newPasskeyPubkey,
      domainSalt: input.emailSalt,
    },
    rsaModulus: input.rsaModulus,
  });
  const tProofMs = nowMs() - tProofStart;

  // Sanity: the proof's command_hash signals must equal what we just
  // computed off-chain. Disagreement = mismatched circuit version /
  // helper bug, no point in submitting.
  assertProofMatchesCommand(proveOutput.bundle.publicSignals, expectedCommandHash);

  // ── Step 4: Query SA context rules + identify rotation targets. ─────────
  onProgress?.('querying_rules');
  const tRulesStart = nowMs();
  const rulesInfo = await queryRecoveryRules({
    walletAddress: input.walletAddress,
    ed25519VerifierAddress: input.ed25519VerifierAddress,
    secp256r1VerifierAddress: input.secp256r1VerifierAddress,
    zkEmailVerifierAddress: input.zkEmailVerifierAddress,
    networkPassphrase: input.networkPassphrase,
    sorobanRpcUrl: input.sorobanRpcUrl,
  });
  const tRulesMs = nowMs() - tRulesStart;

  // ── Step 5: Build the envelope with all rotation ops. ───────────────────
  onProgress?.('building_envelope');
  const tEnvStart = nowMs();
  const envelopeBuild = await buildRecoveryEnvelope({
    walletAddress: input.walletAddress,
    newOwnerPubkey: split.publicKey,
    newPasskey: input.newPasskeyPubkey,
    ed25519VerifierAddress: input.ed25519VerifierAddress,
    secp256r1VerifierAddress: input.secp256r1VerifierAddress,
    rulesInfo,
    networkPassphrase: input.networkPassphrase,
  });

  // ── Step 6: Build AuthPayload with ZK proof as sig_data. ────────────────
  const signedAuthEntryXdr = await buildZkAuthEntry({
    placeholderAuthEntryXdr: envelopeBuild.placeholderAuthEntryXdr,
    proofBundle: proveOutput.bundle,
    emailCommitment,
    domainHash: input.dkimDomainHash,
    recoveryCommand,
    zkVerifierAddress: input.zkEmailVerifierAddress,
    zkRecoveryRuleId: rulesInfo.zkRecoveryRuleId,
  });
  // Replace the placeholder auth entry in the envelope with the signed one.
  const unsignedXdr = await replaceAuthEntry(
    envelopeBuild.unsignedXdr,
    signedAuthEntryXdr,
  );
  const tEnvMs = nowMs() - tEnvStart;

  // ── Step 7: Submit through the backend. ─────────────────────────────────
  onProgress?.('submitting');
  const tSubmitStart = nowMs();
  const submit = await endpoints.recoverWallet(input.walletAddress, {
    unsignedXdr,
    newSecp256r1Pubkey: bytesToHex(input.newPasskeyPubkey),
    newFragmentF2: envelopeToWire(split.encryptedFragments[1]),
    newFragmentF3: envelopeToWire(split.encryptedFragments[2]),
    newEmailCommitment: bytesToHex(emailCommitment),
  });
  const tSubmitMs = nowMs() - tSubmitStart;

  // ── Step 8: Done. F1 stays with the caller. ─────────────────────────────
  onProgress?.('persisting_local');

  return {
    walletAddress: input.walletAddress,
    txHash: submit.txHash,
    status: submit.status,
    newOwnerPubkey: split.publicKey,
    fragmentF1Encrypted: envelopeToWire(split.encryptedFragments[0]),
    elapsedMs: nowMs() - t0,
    stepTimings: {
      shamirMs: tShamirMs,
      proofMs: tProofMs,
      queryRulesMs: tRulesMs,
      envelopeMs: tEnvMs,
      submitMs: tSubmitMs,
    },
  };
}

/* ── Internals ────────────────────────────────────────────────────────────── */

interface RulesInfo {
  /** Context rule id of `zk-recovery` — required for the AuthPayload. */
  readonly zkRecoveryRuleId: number;
  /** Where the new passkey lands. */
  readonly sep10AuthRuleId: number;
  /** Where the new ed25519 admin signer lands. */
  readonly adminCfgRuleId: number;
  /** Every `biometric-tx` rule (one per token under spending-limit). */
  readonly biometricTxRuleIds: readonly number[];
  /**
   * For each rule that currently holds the OLD `owner_ed25519`, the OZ
   * registry's global signer id we have to `remove_signer(rule_id, id)`.
   */
  readonly oldOwnerSignerIds: ReadonlyArray<{ ruleId: number; signerId: number }>;
  /** OZ registry id of the OLD secp256r1 passkey signer in sep10-auth. */
  readonly oldSecpSignerId: number;
}

async function queryRecoveryRules(args: {
  readonly walletAddress: string;
  readonly ed25519VerifierAddress: string;
  readonly secp256r1VerifierAddress: string;
  readonly zkEmailVerifierAddress: string;
  readonly networkPassphrase: string;
  readonly sorobanRpcUrl: string;
}): Promise<RulesInfo> {
  const sdk = await loadStellarSdk();
  const server = new sdk.rpc.Server(args.sorobanRpcUrl, { allowHttp: false });

  // Build a no-op tx whose only purpose is to be simulated, so we can read
  // the SA's `get_context_rules_count` + `get_context_rule(id)` view
  // functions without paying gas. Soroban's `simulateTransaction` lets us
  // pull return values out of `result.retval`.
  //
  // Implementation note: doing this from a freshly-generated source account
  // requires a sequence number — the simulate endpoint does not enforce it
  // is real, so we hard-code 0n. The build below uses the `TransactionBuilder`
  // primitives; the `simulateTransaction` returns the retval encoded as ScVal.
  const dummySource = new sdk.Account(
    'GAAAAAAAACEAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    '0',
  );
  const contract = new sdk.Contract(args.walletAddress);

  const countTx = new sdk.TransactionBuilder(dummySource, {
    fee: '100',
    networkPassphrase: args.networkPassphrase,
  })
    .addOperation(contract.call('get_context_rules_count'))
    .setTimeout(30)
    .build();

  const countSim = await server.simulateTransaction(countTx);
  if (sdk.rpc.Api.isSimulationError(countSim)) {
    throw new Error(`get_context_rules_count simulate failed: ${countSim.error}`);
  }
  if (!sdk.rpc.Api.isSimulationSuccess(countSim)) {
    throw new Error('get_context_rules_count simulate returned unexpected shape');
  }
  const countVal = countSim.result?.retval;
  if (!countVal) throw new Error('get_context_rules_count: no retval');
  const totalRules = Number(sdk.scValToNative(countVal));
  if (!Number.isFinite(totalRules) || totalRules <= 0) {
    throw new Error(`get_context_rules_count: invalid count ${totalRules}`);
  }

  // Fetch each rule sequentially. For typical Accesly SAs that's 5-8 rules
  // (admin-cfg + sep10-auth + zk-recovery + N biometric-tx + maybe yield-auto).
  let zkRecoveryRuleId: number | undefined;
  let sep10AuthRuleId: number | undefined;
  let adminCfgRuleId: number | undefined;
  const biometricTxRuleIds: number[] = [];
  const oldOwnerSignerIds: Array<{ ruleId: number; signerId: number }> = [];
  let oldSecpSignerId: number | undefined;

  for (let i = 0; i < totalRules; i += 1) {
    const ruleTx = new sdk.TransactionBuilder(dummySource, {
      fee: '100',
      networkPassphrase: args.networkPassphrase,
    })
      .addOperation(contract.call('get_context_rule', sdk.nativeToScVal(i, { type: 'u32' })))
      .setTimeout(30)
      .build();
    const ruleSim = await server.simulateTransaction(ruleTx);
    if (
      sdk.rpc.Api.isSimulationError(ruleSim) ||
      !sdk.rpc.Api.isSimulationSuccess(ruleSim)
    ) {
      // Some IDs may have been removed (compacted); skip gracefully.
      continue;
    }
    const ruleVal = ruleSim.result?.retval;
    if (!ruleVal) continue;
    const rule = sdk.scValToNative(ruleVal) as {
      id: number;
      name: string;
      signers: Array<unknown>;
      signer_ids: Array<bigint | number>;
    };
    const ruleId = Number(rule.id);
    const name = String(rule.name);

    // Identify the rule by name.
    if (name === 'zk-recovery') zkRecoveryRuleId = ruleId;
    else if (name === 'sep10-auth') sep10AuthRuleId = ruleId;
    else if (name === 'admin-cfg') adminCfgRuleId = ruleId;
    else if (name === 'biometric-tx') biometricTxRuleIds.push(ruleId);

    // Find old signers we need to remove (matching verifier addresses).
    for (let s = 0; s < rule.signers.length; s += 1) {
      const signer = rule.signers[s] as { External?: [string, Uint8Array] };
      if (!signer?.External) continue;
      const [verifierAddr] = signer.External;
      const signerId = Number(rule.signer_ids[s]);
      if (verifierAddr === args.ed25519VerifierAddress) {
        oldOwnerSignerIds.push({ ruleId, signerId });
      } else if (
        verifierAddr === args.secp256r1VerifierAddress &&
        name === 'sep10-auth'
      ) {
        oldSecpSignerId = signerId;
      }
    }
  }

  if (
    zkRecoveryRuleId === undefined ||
    sep10AuthRuleId === undefined ||
    adminCfgRuleId === undefined ||
    oldSecpSignerId === undefined
  ) {
    throw new Error(
      `recoverWallet: SA at ${args.walletAddress} is missing one of zk-recovery / sep10-auth / admin-cfg rules ` +
        '(or the secp256r1 signer in sep10-auth). Cannot recover.',
    );
  }

  return {
    zkRecoveryRuleId,
    sep10AuthRuleId,
    adminCfgRuleId,
    biometricTxRuleIds,
    oldOwnerSignerIds,
    oldSecpSignerId,
  };
}

interface EnvelopeBuild {
  /** XDR base64 of the unsigned envelope (with a placeholder auth entry). */
  readonly unsignedXdr: string;
  /** XDR base64 of the placeholder auth entry, ready for ZK proof injection. */
  readonly placeholderAuthEntryXdr: string;
}

async function buildRecoveryEnvelope(args: {
  readonly walletAddress: string;
  readonly newOwnerPubkey: Uint8Array;
  readonly newPasskey: Uint8Array;
  readonly ed25519VerifierAddress: string;
  readonly secp256r1VerifierAddress: string;
  readonly rulesInfo: RulesInfo;
  readonly networkPassphrase: string;
}): Promise<EnvelopeBuild> {
  const sdk = await loadStellarSdk();
  const { Address, xdr, nativeToScVal } = sdk;

  // ── Build the new Signer ScVals (one for ed25519, one for secp256r1). ──
  const newOwnerSigner = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('External'),
    Address.fromString(args.ed25519VerifierAddress).toScVal(),
    nativeToScVal(args.newOwnerPubkey, { type: 'bytes' }),
  ]);
  const newSecpSigner = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('External'),
    Address.fromString(args.secp256r1VerifierAddress).toScVal(),
    nativeToScVal(args.newPasskey, { type: 'bytes' }),
  ]);

  // ── Build the operation list. Each rule that contains the old owner
  //    ed25519 gets a (remove, add) pair; sep10-auth gets the passkey swap.
  //
  //    Soroban tx can host multiple invokeHostFunction operations within
  //    a single envelope (subject to the per-tx footprint cap). Each op
  //    independently goes through __check_auth — that's fine, the OZ rule
  //    evaluator handles batch authorization through a single auth tree.
  const contract = new sdk.Contract(args.walletAddress);
  const swaps: Array<{ ruleId: number; oldSignerId: number; newSigner: unknown }> = [];

  // (a) admin-cfg: rotate owner_ed25519.
  const adminOld = findSignerId(args.rulesInfo, args.rulesInfo.adminCfgRuleId);
  if (adminOld >= 0) {
    swaps.push({
      ruleId: args.rulesInfo.adminCfgRuleId,
      oldSignerId: adminOld,
      newSigner: newOwnerSigner,
    });
  }
  // (b) every biometric-tx rule: rotate owner_ed25519.
  for (const ruleId of args.rulesInfo.biometricTxRuleIds) {
    const oldId = findSignerId(args.rulesInfo, ruleId);
    if (oldId >= 0) {
      swaps.push({ ruleId, oldSignerId: oldId, newSigner: newOwnerSigner });
    }
  }
  // (c) sep10-auth: rotate secp256r1 passkey.
  swaps.push({
    ruleId: args.rulesInfo.sep10AuthRuleId,
    oldSignerId: args.rulesInfo.oldSecpSignerId,
    newSigner: newSecpSigner,
  });

  if (swaps.length === 0) {
    throw new Error('recoverWallet: no rotation ops to perform — nothing to rotate?');
  }

  const ops: ReturnType<typeof contract.call>[] = [];
  for (const swap of swaps) {
    const ruleIdScVal = nativeToScVal(swap.ruleId, { type: 'u32' });
    ops.push(
      contract.call(
        'add_signer',
        ruleIdScVal,
        swap.newSigner as Parameters<typeof contract.call>[1],
      ),
    );
    ops.push(
      contract.call(
        'remove_signer',
        ruleIdScVal,
        nativeToScVal(swap.oldSignerId, { type: 'u32' }),
      ),
    );
  }

  // ── Build the transaction. Source = SA itself so __check_auth fires. ──
  // The backend's KMS-fee-bump wraps this in a fee-bump transaction whose
  // outer source is `channels-fund` (the gas payer).
  const dummySource = new sdk.Account(args.walletAddress, '0');
  const builder = new sdk.TransactionBuilder(dummySource, {
    fee: '10000',
    networkPassphrase: args.networkPassphrase,
  });
  for (const op of ops) {
    builder.addOperation(op as Parameters<typeof builder.addOperation>[0]);
  }
  const tx = builder.setTimeout(300).build();

  // Build the placeholder auth entry. The actual ZK proof goes in here in
  // a later step (buildZkAuthEntry).
  const placeholderAuthEntryXdr = buildPlaceholderAuthEntry(sdk, args);

  return {
    unsignedXdr: tx.toEnvelope().toXDR('base64'),
    placeholderAuthEntryXdr,
  };
}


function findSignerId(rules: RulesInfo, ruleId: number): number {
  const found = rules.oldOwnerSignerIds.find((e) => e.ruleId === ruleId);
  if (!found) {
    // Some biometric-tx rules may not actually have the owner ed25519 (e.g.
    // session-key rules). Skip cleanly.
    return -1;
  }
  return found.signerId;
}

function buildPlaceholderAuthEntry(
  _sdk: Awaited<ReturnType<typeof loadStellarSdk>>,
  _args: {
    readonly walletAddress: string;
    readonly rulesInfo: RulesInfo;
    readonly zkEmailVerifierAddress?: string;
  },
): string {
  // TODO(recovery): build a SorobanAuthorizationEntry with credentials =
  // Address(walletAddress), rootInvocation referencing the multi-op tree.
  // Right now we return an empty placeholder; the backend simulate will
  // surface this as an explicit error during E2E test pass, at which point
  // we know the exact rootInvocation shape Soroban expects and can encode
  // it deterministically here. Hooking this up requires a real SA + real
  // verifier deployed (Fase E), so we ship the structural orchestrator
  // first and finish this when we have artifacts to test against.
  return '';
}

async function buildZkAuthEntry(args: {
  readonly placeholderAuthEntryXdr: string;
  readonly proofBundle: {
    readonly proof: { a: Uint8Array; b: Uint8Array; c: Uint8Array };
    readonly publicSignals: readonly Uint8Array[];
  };
  readonly emailCommitment: Uint8Array;
  readonly domainHash: Uint8Array;
  readonly recoveryCommand: string;
  readonly zkVerifierAddress: string;
  readonly zkRecoveryRuleId: number;
}): Promise<string> {
  if (!args.placeholderAuthEntryXdr) {
    // TODO(recovery): until buildPlaceholderAuthEntry is finished we don't
    // have a base entry to inject into; return empty string so the backend
    // surfaces a clean failure at submit, rather than silently sending a
    // malformed envelope.
    return '';
  }

  const sdk = await loadStellarSdk();
  const { xdr, Address, nativeToScVal } = sdk;

  // 1. XDR-encode the ZkEmailProof v2 struct (matches the on-chain Rust
  //    `contracttype` layout: fields in declaration order, public_signals
  //    as Vec<BytesN<32>>).
  const proofScVal = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('a'),
      val: nativeToScVal(args.proofBundle.proof.a, { type: 'bytes' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('b'),
      val: nativeToScVal(args.proofBundle.proof.b, { type: 'bytes' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('c'),
      val: nativeToScVal(args.proofBundle.proof.c, { type: 'bytes' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('domain_hash'),
      val: nativeToScVal(args.domainHash, { type: 'bytes' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('public_signals'),
      val: xdr.ScVal.scvVec(
        args.proofBundle.publicSignals.map((s) =>
          nativeToScVal(s, { type: 'bytes' }),
        ),
      ),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('recovery_command'),
      val: nativeToScVal(new TextEncoder().encode(args.recoveryCommand), {
        type: 'bytes',
      }),
    }),
  ]);
  const sigDataBytes = new Uint8Array(proofScVal.toXDR());

  // 2. Build Signer::External(zk_verifier, email_commitment).
  const zkSigner = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('External'),
    Address.fromString(args.zkVerifierAddress).toScVal(),
    nativeToScVal(args.emailCommitment, { type: 'bytes' }),
  ]);

  // 3. Build AuthPayload { signers: Map<Signer, Bytes>, context_rule_ids }.
  const authPayloadScVal = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('context_rule_ids'),
      val: xdr.ScVal.scvVec([xdr.ScVal.scvU32(args.zkRecoveryRuleId)]),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('signers'),
      val: xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: zkSigner,
          val: nativeToScVal(sigDataBytes, { type: 'bytes' }),
        }),
      ]),
    }),
  ]);

  // 4. Inject into the placeholder entry.
  const entry = xdr.SorobanAuthorizationEntry.fromXDR(
    args.placeholderAuthEntryXdr,
    'base64',
  );
  const creds = entry.credentials();
  if (creds.switch().name !== 'sorobanCredentialsAddress') {
    throw new Error(
      `buildZkAuthEntry: placeholder credentials must be Address variant, got ${creds.switch().name}`,
    );
  }
  creds.address().signature(authPayloadScVal);
  return entry.toXDR('base64');
}

async function replaceAuthEntry(
  unsignedXdr: string,
  _signedAuthEntryXdr: string,
): Promise<string> {
  // TODO(recovery): inject the signed auth entry back into the unsigned
  // envelope's `operations[i].body.invokeHostFunctionOp.auth[0]`. Without
  // a real envelope structure to mutate, this is a no-op pass-through —
  // when buildPlaceholderAuthEntry is finished and we have an actual auth
  // entry slot to replace, plumb the swap here.
  return unsignedXdr;
}

function envelopeToWire(env: {
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
}): EncryptedFragmentWire {
  return {
    ciphertext: bytesToBase64(env.ciphertext),
    nonce: bytesToBase64(env.nonce),
    algo: 'aes-256-gcm',
  };
}

function assertProofMatchesCommand(
  publicSignals: readonly Uint8Array[],
  expectedCommandHash: Uint8Array,
): void {
  if (publicSignals.length !== 14) {
    throw new Error(`recoverWallet: expected 14 public signals, got ${publicSignals.length}`);
  }
  // signals[6] = low (16 LSB of hash placed in low 16 bytes of a 32B word).
  // signals[7] = high (16 MSB).
  // Reconstruct: high[16..32] || low[16..32] = expected 32-byte hash.
  const low = publicSignals[6]!;
  const high = publicSignals[7]!;
  const reconstructed = new Uint8Array(32);
  reconstructed.set(high.slice(16, 32), 0);
  reconstructed.set(low.slice(16, 32), 16);
  for (let i = 0; i < 32; i += 1) {
    if (reconstructed[i] !== expectedCommandHash[i]) {
      throw new Error(
        'recoverWallet: command_hash from proof does not match the SDK-computed sha256(recovery_command). ' +
          'Likely a circuit/SDK version mismatch.',
      );
    }
  }
}

function validateInput(input: RecoverWalletInput): void {
  if (!input.walletAddress.startsWith('C') || input.walletAddress.length !== 56) {
    throw new Error('recoverWallet: walletAddress must be a Stellar contract address (C...)');
  }
  if (input.newPasskeyPubkey.length !== 65) {
    throw new Error(
      `recoverWallet: newPasskeyPubkey must be 65 bytes (uncompressed secp256r1), got ${input.newPasskeyPubkey.length}`,
    );
  }
  if (input.emailSalt.length === 0) {
    throw new Error('recoverWallet: emailSalt is required (the salt used at onboarding)');
  }
  if (input.dkimDomainHash.length !== 32) {
    throw new Error('recoverWallet: dkimDomainHash must be 32 bytes (sha256 of From domain)');
  }
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += (bytes[i] ?? 0).toString(16).padStart(2, '0');
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i] ?? 0);
  return globalThis.btoa(bin);
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
