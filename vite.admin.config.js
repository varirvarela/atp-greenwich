// vite.admin.config.js — Admin app (local only, never deployed)
// Run: npm run dev:admin → localhost:5174

import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

// Vite dev server with a non-root `base` redirects any request that doesn't
// start with the base back to the base path.  Rewriting req.url to '/admin.html'
// therefore triggers an infinite redirect loop.  Instead we read admin.html,
// run it through Vite's own HTML transform pipeline, and send the response
// ourselves — this way Vite's routing never sees the raw request.
const adminFallbackPlugin = {
  name: 'admin-spa-fallback',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.url === '/atp-greenwich/admin/' || req.url === '/atp-greenwich/admin') {
        try {
          const raw         = readFileSync(resolve(process.cwd(), 'admin.html'), 'utf-8');
          const transformed = await server.transformIndexHtml(req.url, raw);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(transformed);
        } catch (e) {
          next(e);
        }
        return;
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
