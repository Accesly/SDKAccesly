/**
 * `@accesly/react/kit` — prebuilt UI components for end-user wallet flows.
 *
 * The kit covers the screens in the mockup at
 * `DashboardAcceslyDev/Docs/Wallet Accesly.html`. Everything is opt-in: pull
 * the single component you need or `<WalletHome>` to bundle the lot.
 *
 * Every component reads the integrator's branding via `useBranding()` (CSS
 * variables) and the auth/feature config via `useAppConfig()`, so flipping
 * a toggle from `dev.accesly.xyz` propagates within the 60s refetch window.
 *
 * Components are intentionally headless-ish: they use CSS variables from
 * useBranding (`--accesly-primary`, `--accesly-secondary`, etc.) and the
 * integrator's Tailwind config — they do NOT impose a design system, just
 * sensible defaults you can override with `className` props.
 *
 * Usage:
 *   import { WalletHome } from '@accesly/react/kit';
 *
 *   <AcceslyProvider appId="…" env="dev">
 *     <WalletHome />
 *   </AcceslyProvider>
 */

export { AuthForm, type AuthFormProps } from './AuthForm.js';
export { BalanceCard, type BalanceCardProps } from './BalanceCard.js';
export { MovementsList, type MovementsListProps } from './MovementsList.js';
export { ReceiveFlow, type ReceiveFlowProps } from './ReceiveFlow.js';
export { SendFlow, type SendFlowProps } from './SendFlow.js';
export { AddFundsFlow, type AddFundsFlowProps, type FiatMethod } from './AddFundsFlow.js';
export { WalletHome, type WalletHomeProps } from './WalletHome.js';
export { ContactPicker, type ContactPickerProps } from './ContactPicker.js';
export { HandleShareCard, type HandleShareCardProps } from './HandleShareCard.js';
