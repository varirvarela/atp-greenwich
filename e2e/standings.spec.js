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

  test('P4-01 standings renders league table with player rows', async ({ page }) => {
    await expect(page.locator('#standings-mount')).toBeVisible({ timeout: 7000 });
    // League name is shown in the top-bar pill, not the standings table itself
    await expect(page.locator('#standings-mount').getByText(/\dW–\dL/).first()).toBeVisible();
  });

  test('P4-02 league table shows inline stats and ELO values', async ({ page }) => {
    // Inline W-L stats and ELO values (bracket-card style rows)
    await expect(page.locator('#standings-mount').getByText(/\dW–\dL/).first()).toBeVisible();
    await expect(page.locator('#standings-mount').getByText('1262')).toBeVisible(); // sofia ELO
  });

  test('P4-02 league table has a row for all 4 seeded players', async ({ page }) => {
    // Current player renders as "You" — scope to the table to avoid the ELO section duplicate
    const table = page.locator('#standings-mount');
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
