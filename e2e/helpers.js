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
