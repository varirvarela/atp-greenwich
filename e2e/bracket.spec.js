// Flow 10 — Bracket Tab (Phase 6)
import { test, expect } from '@playwright/test';
import { goTo, seedData, clearData, jumpToApp } from './helpers.js';

test.describe('Flow 10 — Bracket Tab (Phase 6)', () => {
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
    await page.locator('button[data-tab="bracket"]').click();
  });

  test('P6-01 shows qualification tracker, not a Phase placeholder', async ({ page }) => {
    await expect(page.getByText(/Coming in Phase/i)).not.toBeVisible();
    await expect(page.getByText('Playoff Qualifier')).toBeVisible();
  });

  test('P6-01 shows league badge and current standings heading', async ({ page }) => {
    await expect(page.getByText('A Division').first()).toBeVisible();
    await expect(page.getByText('Current Standings')).toBeVisible();
  });

  test('P6-02 qualified count reflects seeded confirmed matches (2 of 4)', async ({ page }) => {
    // seedLeague: minWins=1 minMatches=1 bracketSize=4
    // devplayer (1W) + sofia (1W) both qualify → 2/4
    await expect(page.getByText('2/4')).toBeVisible();
  });

  test('P6-02 current player row shows "You"', async ({ page }) => {
    await expect(page.getByText('You')).toBeVisible();
  });

  test('P6-02 two players show Qualified badge (devplayer + sofia)', async ({ page }) => {
    const qualified = page.locator('.badge-teal').filter({ hasText: 'Qualified' });
    await expect(qualified).toHaveCount(2);
  });

  test('P6-02 two unqualified players show wins-to-go badge', async ({ page }) => {
    // marco and brunoc each need 1 more win
    await expect(page.getByText('1W to go')).toHaveCount(2);
  });

  test('P6-08 no crash when switching away and back to bracket tab', async ({ page }) => {
    await page.locator('button[data-tab="standings"]').click();
    await page.locator('button[data-tab="bracket"]').click();
    await expect(page.getByText('Playoff Qualifier')).toBeVisible();
  });
});
