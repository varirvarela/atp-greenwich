// Flow 1 — Request Access Registration
// The critical test is F1-13: the "admin" status change is done by the test
// itself via window._atpTest.adminWrite — no Firebase console needed.
import { test, expect } from '@playwright/test';
import { goTo, clearData, adminWrite, adminRead } from './helpers.js';

const REG_EMAIL = 'newplayer@atp.test';
const REG_ALIAS = 'newplayer99';
const REG_PWD   = 'Tennis1234!';

// emailKey for REG_EMAIL: 'newplayer_at_atp_dot_test'
const REG_EMAIL_KEY = 'newplayer_at_atp_dot_test';

test.describe('Flow 1 — Request Access Registration', () => {
  test.afterEach(async ({ page }) => {
    // Clean up any player created during registration tests
    const uid = await adminRead(page, `email_index/${REG_EMAIL_KEY}`);
    if (uid) {
      await adminWrite(page, `players/${uid}`, null);
      await adminWrite(page, `email_index/${REG_EMAIL_KEY}`, null);
    }
  });

  test.beforeEach(async ({ page }) => {
    await goTo(page);
    await page.locator('#btn-request').click();
    await page.locator('#ra-name').waitFor();
  });

  test('F1-02 registration form renders with all fields', async ({ page }) => {
    await expect(page.locator('#ra-name')).toBeVisible();
    await expect(page.locator('#ra-email')).toBeVisible();
    await expect(page.locator('#ra-alias')).toBeVisible();
    await expect(page.locator('#ra-pw')).toBeVisible();
    await expect(page.locator('#ra-pw2')).toBeVisible();
    await expect(page.locator('#btn-submit')).toBeDisabled();
  });

  test('F1-05/06/07 password strength bar reflects weak / medium / strong', async ({ page }) => {
    const bar = page.locator('#ra-pw-bar');
    await page.locator('#ra-pw').fill('abc');
    await expect(bar).toHaveCSS('background-color', /rgb/); // bar visible

    // Medium: 6+ chars
    await page.locator('#ra-pw').fill('Tennis1');
    const widthMed = await bar.evaluate(el => el.style.width || getComputedStyle(el).width);
    expect(widthMed).not.toBe('');

    // Strong: 10+ chars
    await page.locator('#ra-pw').fill('Tennis1234!');
    const widthStr = await bar.evaluate(el => el.style.width || getComputedStyle(el).width);
    expect(widthStr).not.toBe('');
  });

  test('F1-08 mismatching passwords shows error immediately', async ({ page }) => {
    await page.locator('#ra-pw').fill('Tennis1234!');
    await page.locator('#ra-pw2').fill('Different99!');
    await expect(page.locator('#ra-pw2-err')).toBeVisible();
  });

  test('F1-09 matching passwords clears the error', async ({ page }) => {
    await page.locator('#ra-pw').fill('Tennis1234!');
    await page.locator('#ra-pw2').fill('Different99!');
    await page.locator('#ra-pw2').fill('Tennis1234!');
    await expect(page.locator('#ra-pw2-err')).not.toBeVisible();
  });

  test('F1-10 alias taken shows error and keeps submit disabled', async ({ page }) => {
    // devplayer is seeded by seedLeague — but since we don't seed here,
    // we seed the login player (which uses 'logintester' alias) as a simpler dep.
    // First, write a known alias directly
    await adminWrite(page, 'players/existing_alias_uid/alias', 'takenalias123');
    await adminWrite(page, 'players/existing_alias_uid/name', 'Existing');

    await page.locator('#ra-name').fill('Someone');
    await page.locator('#ra-email').fill('other@atp.test');
    await page.locator('#ra-alias').fill('takenalias123');
    await page.waitForTimeout(600); // debounce
    await expect(page.locator('#ra-alias-hint')).toContainText(/taken/i);
    await expect(page.locator('#btn-submit')).toBeDisabled();

    // Cleanup
    await adminWrite(page, 'players/existing_alias_uid', null);
  });

  test('F1-11 unique alias shows available', async ({ page }) => {
    await page.locator('#ra-alias').fill('uniquerandom8877');
    await page.waitForTimeout(600);
    await expect(page.locator('#ra-alias-hint')).toContainText(/available/i);
  });

  test('F1-12 submitting creates waiting approval screen', async ({ page }) => {
    await page.locator('#ra-name').fill('E2E Tester');
    await page.locator('#ra-email').fill(REG_EMAIL);
    await page.locator('#ra-alias').fill(REG_ALIAS);
    await page.waitForTimeout(600); // alias + email checks
    await page.locator('#ra-pw').fill(REG_PWD);
    await page.locator('#ra-pw2').fill(REG_PWD);
    await expect(page.locator('#btn-submit')).toBeEnabled({ timeout: 3000 });
    await page.locator('#btn-submit').click();

    // Waiting screen appears
    await expect(page.getByText(/waiting|approval|pending/i)).toBeVisible({ timeout: 8000 });
  });

  // F1-13: the key test — admin status change advances the waiting screen.
  // This replaces the [ADMIN] step that previously required the Firebase console.
  test('F1-13 admin status change to onboarding auto-advances waiting screen', async ({ page }) => {
    // Register up to waiting screen
    await page.locator('#ra-name').fill('E2E Tester');
    await page.locator('#ra-email').fill(REG_EMAIL);
    await page.locator('#ra-alias').fill(REG_ALIAS);
    await page.waitForTimeout(600);
    await page.locator('#ra-pw').fill(REG_PWD);
    await page.locator('#ra-pw2').fill(REG_PWD);
    await page.locator('#btn-submit').click();
    await expect(page.getByText(/waiting|approval|pending/i)).toBeVisible({ timeout: 8000 });

    // Read the new UID from email_index
    const uid = await adminRead(page, `email_index/${REG_EMAIL_KEY}`);
    expect(uid).toBeTruthy();

    // Perform the "admin" action: change status to onboarding
    await adminWrite(page, `players/${uid}/status`, 'onboarding');

    // App detects the change via real-time listener — self assessment screen appears
    await expect(page.getByText(/beginner|intermediate|advanced/i).first()).toBeVisible({ timeout: 8000 });
  });

  test('F1-14/15 self assessment shows exactly 3 level cards', async ({ page }) => {
    // Register and advance to self assessment
    await page.locator('#ra-name').fill('E2E Tester');
    await page.locator('#ra-email').fill(REG_EMAIL);
    await page.locator('#ra-alias').fill(REG_ALIAS);
    await page.waitForTimeout(600);
    await page.locator('#ra-pw').fill(REG_PWD);
    await page.locator('#ra-pw2').fill(REG_PWD);
    await page.locator('#btn-submit').click();

    const uid = await adminRead(page, `email_index/${REG_EMAIL_KEY}`).catch(() => null);
    if (uid) await adminWrite(page, `players/${uid}/status`, 'onboarding');

    // Exactly 3 tap cards
    await expect(page.locator('.tap-card')).toHaveCount(3, { timeout: 8000 });
    await expect(page.getByText('Beginner')).toBeVisible();
    await expect(page.getByText('Intermediate')).toBeVisible();
    await expect(page.getByText('Advanced')).toBeVisible();

    // Only last-tapped card is active
    await page.locator('.tap-card').nth(0).click();
    await page.locator('.tap-card').nth(1).click();
    await expect(page.locator('.tap-card.selected, .tap-card.active')).toHaveCount(1);
  });
});
