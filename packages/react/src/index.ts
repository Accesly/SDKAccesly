/**
 * @accesly/react — React Provider + `useAccesly` hook.
 *
 * Wraps `@accesly/core` for React 18+. Apps integrate with:
 *
 *   import { AcceslyProvider, useAccesly } from '@accesly/react';
 *
 *   function App() {
 *     return (
 *       <AcceslyProvider appId="my-app" env="dev">
 *         <YourApp />
 *       </AcceslyProvider>
 *     );
 *   }
 *
 *   function Login() {
 *     const { auth } = useAccesly();
 *     return (
 *       <button onClick={() => auth.signIn(email, password)}>Sign in</button>
 *     );
 *   }
 */

export const REACT_ADAPTER_VERSION = '0.0.0';

export { AcceslyProvider, type AcceslyProviderProps } from './provider.js';
export {
  AcceslyContext,
  type AcceslyContextValue,
  type ZkEmailProverHandle,
} from './context.js';
export { ENVIRONMENT_DEFAULTS, type EnvironmentDefaults } from './config.js';
export {
  NotImplementedYetError,
  RecoveryNotAvailableError,
  useAccesly,
  type AcceslyHook,
  type AuthNamespace,
  type CreatedWalletInfo,
  type CreateWalletInput,
  type EnsureWalletResult,
  type KycNamespace,
  type RecoverInput,
  type RecoverResult,
  type RemoteWalletInfo,
  type ZkEmailProverLike,
  type RetryDeployResult,
  type SendXlmInput,
  type SendXlmResult,
  type SessionNamespace,
  type SettingsNamespace,
  type TxNamespace,
  type WalletNamespace,
  type WalletStatus,
  type YieldNamespace,
} from './hooks/useAccesly.js';
