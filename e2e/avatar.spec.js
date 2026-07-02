// Flow 5 — Change Avatar
import { test, expect } from '@playwright/test';
import { goTo, seedData, clearData, jumpToApp } from './helpers.js';

test.describe('Flow 5 — Change Avatar', () => {
  // Seed once — dev player must exist in Firebase for the avatar write to work.
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
    await page.locator('button[data-tab="profile"]').click();
    await page.locator('#btn-change-avatar').click();
    await page.locator('.modal-overlay').waitFor({ timeout: 3000 });
  });

  test('F5-01 modal opens with all picker controls', async ({ page }) => {
    await expect(page.locator('.modal-sheet')).toBeVisible();
    await expect(page.locator('.modal-sheet').getByText('Change Avatar')).toBeVisible();
    await expect(page.locator('#btn-shuffle')).toBeVisible();
    await expect(page.locator('#btn-confirm')).toHaveText('This is me →');
  });

  test('F5-01 all three style tabs are present', async ({ page }) => {
    await expect(page.locator('button[data-style="adventurer"]')).toBeVisible();
    await expect(page.locator('button[data-style="big-smile"]')).toBeVisible();
    await expect(page.locator('button[data-style="pixel-art"]')).toBeVisible();
  });

  // The DiceBear clipping fix: SVGs must have width="100%" height="100%"
  // (without it the 762×762 adventurer viewBox renders at native size, only top-left shows)
  test('F5-02 Adventurer SVG has width/height 100% — no top-left clipping', async ({ page }) => {
    await page.locator('button[data-style="adventurer"]').click();
    await page.waitForTimeout(150); // animation settle
    await expect(page.locator('#av-preview-inner svg').first()).toHaveAttribute('width', '100%');
    await expect(page.locator('#av-preview-inner svg').first()).toHaveAttribute('height', '100%');
  });

  test('F5-03 Big Smile SVG has width/height 100%', async ({ page }) => {
    await page.locator('button[data-style="big-smile"]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('#av-preview-inner svg').first()).toHaveAttribute('width', '100%');
  });

  test('F5-03 Pixel Art SVG has width/height 100%', async ({ page }) => {
    await page.locator('button[data-style="pixel-art"]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('#av-preview-inner svg').first()).toHaveAttribute('width', '100%');
  });

  test('F5-01 Shuffle changes the preview content', async ({ page }) => {
    const before = await page.locator('#av-preview-inner').innerHTML();
    await page.locator('#btn-shuffle').click();
    await page.waitForTimeout(200); // animation
    const after = await page.locator('#av-preview-inner').innerHTML();
    expect(before).not.toBe(after);
  });

  test('F5-08 clicking outside overlay closes modal', async ({ page }) => {
    // Click top-left corner of the overlay (outside the sheet)
    await page.locator('.modal-overlay').click({ position: { x: 10, y: 10 } });
    await expect(page.locator('.modal-overlay')).not.toBeVisible();
  });

  test('F5-09 clicking X button closes modal', async ({ page }) => {
    await page.locator('#btn-close-av-modal').click();
    await expect(page.locator('.modal-overlay')).not.toBeVisible();
  });

  test('F5-04 confirming avatar closes modal', async ({ page }) => {
    await page.locator('button[data-style="big-smile"]').click();
    await page.locator('#btn-confirm').click();
    // Firebase write + localStorage update — allow extra time
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 10000 });
  });
});
