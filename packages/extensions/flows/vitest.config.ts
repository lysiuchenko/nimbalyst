import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    // `tests/` holds Playwright specs, which vitest cannot run.
    exclude: ['node_modules/**', 'dist/**', 'tests/**'],
  },
});
