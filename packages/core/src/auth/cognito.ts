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
}

export class CognitoAuthClient implements AuthClient {
  private readonly pool: CognitoUserPool;
  private readonly region: string;
  private readonly clientId: string;

  constructor(config: CognitoConfig) {
    if (!config.region) throw new TypeError('CognitoAuthClient: region is required');
    if (!config.userPoolId) throw new TypeError('CognitoAuthClient: userPoolId is required');
    if (!config.userPoolClientId)
      throw new TypeError('CognitoAuthClient: userPoolClientId is required');

    this.region = config.region;
    this.clientId = config.userPoolClientId;
    this.pool = new CognitoUserPool({
      UserPoolId: config.userPoolId,
      ClientId: config.userPoolClientId,
    });
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
