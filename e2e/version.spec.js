// Flow 13 — App Version & What's New modal
import { test, expect } from '@playwright/test';
import { goTo, jumpToApp } from './helpers.js';

const SEEN_KEY = 'atp_seen_version';

test.describe('Flow 13 — App Version & What\'s New', () => {
  test.beforeEach(async ({ page }) => {
    await goTo(page);
  });

  // ─── Version display ─────────────────────────────────────────────────────────

  test('F13-01 version label visible in player top bar', async ({ page }) => {
    await jumpToApp(page);
    // Top bar shows "v1.2.0" (or current APP_VERSION)
    await expect(page.locator('.top-bar').getByText(/^v\d+\.\d+\.\d+$/)).toBeVisible();
  });

  test('F13-02 version label visible on login screen', async ({ page }) => {
    // Login screen is the default before jumpToApp — version should already be there
    await expect(page.getByText(/^v\d+\.\d+\.\d+$/)).toBeVisible();
  });

  // ─── What's New modal ────────────────────────────────────────────────────────

  test('F13-03 first install: no What\'s New modal, seen_version silently set', async ({ page }) => {
    // Clear any previous seen_version
    await page.evaluate(k => localStorage.removeItem(k), SEEN_KEY);
    await jumpToApp(page);
    // Wait past the 600ms modal delay — modal must NOT appear
    await page.waitForTimeout(1000);
    await expect(page.locator('#btn-whats-new-close')).not.toBeVisible();
    // But the key should now be set silently
    const stored = await page.evaluate(k => localStorage.getItem(k), SEEN_KEY);
    expect(stored).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('F13-04 upgrading from older version shows What\'s New modal', async ({ page }) => {
    // Simulate user who last opened app at v1.0.0
    await page.evaluate(k => localStorage.setItem(k, '1.0.0'), SEEN_KEY);
    await jumpToApp(page);
    // Modal fires after 600ms delay
    await expect(page.locator('#btn-whats-new-close')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.modal-sheet').getByText("What's New")).toBeVisible();
  });

  test('F13-04 What\'s New modal shows version badge', async ({ page }) => {
    await page.evaluate(k => localStorage.setItem(k, '1.0.0'), SEEN_KEY);
    await jumpToApp(page);
    await expect(page.locator('#btn-whats-new-close')).toBeVisible({ timeout: 3000 });
    // Version badge in modal header
    await expect(page.locator('.modal-sheet').getByText(/v\d+\.\d+\.\d+/)).toBeVisible();
  });

  test('F13-05 Got it button closes modal and updates seen_version', async ({ page }) => {
    await page.evaluate(k => localStorage.setItem(k, '1.0.0'), SEEN_KEY);
    await jumpToApp(page);
    await page.locator('#btn-whats-new-close').waitFor({ timeout: 3000 });
    await page.locator('#btn-whats-new-close').click();
    await expect(page.locator('.modal-overlay')).not.toBeVisible();
    // seen_version should now match current app version
    const stored = await page.evaluate(k => localStorage.getItem(k), SEEN_KEY);
    expect(stored).not.toBe('1.0.0');
    expect(stored).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('F13-06 no modal when seen_version matches current version', async ({ page }) => {
    // Read current APP_VERSION from the running app, then set seen to match
    await jumpToApp(page);
    // After first install the key is set silently — reload and confirm no modal
    await page.waitForTimeout(1000);
    const currentVersion = await page.evaluate(k => localStorage.getItem(k), SEEN_KEY);
    // Reload
    await goTo(page);
    await page.evaluate(
      ([k, v]) => localStorage.setItem(k, v),
      [SEEN_KEY, currentVersion],
    );
    await jumpToApp(page);
    await page.waitForTimeout(1000);
    await expect(page.locator('#btn-whats-new-close')).not.toBeVisible();
  });

  test('F13-07 clicking outside What\'s New modal closes it', async ({ page }) => {
    await page.evaluate(k => localStorage.setItem(k, '1.0.0'), SEEN_KEY);
    await jumpToApp(page);
    await page.locator('#btn-whats-new-close').waitFor({ timeout: 3000 });
    await page.locator('.modal-overlay').click({ position: { x: 10, y: 10 } });
    await expect(page.locator('.modal-overlay')).not.toBeVisible();
  });
});
