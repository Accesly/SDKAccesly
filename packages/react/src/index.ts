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
export { AcceslyContext, type AcceslyContextValue } from './context.js';
export { ENVIRONMENT_DEFAULTS, type EnvironmentDefaults } from './config.js';
export {
  NotImplementedYetError,
  useAccesly,
  type AcceslyHook,
  type AuthNamespace,
  type BootstrapWalletInput,
  type CreatedWalletInfo,
  type CreateWalletInput,
  type EnsureWalletResult,
  type FinalizeRecoveryInput,
  type FinalizeRecoveryResult,
  type KycNamespace,
  type RecoveryNamespace,
  type ReconstructedSeed,
  type RemoteWalletInfo,
  type RetryDeployResult,
  type SendXlmInput,
  type SendXlmResult,
  type SessionNamespace,
  type SettingsNamespace,
  type TxNamespace,
  type UnlockedSigningMaterial,
  type WalletNamespace,
  type WalletStatus,
  type YieldNamespace,
} from './hooks/useAccesly.js';

export {
  useWalletStatus,
  type UseWalletStatusResult,
  type WalletStatusValue,
} from './hooks/useWalletStatus.js';
export { useBalance, type UseBalanceResult } from './hooks/useBalance.js';
export { useAppConfig, type UseAppConfigResult } from './hooks/useAppConfig.js';
export { useBranding, type UseBrandingResult } from './hooks/useBranding.js';
export {
  useWalletActivity,
  type UseWalletActivityOptions,
  type UseWalletActivityResult,
} from './hooks/useWalletActivity.js';
export {
  useWalletHistory,
  historyOptimisticPush,
  historyClearOptimistic,
  type UseWalletHistoryOptions,
  type UseWalletHistoryResult,
} from './hooks/useWalletHistory.js';
export {
  closeAllWalletSubscriptions,
  subscribeToWalletEvent,
  type WalletActivityItem,
  type WalletStreamActivityPayload,
  type WalletStreamBalancePayload,
  type WalletStreamEventType,
  type WalletStreamStatusPayload,
} from './hooks/walletSubscription.js';
