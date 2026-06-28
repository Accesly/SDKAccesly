/**
 * AWS Cognito User Pool authentication via `amazon-cognito-identity-js`.
 *
 * Uses the USER_SRP_AUTH flow (the default for `authenticateUser`): the user
 * password is never sent in clear over the network — SRP exchanges proofs.
 *
 * Cognito SDK API is callback-based; this wrapper exposes promise-returning
 * methods that implement the `AuthClient` interface.
 */

import {
  AuthenticationDetails,
  CognitoRefreshToken,
  CognitoUser,
  CognitoUserAttribute,
  CognitoUserPool,
  type CognitoUserSession,
  type ISignUpResult,
} from 'amazon-cognito-identity-js';
import type { AuthClient, AuthTokens, SignUpResult } from './types.js';

export interface CognitoConfig {
  readonly region: string;
  readonly userPoolId: string;
  readonly userPoolClientId: string;
  /**
   * Cognito Hosted UI domain (sin trailing slash). Required para
   * `signInWithGoogle()` / federated identity providers. Si está vacío,
   * los métodos de Google throw.
   *
   * Ej: `https://accesly-dev.auth.us-east-1.amazoncognito.com`
   */
  readonly hostedUiDomain?: string;
}

export class CognitoAuthClient implements AuthClient {
  private readonly pool: CognitoUserPool;
  private readonly region: string;
  private readonly clientId: string;
  private readonly hostedUiDomain: string | undefined;

  constructor(config: CognitoConfig) {
    if (!config.region) throw new TypeError('CognitoAuthClient: region is required');
    if (!config.userPoolId) throw new TypeError('CognitoAuthClient: userPoolId is required');
    if (!config.userPoolClientId)
      throw new TypeError('CognitoAuthClient: userPoolClientId is required');

    this.region = config.region;
    this.clientId = config.userPoolClientId;
    this.hostedUiDomain = config.hostedUiDomain?.replace(/\/$/, '');
    this.pool = new CognitoUserPool({
      UserPoolId: config.userPoolId,
      ClientId: config.userPoolClientId,
    });
  }

