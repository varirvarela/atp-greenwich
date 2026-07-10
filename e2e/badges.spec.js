// Navigation Badges (Feed badge & Matches badge)
// Each test uses freshStart so Firebase state is clean.
import { test, expect } from '@playwright/test';
import { goTo, freshStart, adminWrite, adminRead } from './helpers.js';

const FEED_LAST_OPEN_KEY = 'atp_feed_last_open';

test.describe('Navigation Badges', () => {
  // ─── Feed badge ───────────────────────────────────────────────────────────────

  test('BD-01 feed badge appears when activity item is newer than atp_feed_last_open', async ({ page }) => {
    await goTo(page);
    await freshStart(page); // clearLeague + seedLeague + jumpToApp

    // Navigate away from Feed so the tab is not active — _updateNavBadge forces
    // count=0 when the feed tab is active, which would suppress the badge.
    await page.locator('button[data-tab="matches"]').click();

    // Set last-open to the past so any new item is "unseen".
    await page.evaluate(k => localStorage.setItem(k, String(Date.now() - 60000)), FEED_LAST_OPEN_KEY);

    // Write a new activity item with a future timestamp so it is definitely "newer".
    await adminWrite(page, 'activity/badge-test-event', {
      type: 'new_player',
      ts: Date.now() + 60000,
      uid: 'test_badge_user',
    });

    // The badge listener (dbListen on 'activity') should update the badge.
    const feedBadge = page.locator('.nav-item[data-tab="feed"] .nav-badge');
    await expect(feedBadge).toBeVisible({ timeout: 5000 });
  });

  test('BD-02 feed badge disappears after clicking the Feed tab', async ({ page }) => {
    await goTo(page);
    await freshStart(page);

    // Navigate away from Feed first — badge is suppressed while feed tab is active.
    await page.locator('button[data-tab="matches"]').click();

    await page.evaluate(k => localStorage.setItem(k, String(Date.now() - 60000)), FEED_LAST_OPEN_KEY);
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
