// Flow 12 — Forgot Password
import { test, expect } from '@playwright/test';
import { goTo, seedLoginPlayer, adminWrite, adminRead } from './helpers.js';

const BASE = '/atp-greenwich/';

test.describe('Flow 12 — Forgot Password', () => {
  test.beforeEach(async ({ page }) => {
    await goTo(page);
    // Navigate to login screen from onboarding
    await page.getByText(/Already a member/i).click();
  });

  test('FP-01 login screen has Forgot password? button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Forgot password\?/i })).toBeVisible();
  });

  test('FP-02 forgot password screen shows email input and Send Reset Link button', async ({ page }) => {
    await page.getByRole('button', { name: /Forgot password\?/i }).click();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /Send Reset Link/i })).toBeVisible();
  });

  test('FP-03 entering non-existent email shows confirmation regardless', async ({ page }) => {
    await page.getByRole('button', { name: /Forgot password\?/i }).click();
    await page.locator('input[type="email"]').fill('nobody@example.com');
    await page.getByRole('button', { name: /Send Reset Link/i }).click();
    await expect(page.getByText(/Check your email/i)).toBeVisible({ timeout: 5000 });
  });

  test('FP-04 sending reset for real email creates a password_resets entry', async ({ page }) => {
    await seedLoginPlayer(page);
    await page.getByRole('button', { name: /Forgot password\?/i }).click();
    await page.locator('input[type="email"]').fill('testlogin@atp.test');
    await page.getByRole('button', { name: /Send Reset Link/i }).click();
    await expect(page.getByText(/Check your email/i)).toBeVisible({ timeout: 5000 });

    const resets = await adminRead(page, 'password_resets');
    expect(resets).not.toBeNull();
    const entries = Object.values(resets || {});
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });

  test('FP-05 valid reset token shows Set new password heading', async ({ page }) => {
    await adminWrite(page, 'password_resets/test_reset_token_001', {
      uid: 'dev_test_uid',
      email: 'dev@atp.test',
      expiry: Date.now() + 3600000,
      emailSent: false,
      createdAt: Date.now(),
    });

    await page.goto(`${BASE}?reset=test_reset_token_001`);
    await page.waitForFunction(() => typeof window._atpTest !== 'undefined', { timeout: 10000 });
    await expect(page.getByText(/Set new password/i)).toBeVisible({ timeout: 5000 });
  });

  test('FP-06 expired reset token shows Link expired heading', async ({ page }) => {
    await adminWrite(page, 'password_resets/test_reset_token_expired', {
      uid: 'dev_test_uid',
      email: 'dev@atp.test',
      expiry: Date.now() - 3600000,
      emailSent: false,
      createdAt: Date.now() - 7200000,
    });

    await page.goto(`${BASE}?reset=test_reset_token_expired`);
    await page.waitForFunction(() => typeof window._atpTest !== 'undefined', { timeout: 10000 });
    await expect(page.getByText(/Link expired/i)).toBeVisible({ timeout: 5000 });
  });
});
