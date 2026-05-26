import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'crypto/index': 'src/crypto/index.ts',
    'mpc/index': 'src/mpc/index.ts',
    'auth/index': 'src/auth/index.ts',
    'api/index': 'src/api/index.ts',
    'webauthn/index': 'src/webauthn/index.ts',
    'stellar/index': 'src/stellar/index.ts',
  },
  external: ['@stellar/stellar-sdk'],
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
