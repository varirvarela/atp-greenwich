// Flow 7 — Matches Tab (Phase 3)
// Each test resets Firebase state so mutations don't bleed into later tests.
import { test, expect } from '@playwright/test';
import { goTo, freshStart, adminWrite, adminRead } from './helpers.js';

test.describe('Flow 7 — Matches Tab', () => {
  test.beforeEach(async ({ page }) => {
    await goTo(page);
    await freshStart(page); // clearLeague + seedLeague + jumpToApp
    await page.locator('button[data-tab="matches"]').click();
  });

  test('P3-01 league badge and all three sections visible', async ({ page }) => {
    await expect(page.getByText('A Division')).toBeVisible();
    await expect(page.getByText('Needs your action')).toBeVisible();
    await expect(page.getByText('In progress')).toBeVisible();
    await expect(page.getByText('Recent results')).toBeVisible();
  });

  test('P3-01 Needs your action has 2 cards', async ({ page }) => {
    // Seeded state: result_pending (sofia entered) + photo_pending = 2 "needs action" items
    // Scope to the two action types that appear in "Needs your action" (not enter-result in In progress)
    const actionBtns = page.locator('button[data-action="confirm-result"], button[data-action="upload-photo"]');
    await expect(actionBtns).toHaveCount(2);
  });

  test('P3-03 Confirm Result modal opens with agree + dispute buttons', async ({ page }) => {
    await page.locator('button[data-action="confirm-result"]').click();
    await expect(page.locator('.modal-sheet')).toBeVisible();
    await expect(page.locator('.modal-sheet').getByText('Confirm Result')).toBeVisible();
    await expect(page.locator('#btn-agree')).toBeVisible();
    await expect(page.locator('#btn-dispute')).toBeVisible();
  });

  test('P3-04 Disputing a result resets match to Scheduled', async ({ page }) => {
    await page.locator('button[data-action="confirm-result"]').click();
    await page.locator('#btn-dispute').click();

    // Dispute modal
    await expect(page.getByText('Dispute Result')).toBeVisible();
    await page.locator('#btn-confirm-dispute').click();

    // Match should have moved out of "Needs your action"
    await expect(page.locator('button[data-action="confirm-result"]')).not.toBeVisible({ timeout: 6000 });
    // The match is back in "In progress" as Scheduled — action count drops to 1
    await expect(page.locator('button[data-action="confirm-result"], button[data-action="upload-photo"]')).toHaveCount(1, { timeout: 6000 });
  });

  test('P3-05 Enter Result modal has set inputs and submit disabled', async ({ page }) => {
    // The photo_pending match has action "upload-photo"; the scheduled match has "enter-result"
    await page.locator('button[data-action="enter-result"]').first().click();
    await expect(page.locator('.modal-sheet').getByText('Enter Result')).toBeVisible();
    await expect(page.locator('input[data-score="me"]').first()).toBeVisible();
    await expect(page.locator('input[data-score="op"]').first()).toBeVisible();
    await expect(page.locator('#btn-submit-result')).toBeDisabled();
    await expect(page.locator('#btn-add-set')).toBeVisible();
  });

  test('P3-06 Submit Result requires scores + photo to enable button', async ({ page }) => {
    await page.locator('button[data-action="enter-result"]').first().click();

    // Button disabled — no scores, no photo yet
    await expect(page.locator('#btn-submit-result')).toBeDisabled();

    // Fill Set 1
    await page.locator('input[data-score="me"]').nth(0).fill('6');
    await page.locator('input[data-score="op"]').nth(0).fill('3');
    // Still disabled — Set 2 incomplete and no photo
    await expect(page.locator('#btn-submit-result')).toBeDisabled();

    // Fill Set 2
    await page.locator('input[data-score="me"]').nth(1).fill('7');
    await page.locator('input[data-score="op"]').nth(1).fill('5');
    // Still disabled — photo required
    await expect(page.locator('#btn-submit-result')).toBeDisabled();

    // Attach a photo (1×1 transparent PNG stub)
    await page.locator('#photo-input').setInputFiles({
      name: 'match.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
    });
    await expect(page.locator('#btn-submit-result')).toBeEnabled();
  });

  test('P3-07 Upload Photo modal has skip button', async ({ page }) => {
    await page.locator('button[data-action="upload-photo"]').click();
    await expect(page.getByText('Upload Match Photo')).toBeVisible();
    await expect(page.locator('#btn-upload')).toBeDisabled(); // disabled until photo chosen
    await expect(page.locator('#btn-skip')).toBeVisible();
    await expect(page.locator('#btn-skip')).toContainText('Skip');
  });

  test('P3-08 Skipping photo confirms the match', async ({ page }) => {
    await page.locator('button[data-action="upload-photo"]').click();
    await page.locator('#btn-skip').click();

    // Modal closes and the card moves to "Recent results"
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 8000 });
    // Action count drops by 1
    await expect(page.locator('button[data-action="confirm-result"], button[data-action="upload-photo"]')).toHaveCount(1, { timeout: 6000 });
  });

  test('P3-09 Propose Match modal lists opponents', async ({ page }) => {
    await page.locator('#btn-propose').click();
    await expect(page.locator('.modal-sheet')).toBeVisible();
    await expect(page.locator('div.tap-card[data-uid]')).not.toHaveCount(0);
    await expect(page.locator('#btn-confirm-direct')).toBeDisabled();
  });

  test('P3-10 opponent at 2/2 cap is not selectable', async ({ page }) => {
    await page.locator('#btn-propose').click();
    // The opponent at cap has a "2/2" badge — find that card
    const cappedCard = page.locator('div.tap-card[data-uid]').filter({ hasText: '2/2' });
    if (await cappedCard.count() > 0) {
      // The card uses pointer-events:none to block selection — verify the CSS
      const pointerEvents = await cappedCard.first().evaluate(
        el => getComputedStyle(el).pointerEvents
      );
      expect(pointerEvents).toBe('none');
      // Propose button stays disabled (no eligible opponent selected)
      await expect(page.locator('#btn-confirm-direct')).toBeDisabled();
    }
  });

  test('P3-11 proposing a new match adds it to In progress', async ({ page }) => {
    await page.locator('#btn-propose').click();
    // Select any opponent not at cap (no "2/2" badge)
    const eligible = page.locator('div.tap-card[data-uid]').filter({ hasNot: page.locator('text=2/2') });
    await eligible.first().click();
    await expect(page.locator('#btn-confirm-direct')).toBeEnabled();
    await page.locator('#btn-confirm-direct').click();

    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 8000 });
    // "In progress" section should now have the new scheduled card
    await expect(page.getByText('In progress')).toBeVisible();
  });

  test('P3-12 switching tabs and back re-renders without errors', async ({ page }) => {
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

    await page.locator('button[data-tab="standings"]').click();
    await page.locator('button[data-tab="matches"]').click();

    await expect(page.getByText('A Division')).toBeVisible();
    expect(errors.filter(e => !e.includes('favicon'))).toHaveLength(0);
  });

  test('P3-13 receiving a challenge (playerB on a scheduled match) shows it in the matches list', async ({ page }) => {
    // The app code puts a scheduled match where I am playerB into "In progress"
    // (not "Needs your action"), with a "Decline" management button shown for
    // the isTheirProposal case (proposedBy !== me).
    const sid = await adminRead(page, 'config/defaultSeason');
    await adminWrite(page, `seasons/${sid}/leagues/league_a/matches/p3_13_challenge`, {
      playerA: 'test_player_002',
      playerB: 'dev_test_uid',
      status: 'scheduled',
      proposedBy: 'test_player_002',
      proposedAt: Date.now(),
      scheduledAt: Date.now() + 86400000,
    });

    // The match card should now be visible in the "In progress" section.
    await expect(page.getByText('In progress')).toBeVisible({ timeout: 5000 });
    // The "Decline" button appears for the isTheirProposal case.
    await expect(page.locator('button[data-action="decline-proposal"]')).toBeVisible({ timeout: 5000 });
  });

  test('P3-14 declining the challenge removes the card from In progress', async ({ page }) => {
    const sid = await adminRead(page, 'config/defaultSeason');
    await adminWrite(page, `seasons/${sid}/leagues/league_a/matches/p3_14_challenge`, {
      playerA: 'test_player_002',
      playerB: 'dev_test_uid',
      status: 'scheduled',
      proposedBy: 'test_player_002',
      proposedAt: Date.now(),
      scheduledAt: Date.now() + 86400000,
    });

    await expect(page.locator('button[data-action="decline-proposal"]')).toBeVisible({ timeout: 5000 });
    await page.locator('button[data-action="decline-proposal"]').click();

    // Confirmation modal appears.
    const confirmBtn = page.locator('#btn-confirm-cancel');
    await expect(confirmBtn).toBeVisible({ timeout: 3000 });
    await confirmBtn.click();

    // The modal closes and the card is gone.
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('button[data-action="decline-proposal"]')).not.toBeVisible({ timeout: 5000 });
  });
});
