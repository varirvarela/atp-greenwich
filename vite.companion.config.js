// vite.companion.config.js — Companion app (mobile admin PWA)
// Run: npm run dev:companion → localhost:5175

import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  base: '/',
  build: {
    outDir: 'dist-companion',
    rollupOptions: {
      input: {
        companion: resolve(__dirname, 'companion.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@shared':    resolve(__dirname, 'src/shared'),
      '@companion': resolve(__dirname, 'src/companion'),
      '@player':    resolve(__dirname, 'src/player'),
    },
  },
  server: {
    port: 5175,
  },
});
