// Flow 9 — Feed Tab (Phase 5)
import { test, expect } from '@playwright/test';
import { goTo, seedData, clearData, jumpToApp } from './helpers.js';

test.describe('Flow 9 — Feed Tab', () => {
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

  test.beforeEach(async ({ page }) => {
    await goTo(page);
    await jumpToApp(page);
    // Feed is the first (default) tab — already active, but click explicitly for clarity
    await page.locator('button[data-tab="feed"]').click();
  });

  test('P5-01 shows league badge and result count', async ({ page }) => {
    await expect(page.getByText('A Division').first()).toBeVisible();
    await expect(page.getByText(/\d+ results?/)).toBeVisible();
  });

  test('P5-02 seeded confirmed matches appear in the feed', async ({ page }) => {
    // match_test_004: dev vs marco (6-3, 7-5)
    // match_test_005: sofia vs bruno (6-4, 6-2)
    // Both are confirmed with eloDeltas
    await expect(page.getByText('marco', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('sofia', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('brunoc', { exact: true }).first()).toBeVisible();
  });

  test('P5-02 ELO deltas from seeded matches are shown', async ({ page }) => {
    // match_test_004 eloDeltas: dev_test_uid +14, test_player_002 -14
    await expect(page.getByText('+14')).toBeVisible();
    await expect(page.getByText('-14')).toBeVisible();
    // match_test_005: sofia +12, bruno -12
    await expect(page.getByText('+12')).toBeVisible();
    await expect(page.getByText('-12')).toBeVisible();
  });

  test('P5-03 match involving current player has an accent left border', async ({ page }) => {
    // match_test_004 involves dev_test_uid (the logged-in player)
    // Its card has border-left: 3px solid var(--ace)
    const myMatch = page.locator('.card').filter({ hasText: 'marco' }).first();
    const borderLeft = await myMatch.evaluate(el => getComputedStyle(el).borderLeftWidth);
    expect(borderLeft).toBe('3px');
  });

  test('P5-05 empty state shown when no league is found', async ({ page }) => {
    // Clear league data and reload
    await page.evaluate(() => window._atpTest.clearLeague());
    await page.locator('button[data-tab="matches"]').click(); // switch away and back
    await page.locator('button[data-tab="feed"]').click();

    // Should show an empty state, not a blank screen
    await expect(page.locator('.empty-state-title')).toBeVisible({ timeout: 6000 });
  });
});
