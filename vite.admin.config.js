// vite.admin.config.js — Admin app (local only, never deployed)
// Run: npm run dev:admin → localhost:5174

import { defineConfig } from 'vite';
import { resolve } from 'path';

// In dev mode Vite's SPA fallback serves index.html for any 404, so navigating
// to /atp-greenwich/admin/ would load the player app instead of admin.html.
// This plugin intercepts the base-path request and rewrites it to /admin.html
// so Vite serves the correct entry point for both the health-check and tests.
const adminFallbackPlugin = {
  name: 'admin-spa-fallback',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === '/atp-greenwich/admin/' || req.url === '/atp-greenwich/admin') {
        req.url = '/admin.html';
      }
      next();
    });
  },
};

export default defineConfig({
  root: '.',
  base: '/atp-greenwich/admin/',
  plugins: [adminFallbackPlugin],
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
      '@admin':  resolve(__dirname, 'src/admin'),
      '@player': resolve(__dirname, 'src/player'),
    },
  },
  server: {
    port: 5174,
  },
});
