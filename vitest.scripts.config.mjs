import { defineConfig } from 'vitest/config';

/**
 * Vitest config for the helper scripts under `scripts/`.
 *
 * Kept separate from the per-package configs because:
 *  1. These tests live OUTSIDE any workspace package.
 *  2. The default per-workspace runner (`pnpm -r run test`) would skip them.
 *
 * Run via: `pnpm test:scripts` (also wired into `pnpm verify`).
 */
export default defineConfig({
  test: {
    include: ['scripts/__tests__/**/*.test.{mjs,ts}'],
    environment: 'node',
    globals: false,
  },
});
