/**
 * Helper that wraps `await import('@stellar/stellar-sdk')` to handle the
 * ESM/CJS interop quirk: some bundlers (Vite, esbuild bundling a UMD entry,
 * Webpack with `esModuleInterop: false`, etc.) end up wrapping the actual
 * module exports inside a `.default` property. Native Node 22 ESM does not,
 * which is why a working unit-test setup can ship a build that breaks in
 * the browser.
 *
 * This helper picks the "real" namespace whether it's at the top level
 * (`m.xdr`) or one level down (`m.default.xdr`). Type-erased on purpose —
 * we trust the caller to destructure correctly.
 */

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type StellarSdkModule = typeof import('@stellar/stellar-sdk');

export async function loadStellarSdk(): Promise<StellarSdkModule> {
  const mod = (await import('@stellar/stellar-sdk')) as unknown as
    | StellarSdkModule
    | { default: StellarSdkModule };
  // Heuristic: if the top-level namespace lacks `xdr` (a known stable export)
  // but `.default` has it, the bundler wrapped the CJS exports.
  if (
    !('xdr' in mod) &&
    (mod as { default?: StellarSdkModule }).default !== undefined &&
    'xdr' in ((mod as { default: StellarSdkModule }).default as object)
  ) {
    return (mod as { default: StellarSdkModule }).default;
  }
  return mod as StellarSdkModule;
}
