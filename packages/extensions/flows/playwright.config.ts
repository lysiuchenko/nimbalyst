import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * E2E for the flows extension.
 *
 * These specs launch the built Electron app themselves (see tests/helpers.ts),
 * so they need `packages/electron && npm run build` but no dev server and no
 * human — which is what lets them run in CI.
 *
 * Serial, never parallel: concurrent Electron instances fight over the
 * single-instance lock and the database.
 */
export default defineConfig({
  testDir: path.join(here, 'tests'),
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
});
