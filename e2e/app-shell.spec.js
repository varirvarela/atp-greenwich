// Flow 4 — App Shell & Profile Tab
import { test, expect } from '@playwright/test';
import { goTo, jumpToApp } from './helpers.js';

test.describe('Flow 4 — App Shell & Profile Tab', () => {
  test.beforeEach(async ({ page }) => {
    await goTo(page);
    await jumpToApp(page);
  });

  test('F4-01 DEV badge visible in version footer', async ({ page }) => {
    await expect(page.locator('.app-version-footer').getByText('DEV')).toBeVisible();
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

  test('F4-04 "How ELO works" accordion is visible on the Profile tab', async ({ page }) => {
    await page.locator('button[data-tab="profile"]').click();
    // The <summary> element contains the accordion label.
    await expect(page.locator('summary').filter({ hasText: 'How ELO works' })).toBeVisible();
  });

  test('F4-05 Clicking "How ELO works" expands it to show ELO formula content', async ({ page }) => {
    await page.locator('button[data-tab="profile"]').click();
    const summary = page.locator('summary').filter({ hasText: 'How ELO works' });
    await summary.click();
    // The expanded section shows the ELO formula text.
    await expect(page.getByText('New ELO = Old ELO + 32')).toBeVisible({ timeout: 3000 });
  });

  test('F4-06 "How the League Works" accordion is visible on the Profile tab', async ({ page }) => {
    await page.locator('button[data-tab="profile"]').click();
    await expect(page.locator('summary').filter({ hasText: 'How the League Works' })).toBeVisible();
  });

  test('F4-07 Clicking "How the League Works" expands to show scheduled vs ad-hoc content', async ({ page }) => {
    await page.locator('button[data-tab="profile"]').click();
    const summary = page.locator('summary').filter({ hasText: 'How the League Works' });
    await summary.click();
    // The expanded section explains both match types.
    await expect(page.getByText('Scheduled matches')).toBeVisible({ timeout: 3000 });
    await expect(page.getByText('Ad-hoc matches')).toBeVisible({ timeout: 3000 });
  });
});
