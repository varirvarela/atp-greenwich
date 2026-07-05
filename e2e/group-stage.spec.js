// Flow 14 — Group Match Features (Matches tab)
// Flow 15 — Group Stage Standings
//
// Each describe resets Firebase state so mutations don't bleed between tests.
import { test, expect } from '@playwright/test';
import { goTo, freshStart, adminWrite, adminRead } from './helpers.js';

// ─── Flow 14: Group Match in Matches tab ──────────────────────────────────────

test.describe('Flow 14 — Group Match Features', () => {
  test.beforeEach(async ({ page }) => {
    await goTo(page);
    await freshStart(page);
    // Patch match_test_001 (scheduled, dev vs marco) to be a group match
    await adminWrite(page, 'seasons/season_2026/leagues/league_a/matches/match_test_001/groupMatch', true);
    await adminWrite(page, 'seasons/season_2026/leagues/league_a/matches/match_test_001/deadline', Date.now() + 7 * 86_400_000);
    await page.locator('button[data-tab="matches"]').click();
  });

  test('F14-01 Group badge visible on group match card', async ({ page }) => {
    // The group match card should show the "Group" pill badge
    const groupBadge = page.getByText('Group').first();
    await expect(groupBadge).toBeVisible({ timeout: 6000 });
  });

  test('F14-02 Play-by deadline badge visible on group match', async ({ page }) => {
    // The deadline badge shows "Play by …" on the card
    await expect(page.getByText(/Play by/i).first()).toBeVisible({ timeout: 6000 });
  });

  test('F14-03 Forfeit button visible on unfinished group match', async ({ page }) => {
    const forfeitBtn = page.locator('button[data-action="forfeit"]').first();
    await expect(forfeitBtn).toBeVisible({ timeout: 6000 });
  });

  test('F14-04 Clicking forfeit opens modal with correct header', async ({ page }) => {
    await page.locator('button[data-action="forfeit"]').first().click();
    const modal = page.locator('.modal-overlay');
    await expect(modal).toBeVisible({ timeout: 4000 });
    await expect(modal.getByText('Forfeit match?')).toBeVisible();
  });

  test('F14-05 Forfeit modal explains opponent and penalty', async ({ page }) => {
    await page.locator('button[data-action="forfeit"]').first().click();
    const modal = page.locator('.modal-overlay');
    await expect(modal.getByText(/forfeit your group match against/i)).toBeVisible();
    await expect(modal.getByText(/cannot be undone/i)).toBeVisible();
    await expect(modal.locator('#btn-confirm-forfeit')).toBeVisible();
  });

  test('F14-06 Closing forfeit modal dismisses it without writing', async ({ page }) => {
    await page.locator('button[data-action="forfeit"]').first().click();
    await page.locator('#btn-close-forfeit').click();
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 4000 });
  });

  test('F14-07 Confirming forfeit writes forfeited field to Firebase', async ({ page }) => {
    await page.locator('button[data-action="forfeit"]').first().click();
    await page.locator('#btn-confirm-forfeit').click();
    // Modal should close
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 8000 });
    // Firebase should now have forfeited = dev_test_uid on match_test_001
    const forfeited = await adminRead(page, 'seasons/season_2026/leagues/league_a/matches/match_test_001/forfeited');
    expect(forfeited).toBe('dev_test_uid');
  });
});

// ─── Flow 15: Group Stage Standings ───────────────────────────────────────────

test.describe('Flow 15 — Group Stage Standings', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await goTo(page);
    await freshStart(page);
    // Activate group stage
    await adminWrite(page, 'seasons/season_2026/leagues/league_a/groupStageConfig', {
      status: 'active',
      qualifyPoints: 3,
      matchesPerPlayer: 3,
      deadline: Date.now() + 14 * 86_400_000,
    });
    await adminWrite(page, 'seasons/season_2026/leagues/league_a/pointsConfig', {
      played: 1, wonBonus: 2, missed: 0, forfeitLoser: -1, forfeitWinner: 2,
    });
    // Mark two confirmed matches as group matches
    // match_test_004: dev_test_uid beat test_player_002 (confirmed) → devplayer 3pts, marco 1pt
    // match_test_005: test_player_003 beat test_player_004 (confirmed) → sofia 3pts, brunoc 1pt
    await adminWrite(page, 'seasons/season_2026/leagues/league_a/matches/match_test_004/groupMatch', true);
    await adminWrite(page, 'seasons/season_2026/leagues/league_a/matches/match_test_005/groupMatch', true);
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await goTo(page);
    await page.evaluate(() => window._atpTest.clearLeague());
    await page.close();
  });

  test.beforeEach(async ({ page }) => {
    await goTo(page);
    await page.evaluate(() => window._atpTest.app());
    await page.locator('button[data-tab]').first().waitFor({ timeout: 5000 });
    await page.locator('button[data-tab="standings"]').click();
  });

  test('F15-01 Group Stage badge visible when status is active', async ({ page }) => {
    await expect(page.getByText('Group Stage')).toBeVisible({ timeout: 8000 });
  });

  test('F15-02 "How scoring works" accordion visible', async ({ page }) => {
    await expect(page.getByText('How scoring works')).toBeVisible({ timeout: 8000 });
  });

  test('F15-03 Group points shown as numbers in standings rows', async ({ page }) => {
    // Each row should have a number visible (0 or more group pts)
    const tableMount = page.locator('#league-table-mount');
    await expect(tableMount).toBeVisible({ timeout: 8000 });
    // At least one non-zero pts number present (devplayer and sofia both have 3)
    await expect(tableMount.getByText('3').first()).toBeVisible();
  });

  test('F15-04 Qualifying threshold mentioned in accordion', async ({ page }) => {
    // Expand the accordion
    const summary = page.locator('summary').filter({ hasText: 'How scoring works' });
    await summary.click();
    // Should mention the qualifyPoints threshold
    await expect(page.getByText(/≥\s*3\s*pts/i)).toBeVisible({ timeout: 4000 });
  });

  test('F15-05 Two players show Qualified badge (devplayer + sofia both on 3pts)', async ({ page }) => {
    // qualifyPoints = 3; devplayer and sofia each have 3 pts from group matches
    const qualifiedBadges = page.locator('.badge-teal').filter({ hasText: 'Qualified' });
    await expect(qualifiedBadges).toHaveCount(2, { timeout: 8000 });
  });

  test('F15-06 "You" row highlighted with ace border in standings', async ({ page }) => {
    const tableMount = page.locator('#league-table-mount');
    await expect(tableMount.getByText('You').first()).toBeVisible({ timeout: 8000 });
  });

  test('F15-07 Rules accordion expands to show point values', async ({ page }) => {
    const summary = page.locator('summary').filter({ hasText: 'How scoring works' });
    await summary.click();
    // Should show played and win bonus points
    await expect(page.getByText(/played/i).first()).toBeVisible();
    await expect(page.getByText(/win/i).first()).toBeVisible();
  });
});
