// Flow 14 — Change Alias
import { test, expect } from '@playwright/test';
import { goTo, seedData, clearData, jumpToApp } from './helpers.js';

test.describe('Flow 14 — Change Alias', () => {
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
  });

  test('CA-01 profile tab shows edit alias button', async ({ page }) => {
    await expect(page.locator('#btn-edit-alias')).toBeVisible();
  });

  test('CA-02 clicking edit alias opens modal with text input', async ({ page }) => {
    await page.locator('#btn-edit-alias').click();
    await expect(page.locator('.modal-sheet')).toBeVisible();
    await expect(page.locator('.modal-sheet').locator('input[type="text"]')).toBeVisible();
  });

  test('CA-03 modal input is pre-filled with current alias and available alias enables Save', async ({ page }) => {
    await page.locator('#btn-edit-alias').click();
    const input = page.locator('.modal-sheet').locator('input[type="text"]');
    await expect(input).toHaveValue('devplayer');

    await input.clear();
    await input.fill('devplayerx');
    await page.waitForTimeout(600);

    await expect(page.locator('.modal-sheet').getByText(/Alias available/i)).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.modal-sheet').locator('#btn-save-alias')).toBeEnabled({ timeout: 5000 });
  });

  test('CA-04 taken alias shows error hint and keeps Save disabled', async ({ page }) => {
    await page.locator('#btn-edit-alias').click();
    const input = page.locator('.modal-sheet').locator('input[type="text"]');

    await input.clear();
    await input.fill('marco');
    await page.waitForTimeout(600);

    await expect(page.locator('.modal-sheet').getByText(/taken/i)).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.modal-sheet').locator('#btn-save-alias')).toBeDisabled();
  });

  test('CA-05 saving a new alias updates the @ display in profile', async ({ page }) => {
    await page.locator('#btn-edit-alias').click();
    const input = page.locator('.modal-sheet').locator('input[type="text"]');

    await input.clear();
    await input.fill('devplayerx');
    await page.waitForTimeout(600);

    await expect(page.locator('.modal-sheet').locator('#btn-save-alias')).toBeEnabled({ timeout: 5000 });
    await page.locator('.modal-sheet').locator('#btn-save-alias').click();

    await expect(page.locator('.modal-sheet')).not.toBeVisible({ timeout: 8000 });
    await expect(page.getByText('@devplayerx')).toBeVisible({ timeout: 5000 });
  });
});
