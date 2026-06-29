import { defineConfig } from 'tsup';

/**
 * Two-config setup so the ESM build can split shared chunks (AcceslyContext,
 * hooks) between `index` and `kit` entries. Without splitting, each subpath
 * has its OWN copy of AcceslyContext — and React contexts are identified by
 * object reference, so a hook from `@accesly/react/kit` could not read the
 * context populated by `<AcceslyProvider>` from `@accesly/react`. That broke
 * `<AuthForm>` and friends when consumed from the kit subpath.
 *
 * CJS keeps `splitting: false` because tsup/esbuild does not support code
 * splitting for CJS output (would create a circular require). CJS consumers
 * pay the duplication cost — acceptable trade-off because most modern apps
 * (Next, Vite, etc.) prefer ESM and consumers using `require('@accesly/react/kit')`
 * are unlikely to also import `@accesly/react` from the same process tree.
 */
export default defineConfig([
  {
    entry: { index: 'src/index.ts', kit: 'src/kit/index.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: true,
    treeshake: true,
    minify: false,
    target: 'es2022',
    outDir: 'dist',
    external: ['react', 'react-dom', '@accesly/core'],
  },
  {
    entry: { index: 'src/index.ts', kit: 'src/kit/index.ts' },
    format: ['cjs'],
    dts: false, // dts already emitted by ESM build
    sourcemap: true,
    clean: false,
    splitting: false,
    treeshake: true,
    minify: false,
    target: 'es2022',
    outDir: 'dist',
    external: ['react', 'react-dom', '@accesly/core'],
  },
]);
