// Flow 4 — App Shell & Profile Tab
import { test, expect } from '@playwright/test';
import { goTo, jumpToApp } from './helpers.js';

test.describe('Flow 4 — App Shell & Profile Tab', () => {
  test.beforeEach(async ({ page }) => {
    await goTo(page);
    await jumpToApp(page);
  });

  test('F4-01 DEV badge visible in top bar', async ({ page }) => {
    await expect(page.getByText('DEV')).toBeVisible();
  });

  test('F4-02 Feed tab: loads without a Coming-in-Phase placeholder', async ({ page }) => {
    await page.locator('button[data-tab="feed"]').click();
    await expect(page.getByText(/Coming in Phase/i)).not.toBeVisible();
  });

  test('F4-02 Matches tab: loads without a Coming-in-Phase placeholder', async ({ page }) => {
    await page.locator('button[data-tab="matches"]').click();
    await expect(page.getByText(/Coming in Phase/i)).not.toBeVisible();
  });

  test('F4-02 Standings tab: loads without a Coming-in-Phase placeholder', async ({ page }) => {
    await page.locator('button[data-tab="standings"]').click();
    await expect(page.getByText(/Coming in Phase/i)).not.toBeVisible();
  });

  test('F4-02 Bracket tab: Phase 6 live — no Coming-in-Phase placeholder', async ({ page }) => {
    await page.locator('button[data-tab="bracket"]').click();
    await expect(page.getByText(/Coming in Phase/i)).not.toBeVisible();
  });

  test('F4-03 Profile tab: name, alias, ELO, and buttons present', async ({ page }) => {
    await page.locator('button[data-tab="profile"]').click();
    await expect(page.locator('.profile-name')).toContainText('Dev Player');
    await expect(page.locator('.profile-alias')).toContainText('@devplayer');
    await expect(page.locator('.elo-display')).toContainText('1220');
    await expect(page.locator('#btn-change-avatar')).toBeVisible();
    await expect(page.locator('#btn-signout')).toBeVisible();
  });

  test('F4-03 Profile tab: stats card present, Phase 4 placeholder gone', async ({ page }) => {
    await page.locator('button[data-tab="profile"]').click();
    await expect(page.getByText('Season Stats')).toBeVisible();
    await expect(page.getByText('Stats available in Phase 4')).not.toBeVisible();
  });
});
