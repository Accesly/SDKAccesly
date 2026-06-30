/**
 * Errores específicos del adapter React. Los errores de bajo nivel de la API
 * (WalletNotEnrolledError, GAddressNotBootstrappedError, etc.) viven en
 * `@accesly/core`. Esta clase vive acá porque la dispara `wallet.bootstrap`,
 * que es estrictamente high-level del React adapter.
 */

/**
 * Tirado por `wallet.bootstrap` cuando el backend YA tiene una wallet
 * registrada para el usuario Cognito actual pero el dispositivo NO tiene
 * el `CredentialRecord` local correspondiente (e.g. browser nuevo, IDB
 * borrada, otro device).
 *
 * Si dejáramos pasar el bootstrap, el SDK guardaría un credential local
 * con un nuevo passkey/PRF cuyos fragments NO pueden firmar para la wallet
 * que ya existe on-chain (sus signers están atados al passkey ORIGINAL).
 * El resultado sería un swap/send que truena con `aes/gcm` o
 * "derived public key does not match expected".
 *
 * El UI debe redirigir al user a `<RecoveryFlow>` — recovery genera un
 * nuevo passkey + rota la signer on-chain + reescribe los fragments
 * backend, dejando todo consistent.
 */
export class WalletAlreadyExistsError extends Error {
  readonly walletAddress: string;

  constructor(message: string, walletAddress: string) {
    super(message);
    this.name = 'WalletAlreadyExistsError';
    this.walletAddress = walletAddress;
  }
}
