// Flow: Walkthrough Tour
// Tests that the first-visit walkthrough modal appears, steps correctly, and respects
// the What's New modal so the two never overlap.
import { test, expect } from '@playwright/test';
import { goTo, jumpToApp } from './helpers.js';

const WALKTHROUGH_KEY = 'atp_walkthrough_done';
const SEEN_VERSION_KEY = 'atp_seen_version';

test.describe('Walkthrough Tour', () => {
  test.beforeEach(async ({ page }) => {
    await goTo(page);
    // Suppress What's New so it doesn't interfere (unless the test explicitly needs it).
    await page.evaluate(k => localStorage.setItem(k, '99.0.0'), SEEN_VERSION_KEY);
    // Remove walkthrough key so the tour fires on every test.
    await page.evaluate(k => localStorage.removeItem(k), WALKTHROUGH_KEY);
  });

  test('WT-01 first visit shows walkthrough modal with step-1 title', async ({ page }) => {
    await jumpToApp(page, { suppressWalkthrough: false });
    // The walkthrough fires after a 900 ms delay.
    const title = page.getByText('Welcome to ATP Greenwich');
    await expect(title).toBeVisible({ timeout: 3000 });
  });

  test('WT-02 Next → advances steps; step 3 (Feed) activates Feed nav', async ({ page }) => {
    await jumpToApp(page, { suppressWalkthrough: false });
    // Navigate away from Feed so the tab-switch is observable.
    await page.locator('button[data-tab="matches"]').click();

    // Wait for the walkthrough modal.
    await expect(page.getByText('Welcome to ATP Greenwich')).toBeVisible({ timeout: 3000 });

    // Step 0 → 1
    await page.locator('#btn-tour-next').click();
    await expect(page.getByText('Season & League')).toBeVisible();

    // Step 1 → 2 (Feed) — navigateFn activates the Feed tab.
    await page.locator('#btn-tour-next').click();
    await expect(page.getByText('Feed').first()).toBeVisible();

    // The Feed nav button should now carry the active class.
    const feedNav = page.locator('button[data-tab="feed"]');
    await expect(feedNav).toHaveClass(/active/, { timeout: 3000 });
  });

  test('WT-03 "Don\'t show again" closes modal and writes localStorage key', async ({ page }) => {
    await jumpToApp(page, { suppressWalkthrough: false });
    await expect(page.getByText('Welcome to ATP Greenwich')).toBeVisible({ timeout: 3000 });

    await page.locator('#btn-tour-dismiss').click();

    // Modal is gone.
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 3000 });

    // Key is persisted.
    const stored = await page.evaluate(k => localStorage.getItem(k), WALKTHROUGH_KEY);
    expect(stored).toBeTruthy();
  });

  test('WT-04 walkthrough does NOT appear when atp_walkthrough_done is already set', async ({ page }) => {
    await page.evaluate(k => localStorage.setItem(k, '1'), WALKTHROUGH_KEY);
    await jumpToApp(page, { suppressWalkthrough: false });

    // Wait well past the 900 ms delay — tour must NOT appear.
    await page.waitForTimeout(1500);
    await expect(page.getByText('Welcome to ATP Greenwich')).not.toBeVisible();
  });

  test('WT-05 walkthrough waits while What\'s New modal is open — they never overlap', async ({ page }) => {
    // Allow What's New to fire by simulating an old last-seen version.
    await page.evaluate(k => localStorage.setItem(k, '1.0.0'), SEEN_VERSION_KEY);

    await jumpToApp(page, { suppressWalkthrough: false });

    // What's New modal fires after 600 ms.
    const whatsNewBtn = page.locator('#btn-whats-new-close');
    await expect(whatsNewBtn).toBeVisible({ timeout: 3000 });

    // While What's New is open the walkthrough title must NOT be visible.
    await expect(page.getByText('Welcome to ATP Greenwich')).not.toBeVisible();

    // Close What's New — walkthrough should appear shortly after.
    await whatsNewBtn.click();
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 3000 });

    // Walkthrough fires after What's New closes (400 ms check + 300 ms poll interval).
    await expect(page.getByText('Welcome to ATP Greenwich')).toBeVisible({ timeout: 3000 });
  });
});
