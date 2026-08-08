import { defineConfig } from 'vite';
import { resolve } from 'path';

// Backend module bundle. Runs in an Electron utility-process (Node), loaded by
// the host's extensionBackendBootstrap. Node built-ins stay external;
// @nimbalyst/* imports are type-only and erased.
export default defineConfig({
  mode: 'production',
  build: {
    lib: {
      entry: resolve(__dirname, 'src/backend/index.ts'),
      formats: ['es'],
      fileName: () => 'backend.js',
    },
    rollupOptions: {
      external: [/^node:/, 'child_process', 'path', /^@nimbalyst\//],
      output: { inlineDynamicImports: true },
    },
    target: 'node18',
    // Do NOT wipe dist — the renderer build (vite.config.ts) runs first and
    // emits index.js into the same directory.
    emptyOutDir: false,
    outDir: 'dist',
    sourcemap: true,
    minify: false,
  },
});
