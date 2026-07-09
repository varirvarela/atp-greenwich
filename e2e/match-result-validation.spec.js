// Match Result Improvements — score-entry form validation
// Opens the Enter Result modal via a seeded scheduled match, then exercises
// the validation hints, auto-third-set, tiebreak row, and incomplete-result flow.
import { test, expect } from '@playwright/test';
import { goTo, freshStart } from './helpers.js';

test.describe('Match Result Validation', () => {
  test.beforeEach(async ({ page }) => {
    await goTo(page);
    await freshStart(page); // clearLeague + seedLeague + jumpToApp
    await page.locator('button[data-tab="matches"]').click();
    // Open Enter Result modal from the first available scheduled match.
    await page.locator('button[data-action="enter-result"]').first().click();
    await expect(page.locator('.modal-sheet').getByText('Enter Result')).toBeVisible();
  });

  test('MRV-01 invalid set score shows red hint containing "Invalid score"', async ({ page }) => {
    // 8-3 is not a valid tennis set (only 6-x, 7-5, 7-6 are legal).
    await page.locator('[data-set-row="1"] [data-score="me"]').fill('8');
    await page.locator('[data-set-row="1"] [data-score="op"]').fill('3');

    // The hint element [data-hint-set="1"] is created dynamically and made visible.
    const hint = page.locator('[data-hint-set="1"]');
    await expect(hint).toBeVisible({ timeout: 3000 });
    await expect(hint).toContainText('Invalid score');
  });

  test('MRV-02 6-4 then 4-6 (split sets) causes a 3rd set row to appear automatically', async ({ page }) => {
    // Set 1: I win 6-4
    await page.locator('[data-set-row="1"] [data-score="me"]').fill('6');
    await page.locator('[data-set-row="1"] [data-score="op"]').fill('4');

    // Set 2: Opponent wins 4-6 → sets split 1-1 → _checkAutoThirdSet fires.
    await page.locator('[data-set-row="2"] [data-score="me"]').fill('4');
    await page.locator('[data-set-row="2"] [data-score="op"]').fill('6');

    // The 3rd set row is auto-inserted by _checkAutoThirdSet clicking #btn-add-set.
    await expect(page.locator('[data-set-row="3"]')).toBeVisible({ timeout: 3000 });
  });

  test('MRV-03 entering 7-6 in a set reveals the tiebreak row', async ({ page }) => {
    await page.locator('[data-set-row="1"] [data-score="me"]').fill('7');
    await page.locator('[data-set-row="1"] [data-score="op"]').fill('6');

    // The tiebreak row [data-tb-row="1"] is shown when _needsTiebreak(7, 6) returns true.
    await expect(page.locator('[data-tb-row="1"]')).toBeVisible({ timeout: 3000 });
  });

  test('MRV-04 entering an invalid tiebreak (7-7) shows a tiebreak hint', async ({ page }) => {
    // Trigger the tiebreak row first with a 7-6 set.
    await page.locator('[data-set-row="1"] [data-score="me"]').fill('7');
    await page.locator('[data-set-row="1"] [data-score="op"]').fill('6');
    await expect(page.locator('[data-tb-row="1"]')).toBeVisible({ timeout: 3000 });

    // Enter an invalid tiebreak: 7-7 violates the "win by 2" rule.
    await page.locator('[data-tb-row="1"] [data-tb="me"]').fill('7');
    await page.locator('[data-tb-row="1"] [data-tb="op"]').fill('7');

    // The tiebreak hint [data-hint-tb="1"] should be visible with the error message.
    const tbHint = page.locator('[data-hint-tb="1"]');
    await expect(tbHint).toBeVisible({ timeout: 3000 });
    await expect(tbHint).toContainText('Invalid tiebreak');
  });

  test('MRV-05 checking "Incomplete result" reveals the winner-picker section', async ({ page }) => {
    // The checkbox id is #chk-incomplete; the winner row id is #incomplete-winner-row.
    const chk = page.locator('#chk-incomplete');
    const winnerRow = page.locator('#incomplete-winner-row');

    await expect(winnerRow).not.toBeVisible();
    await chk.check();
    await expect(winnerRow).toBeVisible({ timeout: 2000 });
  });

  test('MRV-06 incomplete result + winner selected enables Submit without a photo', async ({ page }) => {
    const submitBtn = page.locator('#btn-submit-result');
    await expect(submitBtn).toBeDisabled();

    // Check "Incomplete result" to reveal the winner-picker cards.
    await page.locator('#chk-incomplete').check();
    await expect(page.locator('#incomplete-winner-row')).toBeVisible();

    // Still disabled until a winner is picked.
    await expect(submitBtn).toBeDisabled();

    // Pick "me" as the winner.
    await page.locator('[data-incomplete-winner="me"]').click();

    // Submit should now be enabled — no photo required for incomplete results.
    await expect(submitBtn).toBeEnabled({ timeout: 2000 });
  });
});
