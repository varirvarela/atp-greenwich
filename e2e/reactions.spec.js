// Flow 13 — Feed Reactions
import { test, expect } from '@playwright/test';
import { goTo, seedData, clearData, jumpToApp, adminWrite } from './helpers.js';

test.describe('Flow 13 — Feed Reactions', () => {
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
    await page.locator('button[data-tab="feed"]').click();
  });

  test('R-01 feed cards have 👏 reaction buttons', async ({ page }) => {
    await expect(page.locator('button.reaction-btn[data-emoji="👏"]').first()).toBeVisible();
  });

  test('R-02 clicking 👏 sets count to 1', async ({ page }) => {
    // Clear any existing reactions for a clean state
    await adminWrite(page, 'seasons/season_2026/leagues/league_a/reactions', null);
    await goTo(page);
    await jumpToApp(page);
    await page.locator('button[data-tab="feed"]').click();

    const btn = page.locator('button.reaction-btn[data-emoji="👏"]').first();
    await btn.click();
    await expect(btn.locator('.reaction-count')).toHaveText('1', { timeout: 5000 });
  });

  test('R-03 clicking 👏 twice removes the reaction (count clears)', async ({ page }) => {
    await adminWrite(page, 'seasons/season_2026/leagues/league_a/reactions', null);
    await goTo(page);
    await jumpToApp(page);
    await page.locator('button[data-tab="feed"]').click();

    const btn = page.locator('button.reaction-btn[data-emoji="👏"]').first();
    await btn.click();
    await expect(btn.locator('.reaction-count')).toHaveText('1', { timeout: 5000 });

    await btn.click();
    await expect(btn.locator('.reaction-count')).not.toHaveText('1', { timeout: 5000 });
  });

  test('R-04 switching from 👏 to 🔥 moves the reaction (only one per user per match)', async ({ page }) => {
    await adminWrite(page, 'seasons/season_2026/leagues/league_a/reactions', null);
    await goTo(page);
    await jumpToApp(page);
    await page.locator('button[data-tab="feed"]').click();

    const clapBtn = page.locator('button.reaction-btn[data-emoji="👏"]').first();
    await clapBtn.click();
    await expect(clapBtn.locator('.reaction-count')).toHaveText('1', { timeout: 5000 });

    // Click fire reaction on the same first feed card
    const fireBtn = page.locator('button.reaction-btn[data-emoji="🔥"]').first();
    await fireBtn.click();

    // 👏 count should be cleared; 🔥 count should be 1
    await expect(clapBtn.locator('.reaction-count')).not.toHaveText('1', { timeout: 5000 });
    await expect(fireBtn.locator('.reaction-count')).toHaveText('1', { timeout: 5000 });
  });
});
