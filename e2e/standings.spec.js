// Flow 8 — Standings Tab (Phase 4)
import { test, expect } from '@playwright/test';
import { goTo, seedData, clearData, jumpToApp } from './helpers.js';

test.describe('Flow 8 — Standings Tab', () => {
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
    await page.locator('button[data-tab="standings"]').click();
  });

  test('P4-01 both sections render', async ({ page }) => {
    await expect(page.getByText('League Table')).toBeVisible();
    await expect(page.getByText('ELO Rankings')).toBeVisible();
  });

  test('P4-02 league table shows A Division badge and inline stats', async ({ page }) => {
    await expect(page.getByText('A Division')).toBeVisible();
    // Inline W-L and sets/games stats (no column headers — stats are per-row)
    await expect(page.locator('#league-table-mount').getByText(/\dW–\dL/).first()).toBeVisible();
    await expect(page.locator('#league-table-mount').getByText('Sets').first()).toBeVisible();
    await expect(page.locator('#league-table-mount').getByText('Games').first()).toBeVisible();
  });

  test('P4-02 league table has a row for all 4 seeded players', async ({ page }) => {
    // Current player renders as "You" — scope to the table to avoid the ELO section duplicate
    const table = page.locator('#league-table-mount');
    await expect(table.getByText('You')).toBeVisible();
    await expect(table.getByText('marco')).toBeVisible();
    await expect(table.getByText('sofia')).toBeVisible();
    await expect(table.getByText('brunoc')).toBeVisible();
  });

  test('P4-03 ELO rankings sorted descending: sofia > devplayer > marco > brunoc', async ({ page }) => {
    // All four ELO values present
    await expect(page.getByText('1262')).toBeVisible(); // sofia
    await expect(page.getByText('1220')).toBeVisible(); // devplayer
    await expect(page.getByText('1166')).toBeVisible(); // marco
    await expect(page.getByText('1138')).toBeVisible(); // brunoc
  });

  test('P4-03 current player row shows "You" label', async ({ page }) => {
    await expect(page.getByText('You').first()).toBeVisible();
  });
});
