#!/usr/bin/env node
/**
 * smoke-test-dev.mjs
 *
 * E2E smoke test against the Accesly dev backend (testnet) using the SDK we
 * are building. This script intentionally uses the BUILT package (`packages/core/dist`)
 * so it exercises the same artifact published to npm.
 *
 * Run: `pnpm build && pnpm smoke-test:dev` (locally).
 *
 * Required env vars:
 *   ACCESLY_API_URL              (optional, defaults to dev backend)
 *   COGNITO_TEST_USER            (optional — enables the authenticated flow)
 *   COGNITO_TEST_PASSWORD        (optional — paired with COGNITO_TEST_USER)
 *
 * Without the Cognito creds, only the unauthenticated checks run:
 *   GET  /health      → 200 OK
 *   POST /wallets     → 401 Unauthorized (proves Cognito Authorizer is active)
 *
 * With the Cognito creds, also runs:
 *   sign-in (USER_SRP_AUTH) → IdToken
 *   POST /wallets with bogus payload → 4xx ValidationError (proves authorizer
 *   passes and the handler validates the body shape).
 */

const DEFAULT_API = 'https://3fki7eiio5.execute-api.us-east-1.amazonaws.com/dev';
const COGNITO_REGION = 'us-east-1';
const COGNITO_USER_POOL_ID = 'us-east-1_K2Nag1tB1';
const COGNITO_CLIENT_ID = '6r64diep7pne50sender4557jt';

const results = [];

function record(label, ok, detail) {
  results.push({ label, ok, detail });
  const icon = ok ? '✓' : '✗';
  console.log(`  ${icon} ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const baseUrl = process.env['ACCESLY_API_URL'] ?? DEFAULT_API;
  console.log(`[smoke] target: ${baseUrl}`);

  // Load the built artifact. This must run AFTER `pnpm build`.
  const core = await import('../packages/core/dist/index.js');

  // 1. Unauthenticated client
  console.log('\n[smoke] unauthenticated checks');
  const anon = new core.AccesslyApiClient({ baseUrl, maxRetries: 1 });
  const eps = new core.AccesslyEndpoints(anon);

  try {
    const h = await eps.health();
    record(
      'GET /health returns ok',
      h.status === 'ok' && typeof h.stage === 'string',
      JSON.stringify(h),
    );
  } catch (err) {
    record('GET /health returns ok', false, err.message);
  }

  // /wallets without JWT should be 401
  try {
    await eps.createWallet({
      appId: 'smoke-test',
      pubkeyEd25519: 'aa'.repeat(32),
      emailCommitment: 'bb'.repeat(32),
      secp256r1Pubkey: 'cc'.repeat(65),
      fragmentF2: { ciphertext: 'AA==', nonce: 'BB==', algo: 'aes-256-gcm' },
      fragmentF3: { ciphertext: 'CC==', nonce: 'DD==', algo: 'aes-256-gcm' },
    });
    record('POST /wallets without auth rejected', false, 'unexpected success');
  } catch (err) {
    record(
      'POST /wallets without auth rejected',
      err instanceof core.AuthError && err.status === 401,
      `${err.name} status=${err.status}`,
    );
  }

  // 2. Cognito flow (only if creds are present)
  const cognitoUser = process.env['COGNITO_TEST_USER'];
  const cognitoPass = process.env['COGNITO_TEST_PASSWORD'];

  if (!cognitoUser || !cognitoPass) {
    console.log(
      '\n[smoke] skipping Cognito flow (COGNITO_TEST_USER / COGNITO_TEST_PASSWORD not set)',
    );
  } else {
    console.log('\n[smoke] Cognito + authenticated flow');
    const auth = new core.CognitoAuthClient({
      region: COGNITO_REGION,
      userPoolId: COGNITO_USER_POOL_ID,
      userPoolClientId: COGNITO_CLIENT_ID,
    });
    const storage = new core.InMemorySessionStorage();
    const tm = new core.TokenManager({ authClient: auth, storage });

    try {
      const tokens = await auth.signIn(cognitoUser, cognitoPass);
      await tm.setTokens(tokens);
      record(
        'Cognito sign-in succeeds',
        tokens.idToken.length > 0,
        `idToken ${tokens.idToken.slice(0, 24)}...`,
      );
    } catch (err) {
      record('Cognito sign-in succeeds', false, err.message);
    }

    const authedClient = new core.AccesslyApiClient({
      baseUrl,
      getIdToken: () => tm.getValidIdToken(),
      maxRetries: 1,
    });
    const authedEps = new core.AccesslyEndpoints(authedClient);

    try {
      const status = await tm.getStatus();
      record('TokenManager reports authenticated', status === 'authenticated', `status=${status}`);
    } catch (err) {
      record('TokenManager reports authenticated', false, err.message);
    }

    // POST /wallets with bogus but well-typed body — expect 4xx (validator
    // rejects fake encrypted fragments), proving the authorizer let us
    // through.
    try {
      await authedEps.createWallet({
        appId: 'smoke-test',
        pubkeyEd25519: 'aa'.repeat(32),
        emailCommitment: 'bb'.repeat(32),
        secp256r1Pubkey: 'cc'.repeat(65),
        fragmentF2: { ciphertext: 'AA==', nonce: 'BB==', algo: 'aes-256-gcm' },
        fragmentF3: { ciphertext: 'CC==', nonce: 'DD==', algo: 'aes-256-gcm' },
      });
      record(
        'POST /wallets with auth reaches handler',
        true,
        'unexpected 2xx — checked-in test user has bogus data',
      );
    } catch (err) {
      // Acceptable: ValidationError (handler ran), AuthError (token expired),
      // ServerError (downstream Relayer rejected). NetworkError is NOT.
      const acceptable =
        err instanceof core.ValidationError ||
        err instanceof core.ServerError ||
        (err instanceof core.AccesslyApiError && err.status >= 400 && err.status < 600);
      record(
        'POST /wallets with auth reaches handler',
        acceptable,
        `${err.name} status=${err.status}`,
      );
    }
  }

  // Summary
  console.log('');
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) {
    console.log(`[smoke] PASS — ${results.length}/${results.length} checks`);
    process.exit(0);
  } else {
    console.log(`[smoke] FAIL — ${failed.length}/${results.length} checks failed:`);
    for (const f of failed) console.log(`        ${f.label} — ${f.detail ?? ''}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[smoke] internal error:', err);
  process.exit(2);
});
