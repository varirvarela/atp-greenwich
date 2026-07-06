// e2e/admin.spec.js — Admin dashboard E2E tests
//
// Flow A1 — Login: form visible, wrong password errors, correct password admits
// Flow A2 — Shell: all nav sections present, "← Player App" link, version label
// Flow A3 — Matches: filter controls, match cards, click-to-edit modal
// Flow A4 — Leagues: season filter, Release Fixtures opens a modal with smart defaults
// Flow A5 — Bracket: league tabs, table headers, Pts column when group stage active
// Flow A6 — Settings: version shows APP_VERSION, not hardcoded v0.06
//
// The admin app runs on port 5175 (separate Vite instance); all Firebase writes
// go via a player-app page (port 5174) using the adminWrite helper.

import { test, expect } from '@playwright/test';
import {
  goTo, freshStart, adminWrite,
  adminAppLogin, adminNavTo, openAdminSidebar, ADMIN_BASE,
} from './helpers.js';

// ─── Flow A1: Login ───────────────────────────────────────────────────────────

test.describe('Flow A1 — Admin Login', () => {
  test('A1-01 shows password form with no saved creds', async ({ page }) => {
    await page.goto(ADMIN_BASE);
    await expect(page.locator('#admin-pwd')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Admin Dashboard')).toBeVisible();
  });

  test('A1-02 wrong password shows inline error', async ({ page }) => {
    await page.goto(ADMIN_BASE);
    await page.locator('#admin-pwd').waitFor({ state: 'visible', timeout: 8000 });
    await page.locator('#admin-pwd').fill('notthepassword');
    await page.locator('#btn-admin-login').click();
    await expect(page.locator('#admin-login-error')).toBeVisible({ timeout: 5000 });
  });

  test('A1-03 correct password enters the admin shell', async ({ page }) => {
    await page.goto(ADMIN_BASE);
    await page.locator('#admin-pwd').waitFor({ state: 'visible', timeout: 8000 });
    await page.locator('#admin-pwd').fill('atpgreenwich2026');
    await page.locator('#btn-admin-login').click();
    await expect(page.locator('#admin-content')).toBeVisible({ timeout: 6000 });
  });

  test('A1-04 Enter key submits the login form', async ({ page }) => {
    await page.goto(ADMIN_BASE);
    await page.locator('#admin-pwd').waitFor({ state: 'visible', timeout: 8000 });
    await page.locator('#admin-pwd').fill('atpgreenwich2026');
    await page.locator('#admin-pwd').press('Enter');
    await expect(page.locator('#admin-content')).toBeVisible({ timeout: 6000 });
  });
});

// ─── Flow A2: Shell + sidebar ─────────────────────────────────────────────────

test.describe('Flow A2 — Admin Shell', () => {
  test.beforeAll(async ({ browser }) => {
    const p = await browser.newPage();
    await goTo(p);
    await freshStart(p);
    await p.close();
  });

  test.beforeEach(async ({ page }) => {
    await adminAppLogin(page);
  });

  test('A2-01 sidebar has all six nav sections', async ({ page }) => {
    await openAdminSidebar(page);
    for (const s of ['players','leagues','invites','matches','bracket','settings']) {
      await expect(page.locator(`.admin-nav-item[data-section="${s}"]`)).toBeVisible();
    }
  });

  test('A2-02 sidebar has "← Player App" back link', async ({ page }) => {
    await openAdminSidebar(page);
    await expect(page.getByText('← Player App')).toBeVisible();
  });

  test('A2-03 sidebar shows a version label', async ({ page }) => {
    await openAdminSidebar(page);
    // version is rendered as "v1.x.x" in the sidebar brand area
    await expect(page.getByText(/^v\d+\.\d+\.\d+$/).first()).toBeVisible();
  });

  test('A2-04 sign-out button visible in sidebar', async ({ page }) => {
    await openAdminSidebar(page);
    await expect(page.locator('#btn-admin-signout')).toBeVisible();
  });

  test('A2-05 Players section loads by default', async ({ page }) => {
    await expect(page.getByText('Players', { exact: true }).first()).toBeVisible({ timeout: 6000 });
  });
});

// ─── Flow A3: Matches — filters + click-to-edit ───────────────────────────────

test.describe('Flow A3 — Matches Section', () => {
  test.beforeAll(async ({ browser }) => {
    const p = await browser.newPage();
    await goTo(p);
    await freshStart(p);
    await p.close();
  });

  test.beforeEach(async ({ page }) => {
    await adminAppLogin(page);
    await adminNavTo(page, 'matches');
  });

  test('A3-01 filter bar has season, league, status, and player inputs', async ({ page }) => {
    await expect(page.locator('#filter-season')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#filter-league')).toBeVisible();
    await expect(page.locator('#filter-status')).toBeVisible();
    await expect(page.locator('#filter-player')).toBeVisible();
  });

  test('A3-02 seeded match cards are visible', async ({ page }) => {
    await expect(page.locator('.admin-card[data-mid]').first()).toBeVisible({ timeout: 8000 });
  });

  test('A3-03 status select has Confirmed option', async ({ page }) => {
    await page.locator('#filter-status').waitFor({ timeout: 6000 });
    const opts = page.locator('#filter-status option');
    await expect(opts.filter({ hasText: 'Confirmed' })).toHaveCount(1);
  });

  test('A3-04 filtering by "Open" hides confirmed cards', async ({ page }) => {
    // First verify there are some cards
    await page.locator('.admin-card[data-mid]').first().waitFor({ timeout: 8000 });
    await page.locator('#filter-status').selectOption('open');
    // Only open (non-confirmed) cards should remain; confirmed are hidden
    const confirmedBadges = page.locator('.badge-admin.badge-green').filter({ hasText: 'confirmed' });
    await expect(confirmedBadges).toHaveCount(0);
  });

  test('A3-05 clicking a match card opens the edit modal', async ({ page }) => {
    await page.locator('.admin-card[data-mid]').first().waitFor({ timeout: 8000 });
    await page.locator('.admin-card[data-mid]').first().click();
    await expect(page.locator('#btn-save-match')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#btn-close-match')).toBeVisible();
  });

  test('A3-06 edit modal contains set rows, winner select, and add-set button', async ({ page }) => {
    await page.locator('.admin-card[data-mid]').first().waitFor({ timeout: 8000 });
    await page.locator('.admin-card[data-mid]').first().click();
    await page.locator('#btn-save-match').waitFor({ timeout: 5000 });
    await expect(page.locator('#set-rows')).toBeVisible();
    await expect(page.locator('#winner-select')).toBeVisible();
    await expect(page.locator('#btn-add-set')).toBeVisible();
  });

  test('A3-07 cancel button closes the edit modal', async ({ page }) => {
    await page.locator('.admin-card[data-mid]').first().waitFor({ timeout: 8000 });
    await page.locator('.admin-card[data-mid]').first().click();
    await page.locator('#btn-close-match').waitFor({ timeout: 5000 });
    await page.locator('#btn-close-match').click();
    await expect(page.locator('#btn-save-match')).not.toBeVisible({ timeout: 3000 });
  });

  test('A3-08 "+ Add Set" adds a new set row to the modal', async ({ page }) => {
    await page.locator('.admin-card[data-mid]').first().waitFor({ timeout: 8000 });
    await page.locator('.admin-card[data-mid]').first().click();
    await page.locator('#btn-add-set').waitFor({ timeout: 5000 });
    const before = await page.locator('#set-rows [data-set-row]').count();
    await page.locator('#btn-add-set').click();
    const after = await page.locator('#set-rows [data-set-row]').count();
    expect(after).toBe(before + 1);
  });
});

// ─── Flow A4: Leagues — season filter + Release Fixtures modal ────────────────

test.describe('Flow A4 — Leagues Section', () => {
  test.beforeAll(async ({ browser }) => {
    const p = await browser.newPage();
    await goTo(p);
    await freshStart(p);
    await p.close();
  });

  test.beforeEach(async ({ page }) => {
    await adminAppLogin(page);
    await adminNavTo(page, 'leagues');
  });

  test('A4-01 leagues section shows the seeded league name', async ({ page }) => {
    await expect(page.getByText('A Division').first()).toBeVisible({ timeout: 8000 });
  });

  test('A4-02 Release Fixtures button visible when group stage is pending', async ({ page }) => {
    await expect(
      page.locator('button[data-action="release-fixtures"]').first()
    ).toBeVisible({ timeout: 8000 });
  });

  test('A4-03 clicking Release Fixtures opens a modal — not a native confirm', async ({ page }) => {
    await page.locator('button[data-action="release-fixtures"]').first().waitFor({ timeout: 8000 });
    await page.locator('button[data-action="release-fixtures"]').first().click();
    // A proper modal renders in-page (native confirm would block JS)
    await expect(page.locator('#rf-mpp')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#rf-qp')).toBeVisible();
    await expect(page.locator('#rf-deadline')).toBeVisible();
  });

  test('A4-04 modal shows "recommended" label next to qualify points', async ({ page }) => {
    await page.locator('button[data-action="release-fixtures"]').first().waitFor({ timeout: 8000 });
    await page.locator('button[data-action="release-fixtures"]').first().click();
    await page.locator('#rf-mpp').waitFor({ timeout: 5000 });
    await expect(page.getByText(/recommended/i)).toBeVisible();
  });

  test('A4-05 fixture-count preview updates when matches-per-player changes', async ({ page }) => {
    await page.locator('button[data-action="release-fixtures"]').first().waitFor({ timeout: 8000 });
    await page.locator('button[data-action="release-fixtures"]').first().click();
    await page.locator('#rf-mpp').waitFor({ timeout: 5000 });
    const before = await page.locator('#fixture-preview').textContent();
    await page.locator('#rf-mpp').fill('2');
    await page.locator('#rf-mpp').dispatchEvent('input');
    const after = await page.locator('#fixture-preview').textContent();
    expect(after).not.toBe(before);
  });

  test('A4-06 Cancel closes the Release Fixtures modal', async ({ page }) => {
    await page.locator('button[data-action="release-fixtures"]').first().waitFor({ timeout: 8000 });
    await page.locator('button[data-action="release-fixtures"]').first().click();
    await page.locator('#btn-rf-cancel').waitFor({ timeout: 5000 });
    await page.locator('#btn-rf-cancel').click();
    await expect(page.locator('#rf-mpp')).not.toBeVisible({ timeout: 3000 });
  });
});

// ─── Flow A5: Bracket — tabs, table columns, Pts column ───────────────────────

test.describe('Flow A5 — Bracket Section', () => {
  test.beforeAll(async ({ browser }) => {
    const p = await browser.newPage();
    await goTo(p);
    await freshStart(p);
    await p.close();
  });

  test.beforeEach(async ({ page }) => {
    await adminAppLogin(page);
    await adminNavTo(page, 'bracket');
  });

  test('A5-01 bracket section loads with league tab buttons', async ({ page }) => {
    await expect(page.locator('#bracket-league-tabs')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#bracket-league-tabs button').first()).toBeVisible({ timeout: 6000 });
  });

  test('A5-02 qualified-players table has W, P, GD columns', async ({ page }) => {
    await expect(page.locator('.admin-table')).toBeVisible({ timeout: 8000 });
    const ths = page.locator('.admin-table thead th');
    await expect(ths.getByText('W', { exact: true })).toBeVisible();
    await expect(ths.getByText('P', { exact: true })).toBeVisible();
    await expect(ths.getByText('GD', { exact: true })).toBeVisible();
  });

  test('A5-03 Pts column appears when group stage is active', async ({ page, browser }) => {
    // Activate group stage via a player-app helper page
    const helper = await browser.newPage();
    await goTo(helper);
    await adminWrite(helper, 'seasons/season_2026/leagues/league_a/groupStageConfig', {
      status: 'active', qualifyPoints: 3, matchesPerPlayer: 3,
    });
    await adminWrite(helper, 'seasons/season_2026/leagues/league_a/pointsConfig', {
      played: 1, wonBonus: 2, missed: 0, forfeitLoser: -1, forfeitWinner: 2,
    });
    await helper.close();

    // Re-navigate to bracket tab to pick up the new config
    await adminNavTo(page, 'matches');
    await adminNavTo(page, 'bracket');
    await expect(page.locator('.admin-table')).toBeVisible({ timeout: 8000 });
    await expect(
      page.locator('.admin-table thead th').getByText('Pts', { exact: true })
    ).toBeVisible();
  });

  test('A5-04 clicking a player row opens the player profile modal', async ({ page }) => {
    await expect(page.locator('.admin-table tbody tr[data-view-player]').first())
      .toBeVisible({ timeout: 8000 });
    await page.locator('.admin-table tbody tr[data-view-player]').first().click();
    // The player-modal renders a .player-profile-modal overlay
    await expect(page.locator('.player-profile-modal')).toBeVisible({ timeout: 5000 });
  });
});

// ─── Flow A6: Settings version ────────────────────────────────────────────────

test.describe('Flow A6 — Settings Version', () => {
  test.beforeEach(async ({ page }) => {
    await adminAppLogin(page);
    await adminNavTo(page, 'settings');
  });

  test('A6-01 Settings does not show the old hardcoded v0.06', async ({ page }) => {
    await expect(page.getByText('v0.06')).not.toBeVisible({ timeout: 5000 });
  });

  test('A6-02 Settings shows the current semver (v1.x.x)', async ({ page }) => {
    await expect(page.getByText(/v\d+\.\d+\.\d+/).first()).toBeVisible({ timeout: 5000 });
  });
});
