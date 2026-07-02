// Flow 6 — Session Persistence & Sign Out
import { test, expect } from '@playwright/test';
import { goTo, seedData, clearData, jumpToApp } from './helpers.js';

test.describe('Flow 6 — Session Persistence & Sign Out', () => {
  // Dev player must exist in Firebase so the auth check on reload passes.
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await goTo(page);
    await clearData(page);
    await seedData(page);
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await goTo(page);
    await clearData(page);
    await page.close();
  });

  test('F6-01 app shell reloads without re-login when credentials are valid', async ({ page }) => {
    await goTo(page);
    await jumpToApp(page);

    await page.reload();
    await page.waitForFunction(() => typeof window._atpTest !== 'undefined', { timeout: 10000 });

    // Should land back in the app shell, not the landing screen
    await expect(page.locator('button[data-tab]').first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Request Access')).not.toBeVisible();
  });

  test('F6-02 tampered pwdHash redirects to landing screen', async ({ page }) => {
    await goTo(page);
    await jumpToApp(page);

    await page.evaluate(() => {
      const raw = localStorage.getItem('atp_player_creds');
      const creds = JSON.parse(raw);
      creds.pwdHash = 'tampered_value_xyz_99999';
      localStorage.setItem('atp_player_creds', JSON.stringify(creds));
    });

    await page.reload();
    await expect(page.getByText('Request Access')).toBeVisible({ timeout: 8000 });
  });

  test('F6-03 Sign Out button triggers a confirmation dialog', async ({ page }) => {
    await goTo(page);
    await jumpToApp(page);
    await page.locator('button[data-tab="profile"]').click();

    let dialogMessage = '';
    page.once('dialog', async dialog => {
      dialogMessage = dialog.message();
      await dialog.dismiss(); // dismiss — just checking the dialog appears
    });

    await page.locator('#btn-signout').click();
    expect(dialogMessage).toContain('Sign out of ATP Greenwich?');
  });

  test('F6-04 confirming sign out clears localStorage and shows landing screen', async ({ page }) => {
    await goTo(page);
    await jumpToApp(page);
    await page.locator('button[data-tab="profile"]').click();

    page.once('dialog', dialog => dialog.accept());
    await page.locator('#btn-signout').click();

    const stored = await page.evaluate(() => localStorage.getItem('atp_player_creds'));
    expect(stored).toBeNull();

    await expect(page.getByText('Request Access')).toBeVisible({ timeout: 5000 });
  });
});
