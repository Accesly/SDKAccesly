/**
 * Authentication types shared between the Cognito wrapper, the session
 * storage abstraction, and the token manager.
 *
 * Cognito is the only production provider today (backend Fase 2 uses AWS
 * Cognito User Pool `us-east-1_K2Nag1tB1`), but the `AuthClient` interface
 * keeps the rest of the SDK provider-agnostic so we can swap or add providers
 * later without ripple changes.
 */

export interface AuthTokens {
  /** JWT idempotently identifying the user. Sent as `Authorization` header. */
  readonly idToken: string;
  /** JWT used for direct Cognito calls (e.g. global sign-out). */
  readonly accessToken: string;
  /** Long-lived token used to mint fresh idToken/accessToken. */
  readonly refreshToken: string;
  /** Absolute expiry of the idToken, in ms since epoch. */
  readonly expiresAt: number;
  /** Cognito username (always equal to the email for our pools). */
  readonly username: string;
}

export interface SignUpResult {
  readonly userSub: string;
  /** True if the user must confirm via the code sent over email. */
  readonly userConfirmed: boolean;
}

/**
 * Provider-agnostic authentication interface. Cognito is the current
 * implementation; future providers (Auth0, custom OAuth, etc.) must satisfy
 * the same shape.
 */
export interface AuthClient {
  signUp(email: string, password: string): Promise<SignUpResult>;
  confirmSignUp(email: string, code: string): Promise<void>;
  resendConfirmationCode(email: string): Promise<void>;
  /**
   * USER_SRP_AUTH on Cognito. The password never leaves the client in plain.
   */
  signIn(email: string, password: string): Promise<AuthTokens>;
  /**
   * Mints a new `idToken`/`accessToken` from a still-valid `refreshToken`.
   * The Cognito refresh flow requires the username, so we pass it explicitly.
   */
  refreshSession(refreshToken: string, username: string): Promise<AuthTokens>;
  /**
   * Global sign-out: revokes the refresh token at the IdP. Local session
   * clearing is the responsibility of the caller via `SessionStorage.clear`.
   */
  signOut(accessToken: string): Promise<void>;
  /**
   * Optional — federated sign-in via Google. Implementations sin Hosted UI
   * pueden omitirlo. Devuelve la URL a la que el caller debe redirigir el
   * browser; el SDK no fuerza window.location para mantener compat SSR.
   */
  getGoogleSignInUrl?(redirectUri: string): string;
  /**
   * Optional — intercambia el `code` retornado por la Hosted UI (post-redirect
   * desde Google) por `AuthTokens`. Implementaciones sin OAuth pueden
   * omitirlo. El `redirectUri` debe ser EXACTAMENTE el mismo pasado a
   * `getGoogleSignInUrl()` (OAuth spec).
   */
  exchangeCodeForTokens?(code: string, redirectUri: string): Promise<AuthTokens>;
}