  /**
   * Returns the Cognito Hosted UI URL that initiates "Sign in with Google"
   * federated auth. The caller should redirect the browser to this URL.
   *
   * Post-auth Cognito redirects to `redirectUri?code=xxx`. Pass that `code`
   * to `exchangeCodeForTokens(...)` to receive the `AuthTokens`.
   *
   * @param redirectUri MUST be in the Cognito App Client's `callbackUrls`.
   *                    Use one of the registered URLs (typically
   *                    `https://yourapp.com/auth/callback` or
   *                    `http://localhost:3000/auth/callback` for dev).
   */
  getGoogleSignInUrl(redirectUri: string): string {
    if (!this.hostedUiDomain) {
      throw new Error(
        'CognitoAuthClient: hostedUiDomain not configured — required for Google sign-in. ' +
          'Pass via Provider environment config.',
      );
    }
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      scope: 'openid email profile',
      redirect_uri: redirectUri,
      identity_provider: 'Google',
    });
    return `${this.hostedUiDomain}/oauth2/authorize?${params.toString()}`;
  }

  /**
   * Exchanges the `code` returned by the Cognito Hosted UI (after Google
   * federated login) for `AuthTokens` via the `/oauth2/token` endpoint.
   *
   * @param code         the `code` query param from the callback URL
   * @param redirectUri  EXACT same value passed to `getGoogleSignInUrl()`
   *                     (OAuth spec requires it on the token exchange).
   */
  async exchangeCodeForTokens(code: string, redirectUri: string): Promise<AuthTokens> {
    if (!this.hostedUiDomain) {
      throw new Error(
        'CognitoAuthClient: hostedUiDomain not configured — required for Google sign-in.',
      );
    }
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.clientId,
      code,
      redirect_uri: redirectUri,
    });
    const resp = await fetch(`${this.hostedUiDomain}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Cognito /oauth2/token returned ${resp.status}: ${text.slice(0, 300)}`);
    }
    const data = (await resp.json()) as {
      id_token?: string;
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!data.id_token || !data.access_token || !data.refresh_token || !data.expires_in) {
      throw new Error('Cognito /oauth2/token returned incomplete token set');
    }
    const username = usernameFromIdToken(data.id_token);
    return {
      idToken: data.id_token,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      username,
    };
  }

  signUp(email: string, password: string): Promise<SignUpResult> {
    return new Promise<SignUpResult>((resolve, reject) => {
      const attrs = [new CognitoUserAttribute({ Name: 'email', Value: email })];
      this.pool.signUp(email, password, attrs, [], (err, result) => {
        if (err) return reject(toError(err));
        const r = result as ISignUpResult | undefined;
        if (!r) return reject(new Error('Cognito signUp returned no result'));
        resolve({ userSub: r.userSub, userConfirmed: r.userConfirmed });
      });
    });
  }

  confirmSignUp(email: string, code: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const user = this.userFor(email);
      user.confirmRegistration(code, true, (err) => {
        if (err) return reject(toError(err));
        resolve();
      });
    });
  }

  resendConfirmationCode(email: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const user = this.userFor(email);
      user.resendConfirmationCode((err) => {
        if (err) return reject(toError(err));
        resolve();
      });
    });
  }

  signIn(email: string, password: string): Promise<AuthTokens> {
    return new Promise<AuthTokens>((resolve, reject) => {
      const user = this.userFor(email);
      const auth = new AuthenticationDetails({ Username: email, Password: password });
      user.authenticateUser(auth, {
        onSuccess: (session) => resolve(sessionToTokens(session, email)),
        onFailure: (err) => reject(toError(err)),
      });
    });
  }

  refreshSession(refreshToken: string, username: string): Promise<AuthTokens> {
    return new Promise<AuthTokens>((resolve, reject) => {
      const user = this.userFor(username);
      const token = new CognitoRefreshToken({ RefreshToken: refreshToken });
      user.refreshSession(token, (err, session) => {
        if (err) return reject(toError(err));
        if (!session) return reject(new Error('Cognito refreshSession returned no session'));
        resolve(sessionToTokens(session, username));
      });
    });
  }

  /**
   * Revokes the refresh token at Cognito via the
   * `AWSCognitoIdentityProviderService.RevokeToken` action. Local cache
   * clearing is the caller's responsibility (via `SessionStorage.clear`).
   *
   * `tokenToRevoke` is the refresh token, not the access token: only refresh
   * tokens can be revoked.
   */
  async signOut(tokenToRevoke: string): Promise<void> {
    const url = `https://cognito-idp.${this.region}.amazonaws.com/`;
    const body = JSON.stringify({ Token: tokenToRevoke, ClientId: this.clientId });
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.RevokeToken',
      },
      body,
    });
    if (!res.ok) {
      let detail = '';
      try {
        detail = await res.text();
      } catch {
        /* ignore */
      }
      throw new Error(`Cognito RevokeToken failed: ${res.status} ${detail}`);
    }
  }

  private userFor(username: string): CognitoUser {
    return new CognitoUser({ Username: username, Pool: this.pool });
  }
}

function sessionToTokens(session: CognitoUserSession, username: string): AuthTokens {
  const idTokenPayload = session.getIdToken();
  return {
    idToken: idTokenPayload.getJwtToken(),
    accessToken: session.getAccessToken().getJwtToken(),
    refreshToken: session.getRefreshToken().getToken(),
    expiresAt: idTokenPayload.getExpiration() * 1000,
    username,
  };
}

/**
 * Decode an id_token (JWT) payload and return the `email` (Cognito's default
 * username for our user pools) o `cognito:username` como fallback. Sin
 * verificar la firma — el caller acaba de recibirlo de un endpoint TLS de
 * Cognito y solo lee un claim. Para verificación, usar el JWKS endpoint.
 */
function usernameFromIdToken(idToken: string): string {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('id_token is not a valid JWT (no 3 parts)');
  const payloadB64 = parts[1]!;
  // base64url → base64
  const padded = payloadB64
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(payloadB64.length / 4) * 4, '=');
  const jsonStr =
    typeof atob === 'function' ? atob(padded) : Buffer.from(padded, 'base64').toString('utf-8');
  const claims = JSON.parse(jsonStr) as { email?: string; 'cognito:username'?: string };
  const username = claims.email ?? claims['cognito:username'];
  if (!username || typeof username !== 'string') {
    throw new Error('id_token claims missing both `email` and `cognito:username`');
  }
  return username;
}

function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === 'object' && err !== null) {
    const e = err as { message?: unknown; name?: unknown; code?: unknown };
    const message = typeof e.message === 'string' ? e.message : 'Cognito error';
    const out = new Error(message);
    if (typeof e.name === 'string') out.name = e.name;
    if (typeof e.code === 'string') (out as Error & { code?: string }).code = e.code;
    return out;
  }
  return new Error(String(err));
}
