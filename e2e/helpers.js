// Shared helpers for ATP Greenwich Playwright e2e tests.
// All Firebase writes go to _dev/ prefix (DEV mode) — never touches production.

export const BASE = '/atp-greenwich/';

// Navigate to the app and wait until _atpTest helpers are available.
export async function goTo(page) {
  await page.goto(BASE);
  await page.waitForFunction(() => typeof window._atpTest !== 'undefined', { timeout: 10000 });
}

// Write dummy season/league/players/matches to _dev/ in Firebase.
export async function seedData(page) {
  await page.evaluate(() => window._atpTest.seedLeague());
}

// Nullify all _dev/ league data (preserves invite codes).
export async function clearData(page) {
  await page.evaluate(() => window._atpTest.clearLeague());
}

// Jump straight into the app shell as Dev Player (bypasses login).
// Waits for the bottom nav to appear before returning.
export async function jumpToApp(page) {
  await page.evaluate(() => window._atpTest.app());
  await page.locator('button[data-tab]').first().waitFor({ timeout: 5000 });
}

// Full reset + seed + jump — use in beforeEach for tests that modify data.
export async function freshStart(page) {
  await clearData(page);
  await seedData(page);
  await jumpToApp(page);
}

// ─── Emulator admin helpers ───────────────────────────────────────────────────
// These call window._atpTest helpers which use the Firebase SDK pointed at the
// emulator. Path must NOT include the _dev/ prefix — DEV_ROOT adds it.

// Write a value to an arbitrary Firebase path (bypasses security rules in emulator).
export async function adminWrite(page, path, value) {
  await page.evaluate(({ p, v }) => window._atpTest.adminWrite(p, v), { p: path, v: value });
}

// Read a value from an arbitrary Firebase path.
export async function adminRead(page, path) {
  return page.evaluate((p) => window._atpTest.adminRead(p), path);
}

// Seed invite codes TEST-1234 (unused) and USED-9999 (used).
export async function seedTestCodes(page) {
  await page.evaluate(() => window._atpTest.seedTestData());
}

// Seed a real player for login flow tests.
// Credentials: testlogin@atp.test / Test1234!  alias: logintester
export async function seedLoginPlayer(page) {
  await page.evaluate(() => window._atpTest.seedLoginPlayer());
}

// ─── Admin app helpers ────────────────────────────────────────────────────────
// Admin app runs on port 5175 (separate Vite instance).
// window._atpTest is NOT available there — all Firebase writes must go via
// a player-app page (port 5174) using adminWrite() above.

export const ADMIN_ORIGIN = 'http://localhost:5175';
export const ADMIN_BASE   = ADMIN_ORIGIN + '/atp-greenwich/admin/';

// Navigate to the admin app and wait for either the login form or the shell.
export async function goToAdmin(page) {
  await page.goto(ADMIN_BASE);
  await Promise.race([
    page.locator('#admin-pwd').waitFor({ state: 'visible', timeout: 10000 }),
    page.locator('#admin-content').waitFor({ state: 'visible', timeout: 10000 }),
  ]);
}

// Navigate to admin app and log in with the default shared password if needed.
// The dev-player auto-login is skipped because pwdHash === 'dev' is guarded.
export async function adminAppLogin(page) {
  await goToAdmin(page);
  const pwdInput = page.locator('#admin-pwd');
  if (await pwdInput.isVisible()) {
    await pwdInput.fill('atpgreenwich2026');
    await page.locator('#btn-admin-login').click();
    await page.locator('#admin-content').waitFor({ state: 'visible', timeout: 6000 });
  }
}

// Click a nav item in the admin sidebar; opens hamburger first on mobile layout.
export async function adminNavTo(page, section) {
  const hamburger = page.locator('#btn-hamburger');
  const navItem   = page.locator(`.admin-nav-item[data-section="${section}"]`);
  if (await hamburger.isVisible()) {
    await hamburger.click();
    await navItem.waitFor({ state: 'visible', timeout: 3000 });
  }
  await navItem.click();
}

// Open the admin sidebar hamburger (mobile) so sidebar items are visible.
export async function openAdminSidebar(page) {
  const hamburger = page.locator('#btn-hamburger');
  if (await hamburger.isVisible()) {
    await hamburger.click();
    await page.locator('.admin-nav-item').first().waitFor({ state: 'visible', timeout: 3000 });
  }
}
