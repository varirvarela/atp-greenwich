// vite.admin.config.js — Admin app (local only, never deployed)
// Run: npm run dev:admin → localhost:5174

import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  base: '/',
  build: {
    outDir: 'dist-admin',
    rollupOptions: {
      input: {
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@admin': resolve(__dirname, 'src/admin'),
    },
  },
  server: {
    port: 5174,
  },
});
