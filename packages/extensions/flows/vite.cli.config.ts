import { defineConfig } from 'vite';
import { resolve } from 'path';

// `nimbalyst-flows` CLI bundle. Plain Node, no Electron and no host — the
// headless path deliberately shares the runner with the in-app one.
export default defineConfig({
  mode: 'production',
  build: {
    lib: {
      entry: resolve(__dirname, 'src/headless/bin.ts'),
      formats: ['es'],
      fileName: () => 'nimbalyst-flows.js',
    },
    rollupOptions: {
      external: [/^node:/],
      output: {
        inlineDynamicImports: true,
        banner: '#!/usr/bin/env node',
      },
    },
    target: 'node18',
    // The renderer build runs first and owns dist/; don't wipe it.
    emptyOutDir: false,
    outDir: 'dist',
    sourcemap: true,
    minify: false,
  },
});
