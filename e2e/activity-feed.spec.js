// Activity Feed Cards
// Verifies that non-match activity items render as lightweight activity cards —
// NOT as match-result cards with reaction buttons.
// Also covers: joined_league, fixtures_released, and graceful handling of unknown types.
import { test, expect } from '@playwright/test';
import { goTo, freshStart, adminWrite, adminRead } from './helpers.js';

test.describe('Activity Feed Cards', () => {
  test.beforeEach(async ({ page }) => {
    await goTo(page);
    await freshStart(page); // clearLeague + seedLeague + jumpToApp
    await page.locator('button[data-tab="feed"]').click();
  });

  test('AF-01 match_proposed activity item appears as "sent a challenge" card', async ({ page }) => {
    const sid = await adminRead(page, 'config/defaultSeason');

    await adminWrite(page, 'activity/af-01-proposed', {
      type: 'match_proposed',
      ts: Date.now(),
      sid,
      lid: 'league_a',
      challengerId: 'test_player_002', // marco — exists in seeded player data
      opponentId: 'dev_test_uid',
    });

    // The feed renders activity items via _activityCard, which sets title to
    // "${challengerName} sent a challenge".
    await expect(page.getByText('sent a challenge')).toBeVisible({ timeout: 5000 });
  });

  test('AF-02 profile_change (avatar) activity item appears as "updated their avatar" card', async ({ page }) => {
    await adminWrite(page, 'activity/af-02-avatar', {
      type: 'profile_change',
      ts: Date.now(),
      uid: 'test_player_003', // sofia
      what: 'avatar',
      newVal: 'avatar_1',
    });

    await expect(page.getByText('updated their avatar')).toBeVisible({ timeout: 5000 });
  });

  test('AF-03 new_player activity item appears as "joined the tournament" card', async ({ page }) => {
    await adminWrite(page, 'activity/af-03-new-player', {
      type: 'new_player',
      ts: Date.now(),
      uid: 'dev_test_uid', // devplayer — known player in seeded data
    });

    await expect(page.getByText('joined the tournament')).toBeVisible({ timeout: 5000 });
  });

  test('AF-04 activity cards do NOT contain reaction buttons', async ({ page }) => {
    // Write a single identifiable activity item so the feed always has one.
    await adminWrite(page, 'activity/af-04-no-reactions', {
      type: 'new_player',
      ts: Date.now(),
      uid: 'test_player_004', // brunoc
    });

    // Use the full rendered text to avoid strict-mode collisions with items
    // seeded by earlier tests in the same run (e.g. AF-03 writes devplayer).
    await expect(page.getByText('brunoc joined the tournament')).toBeVisible({ timeout: 5000 });

    // Reaction buttons (.reaction-btn) only exist on match-result cards, never on
    // activity cards rendered by _activityCard (which carries data-feed-activity="1").
    await expect(page.locator('[data-feed-activity] .reaction-btn')).toHaveCount(0);
  });

  test('AF-05 joined_league activity shows player name and league name', async ({ page }) => {
    const sid = await adminRead(page, 'config/defaultSeason');

    await adminWrite(page, 'activity/af-05-joined', {
      type: 'joined_league',
      ts: Date.now(),
      uid: 'test_player_002', // marco
      sid,
      lid: 'league_a',
    });

    // _activityCard renders: "${alias} joined ${leagueName}"
    await expect(page.getByText('marco joined A Division')).toBeVisible({ timeout: 5000 });
  });

  test('AF-06 fixtures_released activity shows "New fixtures published"', async ({ page }) => {
    const sid = await adminRead(page, 'config/defaultSeason');

    await adminWrite(page, 'activity/af-06-fixtures', {
      type: 'fixtures_released',
      ts: Date.now(),
      sid,
      lid: 'league_a',
      fixtureCount: 6,
    });

    await expect(page.getByText('New fixtures published')).toBeVisible({ timeout: 5000 });
  });

  test('AF-07 unknown activity types are silently skipped — feed does not crash', async ({ page }) => {
    // Seed a known-good card alongside an unknown type written at a later timestamp
    // so if the unknown type caused a crash, the known card would disappear.
    await adminWrite(page, 'activity/af-07-known', {
      type: 'profile_change',
      ts: Date.now() - 100,
      uid: 'test_player_003', // sofia — unique alias, not used by other AF tests
      what: 'alias',
      newVal: 'sofia_updated',
    });
    await adminWrite(page, 'activity/af-07-unknown', {
      type: 'some_future_unknown_type',
      ts: Date.now(),
      uid: 'dev_test_uid',
    });

    // Known card is visible — feed did not crash
    await expect(page.getByText('sofia updated their alias')).toBeVisible({ timeout: 5000 });
    // No card rendered for the unknown type
    await expect(page.locator('[data-feed-activity]').filter({ hasText: 'some_future_unknown_type' })).toHaveCount(0);
  });
});
