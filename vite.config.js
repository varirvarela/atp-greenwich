// vite.config.js — Player app (primary build, deploys to GitHub Pages)
// Admin and companion have their own config files (vite.admin.config.js etc.)
// Run: npm run dev          → player app on localhost:5173
//      npm run dev:admin    → admin app on localhost:5174
//      npm run build        → builds player app to dist/ for GitHub Pages

import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  base: '/atp-greenwich/',   // must match GitHub Pages repo name
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@player': resolve(__dirname, 'src/player'),
    },
  },
  server: {
    port: 5173,
  },
  test: {
    globals: true,           // describe / it / expect available without importing
    environment: 'node',     // pure functions — no browser needed
    include: ['src/**/*.test.js'],
  },
});
