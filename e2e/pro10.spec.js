// Flow 11 — Pro10 Match Format
import { test, expect } from '@playwright/test';
import { goTo, seedData, clearData, jumpToApp, adminWrite } from './helpers.js';

test.describe('Flow 11 — Pro10 Match Format', () => {
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
    await page.locator('button[data-tab="matches"]').click();
  });

  test('P11-01 propose modal shows Match format section with Best of 3 selected', async ({ page }) => {
    await page.locator('#btn-propose').click();
    await expect(page.locator('.modal-sheet')).toBeVisible();
    await expect(page.getByText('Match format')).toBeVisible();
    const bo3Card = page.locator('div.tap-card').filter({ hasText: 'Best of 3' });
    await expect(bo3Card).toBeVisible();
    const pro10Card = page.locator('div.tap-card').filter({ hasText: 'Pro 10' });
    await expect(pro10Card).toBeVisible();
    await expect(bo3Card).toHaveClass(/selected/);
  });

  test('P11-02 Pro 10 tap-card shows correct title and subtitle', async ({ page }) => {
    await page.locator('#btn-propose').click();
    await expect(page.locator('.modal-sheet')).toBeVisible();
    const pro10Card = page.locator('div.tap-card').filter({ hasText: 'Pro 10' });
    await expect(pro10Card).toBeVisible();
    await expect(pro10Card).toContainText('Pro 10');
    await expect(pro10Card).toContainText('Single score 0–10');
  });

  test('P11-03 enter result modal for pro10 match shows Score (0 – 10) and not Set scores', async ({ page }) => {
    // Close propose modal if open, then write pro10 match via adminWrite
    await adminWrite(page, 'seasons/season_2026/leagues/league_a/matches/match_pro10_001', {
      playerA: 'dev_test_uid',
      playerB: 'test_player_002',
      proposedBy: 'dev_test_uid',
      proposedAt: 0,
      format: 'pro10',
      status: 'scheduled',
      result: null,
    });

    // Reload and navigate back to matches tab
    await goTo(page);
    await jumpToApp(page);
    await page.locator('button[data-tab="matches"]').click();

    // Find the Enter Result button for the pro10 match (card should show Pro 10 format label)
    const pro10MatchCard = page.locator('.match-card').filter({ hasText: 'Pro 10' });
    await expect(pro10MatchCard).toBeVisible({ timeout: 5000 });
    await pro10MatchCard.locator('button[data-action="enter-result"]').click();

    await expect(page.locator('.modal-sheet')).toBeVisible();
    await expect(page.locator('.modal-sheet').getByText(/Score \(0\s*[–-]\s*10\)/i)).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.modal-sheet').getByText(/Set scores/i)).not.toBeVisible();
  });

  test('P11-04 enter result modal for BO3 match shows Set scores and not Score (0 – 10)', async ({ page }) => {
    // Explicitly seed a BO3 scheduled match so this test has a guaranteed enter-result card
    await adminWrite(page, 'seasons/season_2026/leagues/league_a/matches/match_bo3_p1104', {
      playerA:    'dev_test_uid',
      playerB:    'test_player_002',
      proposedBy: 'dev_test_uid',
      proposedAt: 1,
      format:     'bo3',
      status:     'scheduled',
      result:     null,
    });
    await goTo(page);
    await jumpToApp(page);
    await page.locator('button[data-tab="matches"]').click();

    // Pick the bo3 card we just seeded (excludes any Pro 10 cards from P11-03)
    const bo3Card = page.locator('.match-card').filter({ hasNotText: 'Pro 10' }).first();
    await bo3Card.locator('button[data-action="enter-result"]').click();

    await expect(page.locator('.modal-sheet')).toBeVisible();
    await expect(page.locator('.modal-sheet').getByText(/Set scores/i)).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.modal-sheet').getByText(/Score \(0\s*[–-]\s*10\)/i)).not.toBeVisible();
  });
});
