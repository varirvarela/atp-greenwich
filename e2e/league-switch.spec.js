// Flow 12 — League Switch
import { test, expect } from '@playwright/test';
import { goTo, seedData, clearData, jumpToApp, adminWrite } from './helpers.js';

test.describe('Flow 12 — League Switch', () => {
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

  // Seed a second league and add dev_test_uid as a member before each test.
  test.beforeEach(async ({ page }) => {
    await goTo(page);
    await adminWrite(page, 'seasons/season_2026/leagues/league_b/name', 'B Division');
    await adminWrite(page, 'seasons/season_2026/leagues/league_b/division', 'B');
    await adminWrite(page, 'seasons/season_2026/leagues/league_b/members/dev_test_uid/joinedAt', Date.now());
    await jumpToApp(page);
    // League switcher loads asynchronously — wait for the pill
    await page.locator('#league-switch-btn').waitFor({ timeout: 6000 });
    // Clear any cached league preference from a previous test
    await page.evaluate(() => localStorage.removeItem('atp_active_lid'));
  });

  test('F12-01 league switch pill visible when player is in 2+ leagues', async ({ page }) => {
    await expect(page.locator('#league-switch-btn')).toBeVisible();
  });

  test('F12-01 league switch pill visible when player is in only 1 league', async ({ page }) => {
    // Remove the second league membership and force a reload
    await adminWrite(page, 'seasons/season_2026/leagues/league_b/members/dev_test_uid', null);
    await goTo(page);
    await jumpToApp(page);
    // Pill now always shows all leagues in the active tournament (browse mode)
    await page.waitForTimeout(2000);
    await expect(page.locator('#league-switch-btn')).toBeVisible();
  });

  test('F12-02 clicking pill opens Switch League sheet with both leagues', async ({ page }) => {
    await page.locator('#league-switch-btn').click();
    await expect(page.locator('.modal-sheet')).toBeVisible();
    await expect(page.locator('.modal-sheet').getByText('Switch League')).toBeVisible();
    await expect(page.locator('.modal-sheet').getByText('A Division')).toBeVisible();
    await expect(page.locator('.modal-sheet').getByText('B Division')).toBeVisible();
  });

  test('F12-03 currently active league shown as selected in picker', async ({ page }) => {
    await page.locator('#league-switch-btn').click();
    const selectedCard = page.locator('.modal-sheet .tap-card.selected');
    await expect(selectedCard).toBeVisible();
    // Default is A Division (first league alphabetically / first found)
    await expect(selectedCard).toContainText('A Division');
  });

  test('F12-04 clicking a league in picker closes sheet and updates pill', async ({ page }) => {
    await page.locator('#league-switch-btn').click();
    // Switch to B Division
    await page.locator('.modal-sheet .tap-card[data-lid="league_b"]').click();
    // Sheet closes
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 5000 });
    // Pill now shows B Division
    await expect(page.locator('#league-switch-btn')).toContainText('B Division');
  });

  test('F12-04 switching league persists atp_active_lid in localStorage', async ({ page }) => {
    await page.locator('#league-switch-btn').click();
    await page.locator('.modal-sheet .tap-card[data-lid="league_b"]').click();
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 5000 });
    const stored = await page.evaluate(() => localStorage.getItem('atp_active_lid'));
    expect(stored).toBe('league_b');
  });

  test('F12-05 tabs reload after league switch — shows new league badge', async ({ page }) => {
    await page.locator('#league-switch-btn').click();
    await page.locator('.modal-sheet .tap-card[data-lid="league_b"]').click();
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 5000 });
    // Feed and matches tabs should now display B Division badge
    await page.locator('button[data-tab="standings"]').click();
    await expect(page.getByText('B Division')).toBeVisible({ timeout: 6000 });
  });

  test('F12-06 clicking outside picker sheet closes it without switching', async ({ page }) => {
    await page.locator('#league-switch-btn').click();
    await expect(page.locator('.modal-sheet')).toBeVisible();
    await page.locator('.modal-overlay').click({ position: { x: 10, y: 10 } });
    await expect(page.locator('.modal-overlay')).not.toBeVisible();
    // Pill still shows original league
    await expect(page.locator('#league-switch-btn')).toContainText('A Division');
  });
});
