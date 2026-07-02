// src/player/main.js — Player app bootstrap
// Checks saved credentials, launches the right screen, and wires auth → app.

import '@player/style.css';

import { dbGet, dbSet, dbRef, dbMultiUpdate, pRef } from '@shared/firebase.js';
import { simpleHash, toEmailKey } from '@shared/utils.js';
import { initAnalytics, logAppOpen, isPWA } from '@shared/analytics.js';
import { runEloTests }     from '@shared/elo.js';
import { runScoringTests } from '@shared/scoring.js';

import { showOnboarding, showAvatarPicker } from '@player/auth.js';
import { showApp }                   from '@player/app.js';

// Expose test helpers in dev mode
if (import.meta.env.DEV) {
  window.runEloTests     = runEloTests;
  window.runScoringTests = runScoringTests;

  const DEV_PLAYER = {
    uid:            'dev_test_uid',
    name:           'Dev Player',
    alias:          'devplayer',
    username:       'devplayer',
    email:          'dev@atp-greenwich.test',
    eloRating:      1220,
    eloHistory:     [{ delta: 20, match: 'test', ts: Date.now() }],
    avatarId:       'adventurer::devtestplayer',
    adminRole:      null,
    status:         'active',
    selfAssessment: { level: 'intermediate', suggestedLeague: null },
    createdAt:      Date.now(),
    lastActive:     Date.now(),
  };

  window._atpTest = {
    // Jump straight to the app shell with fake player data
    app: () => {
      const app    = document.getElementById('app');
      const creds  = { uid: DEV_PLAYER.uid, email: DEV_PLAYER.email, pwdHash: 'dev', avatarId: DEV_PLAYER.avatarId, adminRole: null };
      localStorage.setItem('atp_player_creds', JSON.stringify(creds));
      showApp(app, DEV_PLAYER, creds, () => window.location.reload());
    },
    // Jump straight to the avatar picker (uses fake uid, saves nothing to Firebase)
    avatarPicker: () => {
      const app = document.getElementById('app');
      showAvatarPicker(app, DEV_PLAYER.uid, (player, creds) => {
        showApp(app, { ...DEV_PLAYER, avatarId: creds.avatarId }, creds, () => window.location.reload());
      });
    },
  };

  window._atpTest.seedTestData = async () => {
    console.log('Seeding test data…');
    await dbMultiUpdate({
      'invite_codes/TEST-1234/used': false,
      'invite_codes/USED-9999/used': true,
    });
    console.log('✓ invite_codes/TEST-1234  → used: false');
    console.log('✓ invite_codes/USED-9999 → used: true');
    console.log('Test data written. You can now run the auth flow tests.');
  };

  // Seed a full league with 4 players and 5 matches in every possible state.
  // Covers: scheduled, result_pending (needs confirm), photo_pending, confirmed.
  // All data goes to _dev/ prefix — never touches production.
  window._atpTest.seedLeague = async () => {
    console.log('Seeding league data… (writes to _dev/ prefix)');
    const now        = Date.now();
    const yesterday  = now - 86_400_000;
    const twoDaysAgo = now - 172_800_000;

    await dbMultiUpdate({
      // ── Season ───────────────────────────────────────────────────────────
      'config/defaultSeason': 'season_2026',
      'seasons/season_2026/leagues/league_a/name': 'A Division',

      // ── League members ────────────────────────────────────────────────────
      'seasons/season_2026/leagues/league_a/members/dev_test_uid/joinedAt':    now,
      'seasons/season_2026/leagues/league_a/members/test_player_002/joinedAt': now,
      'seasons/season_2026/leagues/league_a/members/test_player_003/joinedAt': now,
      'seasons/season_2026/leagues/league_a/members/test_player_004/joinedAt': now,

      // ── Player: Dev (you) ─────────────────────────────────────────────────
      'players/dev_test_uid/name':           'Dev Player',
      'players/dev_test_uid/alias':          'devplayer',
      'players/dev_test_uid/username':       'devplayer',
      'players/dev_test_uid/email':          'dev@atp-greenwich.test',
      'players/dev_test_uid/avatarId':       'adventurer::devtestplayer',
      'players/dev_test_uid/eloRating':      1220,
      'players/dev_test_uid/eloHistory':     [{ delta: 14, match: 'match_test_004', ts: yesterday }],
      'players/dev_test_uid/passwordHash':   'dev',
      'players/dev_test_uid/status':         'active',
      'players/dev_test_uid/selfAssessment': { level: 'intermediate', suggestedLeague: null },
      'players/dev_test_uid/createdAt':      now,
      'players/dev_test_uid/lastActive':     now,

      // ── Player: Marco (test_player_002) ───────────────────────────────────
      'players/test_player_002/name':           'Marco Avila',
      'players/test_player_002/alias':          'marco',
      'players/test_player_002/username':       'marco',
      'players/test_player_002/avatarId':       'adventurer::marcoavila88',
      'players/test_player_002/eloRating':      1166,
      'players/test_player_002/eloHistory':     [{ delta: -14, match: 'match_test_004', ts: yesterday }],
      'players/test_player_002/status':         'active',
      'players/test_player_002/selfAssessment': { level: 'intermediate', suggestedLeague: null },
      'players/test_player_002/createdAt':      now,

      // ── Player: Sofia (test_player_003) ───────────────────────────────────
      'players/test_player_003/name':           'Sofia Ruiz',
      'players/test_player_003/alias':          'sofia',
      'players/test_player_003/username':       'sofia',
      'players/test_player_003/avatarId':       'big-smile::sofiaruiz99',
      'players/test_player_003/eloRating':      1262,
      'players/test_player_003/eloHistory':     [{ delta: 12, match: 'match_test_005', ts: twoDaysAgo }],
      'players/test_player_003/status':         'active',
      'players/test_player_003/selfAssessment': { level: 'advanced', suggestedLeague: null },
      'players/test_player_003/createdAt':      now,

      // ── Player: Bruno (test_player_004) ───────────────────────────────────
      'players/test_player_004/name':           'Bruno Costa',
      'players/test_player_004/alias':          'brunoc',
      'players/test_player_004/username':       'brunoc',
      'players/test_player_004/avatarId':       'pixel-art::brunocosta77',
      'players/test_player_004/eloRating':      1138,
      'players/test_player_004/eloHistory':     [{ delta: -12, match: 'match_test_005', ts: twoDaysAgo }],
      'players/test_player_004/status':         'active',
      'players/test_player_004/selfAssessment': { level: 'beginner', suggestedLeague: null },
      'players/test_player_004/createdAt':      now,

      // ── Match 001 — SCHEDULED (dev vs marco) ─────────────────────────────
      'seasons/season_2026/leagues/league_a/matches/match_test_001/playerA':    'dev_test_uid',
      'seasons/season_2026/leagues/league_a/matches/match_test_001/playerB':    'test_player_002',
      'seasons/season_2026/leagues/league_a/matches/match_test_001/proposedBy': 'dev_test_uid',
      'seasons/season_2026/leagues/league_a/matches/match_test_001/proposedAt': now,
      'seasons/season_2026/leagues/league_a/matches/match_test_001/status':     'scheduled',
      'seasons/season_2026/leagues/league_a/matches/match_test_001/result':     null,

      // ── Match 002 — RESULT_PENDING (sofia entered, dev must confirm) ──────
      'seasons/season_2026/leagues/league_a/matches/match_test_002/playerA':              'dev_test_uid',
      'seasons/season_2026/leagues/league_a/matches/match_test_002/playerB':              'test_player_003',
      'seasons/season_2026/leagues/league_a/matches/match_test_002/proposedBy':           'dev_test_uid',
      'seasons/season_2026/leagues/league_a/matches/match_test_002/proposedAt':           yesterday,
      'seasons/season_2026/leagues/league_a/matches/match_test_002/status':               'result_pending',
      'seasons/season_2026/leagues/league_a/matches/match_test_002/result/winner':        'test_player_003',
      'seasons/season_2026/leagues/league_a/matches/match_test_002/result/loser':         'dev_test_uid',
      'seasons/season_2026/leagues/league_a/matches/match_test_002/result/sets':          [{ a: 3, b: 6 }, { a: 4, b: 6 }],
      'seasons/season_2026/leagues/league_a/matches/match_test_002/result/enteredBy':     'test_player_003',
      'seasons/season_2026/leagues/league_a/matches/match_test_002/result/enteredAt':     yesterday,
      'seasons/season_2026/leagues/league_a/matches/match_test_002/result/confirmedBy':   null,

      // ── Match 003 — PHOTO_PENDING (dev won, result agreed, photo needed) ──
      'seasons/season_2026/leagues/league_a/matches/match_test_003/playerA':              'dev_test_uid',
      'seasons/season_2026/leagues/league_a/matches/match_test_003/playerB':              'test_player_004',
      'seasons/season_2026/leagues/league_a/matches/match_test_003/proposedBy':           'dev_test_uid',
      'seasons/season_2026/leagues/league_a/matches/match_test_003/proposedAt':           twoDaysAgo,
      'seasons/season_2026/leagues/league_a/matches/match_test_003/status':               'photo_pending',
      'seasons/season_2026/leagues/league_a/matches/match_test_003/result/winner':        'dev_test_uid',
      'seasons/season_2026/leagues/league_a/matches/match_test_003/result/loser':         'test_player_004',
      'seasons/season_2026/leagues/league_a/matches/match_test_003/result/sets':          [{ a: 6, b: 4 }, { a: 6, b: 3 }],
      'seasons/season_2026/leagues/league_a/matches/match_test_003/result/enteredBy':     'dev_test_uid',
      'seasons/season_2026/leagues/league_a/matches/match_test_003/result/enteredAt':     twoDaysAgo,
      'seasons/season_2026/leagues/league_a/matches/match_test_003/result/confirmedBy':   'test_player_004',
      'seasons/season_2026/leagues/league_a/matches/match_test_003/result/confirmedAt':   twoDaysAgo + 3_600_000,

      // ── Match 004 — CONFIRMED (dev beat marco 6-3, 7-5) ──────────────────
      'seasons/season_2026/leagues/league_a/matches/match_test_004/playerA':              'dev_test_uid',
      'seasons/season_2026/leagues/league_a/matches/match_test_004/playerB':              'test_player_002',
      'seasons/season_2026/leagues/league_a/matches/match_test_004/proposedBy':           'dev_test_uid',
      'seasons/season_2026/leagues/league_a/matches/match_test_004/proposedAt':           twoDaysAgo,
      'seasons/season_2026/leagues/league_a/matches/match_test_004/status':               'confirmed',
      'seasons/season_2026/leagues/league_a/matches/match_test_004/result/winner':        'dev_test_uid',
      'seasons/season_2026/leagues/league_a/matches/match_test_004/result/loser':         'test_player_002',
      'seasons/season_2026/leagues/league_a/matches/match_test_004/result/sets':          [{ a: 6, b: 3 }, { a: 7, b: 5 }],
      'seasons/season_2026/leagues/league_a/matches/match_test_004/result/enteredBy':     'dev_test_uid',
      'seasons/season_2026/leagues/league_a/matches/match_test_004/result/enteredAt':     yesterday,
      'seasons/season_2026/leagues/league_a/matches/match_test_004/result/confirmedBy':   'test_player_002',
      'seasons/season_2026/leagues/league_a/matches/match_test_004/result/confirmedAt':   yesterday,
      'seasons/season_2026/leagues/league_a/matches/match_test_004/confirmedAt':          yesterday,
      'seasons/season_2026/leagues/league_a/matches/match_test_004/confirmedBy':          'system',
      'seasons/season_2026/leagues/league_a/matches/match_test_004/eloDeltas/dev_test_uid':   14,
      'seasons/season_2026/leagues/league_a/matches/match_test_004/eloDeltas/test_player_002': -14,

      // ── Match 005 — CONFIRMED (sofia beat bruno — doesn't involve dev) ────
      'seasons/season_2026/leagues/league_a/matches/match_test_005/playerA':              'test_player_003',
      'seasons/season_2026/leagues/league_a/matches/match_test_005/playerB':              'test_player_004',
      'seasons/season_2026/leagues/league_a/matches/match_test_005/proposedBy':           'test_player_003',
      'seasons/season_2026/leagues/league_a/matches/match_test_005/proposedAt':           twoDaysAgo,
      'seasons/season_2026/leagues/league_a/matches/match_test_005/status':               'confirmed',
      'seasons/season_2026/leagues/league_a/matches/match_test_005/result/winner':        'test_player_003',
      'seasons/season_2026/leagues/league_a/matches/match_test_005/result/loser':         'test_player_004',
      'seasons/season_2026/leagues/league_a/matches/match_test_005/result/sets':          [{ a: 6, b: 4 }, { a: 6, b: 2 }],
      'seasons/season_2026/leagues/league_a/matches/match_test_005/result/enteredBy':     'test_player_003',
      'seasons/season_2026/leagues/league_a/matches/match_test_005/result/enteredAt':     twoDaysAgo,
      'seasons/season_2026/leagues/league_a/matches/match_test_005/result/confirmedBy':   'test_player_004',
      'seasons/season_2026/leagues/league_a/matches/match_test_005/result/confirmedAt':   twoDaysAgo + 7_200_000,
      'seasons/season_2026/leagues/league_a/matches/match_test_005/confirmedAt':          twoDaysAgo + 7_200_000,
      'seasons/season_2026/leagues/league_a/matches/match_test_005/confirmedBy':          'system',
      'seasons/season_2026/leagues/league_a/matches/match_test_005/eloDeltas/test_player_003': 12,
      'seasons/season_2026/leagues/league_a/matches/match_test_005/eloDeltas/test_player_004': -12,
    });

    console.log('✓ Season 2026 / A Division created');
    console.log('✓ Players: devplayer (1220), marco (1166), sofia (1262), brunoc (1138)');
    console.log('✓ match_test_001 → scheduled        (you vs marco)');
    console.log('✓ match_test_002 → result_pending   (sofia entered — you must confirm)');
    console.log('✓ match_test_003 → photo_pending    (you won — upload photo to confirm)');
    console.log('✓ match_test_004 → confirmed        (you beat marco 6-3, 7-5)');
    console.log('✓ match_test_005 → confirmed        (sofia beat bruno 6-4, 6-2)');
    console.log('Now run: window._atpTest.app()');
  };

  window._atpTest.clearLeague = async () => {
    console.log('Clearing dev league data…');
    await dbMultiUpdate({
      'config/defaultSeason':    null,
      'seasons/season_2026':     null,
      'players/dev_test_uid':    null,
      'players/test_player_002': null,
      'players/test_player_003': null,
      'players/test_player_004': null,
    });
    console.log('✓ Dev league data cleared. Invite codes preserved.');
  };

  // Seed a real player with a known password — used by Flow 3 (Login) e2e tests.
  // Test credentials: testlogin@atp.test / Test1234!  alias: logintester
  window._atpTest.seedLoginPlayer = async () => {
    const testEmail = 'testlogin@atp.test';
    const testUid   = 'test_login_uid';
    const emailKey  = toEmailKey(testEmail);
    const pwdHash   = simpleHash('Test1234!');
    await dbMultiUpdate({
      [`players/${testUid}/name`]:           'Login Tester',
      [`players/${testUid}/alias`]:          'logintester',
      [`players/${testUid}/username`]:       'logintester',
      [`players/${testUid}/email`]:          testEmail,
      [`players/${testUid}/passwordHash`]:   pwdHash,
      [`players/${testUid}/avatarId`]:       'adventurer::logintester',
      [`players/${testUid}/eloRating`]:      1000,
      [`players/${testUid}/status`]:         'active',
      [`players/${testUid}/selfAssessment`]: { level: 'intermediate', suggestedLeague: null },
      [`players/${testUid}/createdAt`]:      Date.now(),
      [`players/${testUid}/lastActive`]:     Date.now(),
      [`email_index/${emailKey}`]:           testUid,
    });
    console.log('✓ Login player seeded: testlogin@atp.test / Test1234! / alias: logintester');
  };

  // Direct read/write helpers — used by e2e tests to perform "admin" operations
  // (e.g. changing a player's status) without going through the Firebase console.
  // Path should NOT include the _dev/ prefix — DEV_ROOT is added automatically.
  window._atpTest.adminWrite = async (path, value) => {
    await dbSet(dbRef(path), value);
  };
  window._atpTest.adminRead = async (path) => {
    return dbGet(dbRef(path));
  };

  console.log('ATP Greenwich — dev mode.');
  console.log('  window.runEloTests()              — verify ELO logic');
  console.log('  window.runScoringTests()           — verify scoring logic');
  console.log('  window._atpTest.app()              — jump to app shell');
  console.log('  window._atpTest.avatarPicker()     — jump to avatar picker');
  console.log('  window._atpTest.seedTestData()     — write invite codes to Firebase');
  console.log('  window._atpTest.seedLeague()       — seed full league + match data (dev only)');
  console.log('  window._atpTest.clearLeague()      — wipe dev league data (dev only)');
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  const app = document.getElementById('app');

  // Read URL params before anything else — ?code= triggers invite flow
  const params = new URLSearchParams(window.location.search);
  const codeParam = params.get('code');

  const creds = getSavedCreds();

  if (!creds) {
    // If there's a code in the URL, showOnboarding will detect it and go straight to invite code screen
    showOnboarding(app, onAuthenticated);
    return;
  }

  // Verify saved credentials are still valid
  try {
    const player = await dbGet(pRef(creds.uid));

    if (!player || player.passwordHash !== creds.pwdHash) {
      clearCreds();
      showOnboarding(app, onAuthenticated);
      return;
    }

    if (player.status !== 'active') {
      // Player is mid-onboarding — show login to re-enter and continue
      clearCreds();
      showOnboarding(app, onAuthenticated);
      return;
    }

    // Valid session — launch app directly
    initAnalytics(creds.uid);
    logAppOpen(isPWA() ? 'pwa' : 'browser');
    showApp(app, player, creds, onSignOut);

  } catch (err) {
    console.error('Boot error:', err);
    showOnboarding(app, onAuthenticated);
  }
}

// ─── Auth callback ────────────────────────────────────────────────────────────
// Called by auth.js when any auth flow completes successfully.

function onAuthenticated(player, creds) {
  const app = document.getElementById('app');
  showApp(app, player, creds, onSignOut);
}

// ─── Sign out ─────────────────────────────────────────────────────────────────

function onSignOut() {
  clearCreds();
  window.location.reload();
}

// ─── Credential helpers ───────────────────────────────────────────────────────

function getSavedCreds() {
  try {
    const raw = localStorage.getItem('atp_player_creds');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearCreds() {
  localStorage.removeItem('atp_player_creds');
}

// ─── Start ────────────────────────────────────────────────────────────────────
boot();
