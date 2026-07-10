// Navigation Badges (Feed badge & Matches badge)
// Each test uses freshStart so Firebase state is clean.
import { test, expect } from '@playwright/test';
import { goTo, freshStart, adminWrite, adminRead } from './helpers.js';

test.describe('Navigation Badges', () => {
  // ─── Feed badge ───────────────────────────────────────────────────────────────

  test('BD-01 feed badge appears when activity item is newer than atp_feed_last_open', async ({ page }) => {
    await goTo(page);
    await freshStart(page); // clearLeague + seedLeague + jumpToApp

    // The app stamps FEED_LAST_OPEN_KEY = now when it loads on the Feed tab.
    // Navigate away so the tab is inactive — badge is suppressed while feed is active.
    await page.locator('button[data-tab="matches"]').click();

    // Write an item with ts well in the future so it is definitely newer than the
    // timestamp the app stamped on startup.
    await adminWrite(page, 'activity/badge-test-event', {
      type: 'new_player',
      ts: Date.now() + 60000,
      uid: 'test_badge_user',
    });

    const feedBadge = page.locator('.nav-item[data-tab="feed"] .nav-badge');
    await expect(feedBadge).toBeVisible({ timeout: 5000 });
  });

  test('BD-02 feed badge disappears after clicking the Feed tab', async ({ page }) => {
    await goTo(page);
    await freshStart(page);

    // Navigate away so badge can appear (suppressed while feed tab is active).
    await page.locator('button[data-tab="matches"]').click();
    await adminWrite(page, 'activity/badge-clear-test', {
      type: 'new_player',
      ts: Date.now() + 60000,
      uid: 'test_badge_user_2',
    });

    const feedBadge = page.locator('.nav-item[data-tab="feed"] .nav-badge');
    await expect(feedBadge).toBeVisible({ timeout: 5000 });

    // Clicking the Feed tab clears the badge.
    await page.locator('button[data-tab="feed"]').click();
    await expect(feedBadge).not.toBeVisible({ timeout: 3000 });
  });

  // ─── Matches badge ────────────────────────────────────────────────────────────

  test('BD-03 matches badge appears when a scheduled match has dev player as playerB', async ({ page }) => {
    await goTo(page);
    await freshStart(page);

    // Read the active season to construct the correct path.
    const sid = await adminRead(page, 'config/defaultSeason');

    // Write a match where dev_test_uid is the challenged player (playerB).
    await adminWrite(page, `seasons/${sid}/leagues/league_a/matches/badge_match_test`, {
      playerA: 'test_player_002',
      playerB: 'dev_test_uid',
      status: 'scheduled',
      proposedBy: 'test_player_002',
      proposedAt: Date.now(),
      scheduledAt: Date.now() + 86400000,
    });

    // The badge listener fires for scheduled matches where playerB === uid.
    const matchesBadge = page.locator('.nav-item[data-tab="matches"] .nav-badge');
    await expect(matchesBadge).toBeVisible({ timeout: 5000 });
  });
});
