import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'eml/index': 'src/eml/index.ts',
    'soroban/index': 'src/soroban/index.ts',
  },
  // snarkjs is huge (~3 MB) and ships its own wasm. Consumer bundles or
  // dynamic-import it so we never inline it into our build.
  external: ['snarkjs'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  minify: false,
  target: 'es2022',
  outDir: 'dist',
});
