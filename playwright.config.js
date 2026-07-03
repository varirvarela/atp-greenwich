import { defineConfig } from '@playwright/test';

// Playwright always uses:
//   port 5174 — dedicated Vite instance (separate from the user's dev server on 5173)
//   port 9000 — Firebase RTDB emulator (local, zero real-Firebase writes)
//
// Run:  npm run test:e2e
// The emulator and Vite server start automatically; stop with Ctrl-C.

export default defineConfig({
  testDir: './e2e',
  timeout: 25000,
  expect: { timeout: 7000 },
  fullyParallel: false,   // Firebase writes must be serial
  workers: 1,             // Spec files must not run in parallel — they share emulator state
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5174',
    viewport: { width: 390, height: 844 }, // iPhone 14 — mobile PWA
    headless: true,
    trace: 'on-first-retry',
  },
  webServer: [
    {
      // Firebase RTDB emulator — starts first, Vite connects to it on boot
      command: 'npm run emulator',
      url: 'http://127.0.0.1:9000/.json?ns=atp-greenwich',
      reuseExistingServer: !process.env.CI,
      timeout: 60000, // first CI run downloads the emulator JAR (~30 MB)
    },
    {
      // Vite dev server on port 5174 with emulator flag
      // VITE_USE_EMULATOR tells firebase.js to call connectDatabaseEmulator
      command: 'npm run dev -- --port 5174',
      url: 'http://localhost:5174/atp-greenwich/',
      reuseExistingServer: !process.env.CI,
      timeout: 20000,
      env: { VITE_USE_EMULATOR: 'true' },
    },
  ],
});
