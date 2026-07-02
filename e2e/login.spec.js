// Flow 3 — Login
// Uses the Firebase emulator via the Vite dev server started by playwright.config.js.
// Test player: testlogin@atp.test / Test1234! / alias: logintester
import { test, expect } from '@playwright/test';
import { goTo, clearData, seedLoginPlayer } from './helpers.js';

const TEST_EMAIL = 'testlogin@atp.test';
const TEST_ALIAS = 'logintester';
const TEST_PWD   = 'Test1234!';
const WRONG_PWD  = 'WrongPassword1';

test.describe('Flow 3 — Login', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await goTo(page);
    await seedLoginPlayer(page);
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await goTo(page);
    await clearData(page);
    await page.close();
  });

  test.beforeEach(async ({ page }) => {
    // Start from a clean session on the landing screen
    await goTo(page);
    await page.evaluate(() => localStorage.removeItem('atp_player_creds'));
    await page.reload();
    await page.locator('#btn-login').click();
    await page.locator('#li-email').waitFor();
  });

  test('F3-02 login screen shows email and password fields', async ({ page }) => {
    await expect(page.locator('#li-email')).toBeVisible();
    await expect(page.locator('#li-pw')).toBeVisible();
    await expect(page.locator('#btn-submit')).toBeVisible();
  });

  test('F3-03 correct email + correct password → app shell loads', async ({ page }) => {
    await page.locator('#li-email').fill(TEST_EMAIL);
    await page.locator('#li-pw').fill(TEST_PWD);
    await page.locator('#btn-submit').click();
    // App shell bottom nav appears
    await expect(page.locator('button[data-tab]').first()).toBeVisible({ timeout: 8000 });
  });

  test('F3-04 correct email + wrong password → error shown', async ({ page }) => {
    await page.locator('#li-email').fill(TEST_EMAIL);
    await page.locator('#li-pw').fill(WRONG_PWD);
    await page.locator('#btn-submit').click();
    await expect(page.locator('#li-err')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#li-err')).toContainText(/password/i);
  });

  test('F3-05 unknown email → error shown', async ({ page }) => {
    await page.locator('#li-email').fill('nobody@unknown.test');
    await page.locator('#li-pw').fill(TEST_PWD);
    await page.locator('#btn-submit').click();
    await expect(page.locator('#li-err')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#li-err')).toContainText(/not found/i);
  });

  test('F3-06 login with alias (not email) + correct password → app shell loads', async ({ page }) => {
    await page.locator('#li-email').fill(TEST_ALIAS);
    await page.locator('#li-pw').fill(TEST_PWD);
    await page.locator('#btn-submit').click();
    await expect(page.locator('button[data-tab]').first()).toBeVisible({ timeout: 8000 });
  });

  test('F3-07 pressing Enter in password field submits the form', async ({ page }) => {
    await page.locator('#li-email').fill(TEST_EMAIL);
    await page.locator('#li-pw').fill(TEST_PWD);
    await page.locator('#li-pw').press('Enter');
    await expect(page.locator('button[data-tab]').first()).toBeVisible({ timeout: 8000 });
  });
});
