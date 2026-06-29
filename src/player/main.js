// src/player/main.js — v0.01
// Player app bootstrap. Checks auth state and routes to the right screen.
// Full auth UI and screen routing built in Phase 1B.

import { dbGet, dbRef } from '@shared/firebase.js';
import { logAppOpen, isPWA } from '@shared/analytics.js';
import { runEloTests } from '@shared/elo.js';
import { runScoringTests } from '@shared/scoring.js';

// Expose test runners globally for console use during development
if (import.meta.env.DEV) {
  window.runEloTests     = runEloTests;
  window.runScoringTests = runScoringTests;
  console.log('ATP Greenwich — dev mode');
  console.log('Run window.runEloTests() or window.runScoringTests() to verify logic.');
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────
async function boot() {
  const app = document.getElementById('app');

  // Check for saved credentials
  const creds = getSavedCreds();

  if (!creds) {
    // No credentials — show onboarding
    showOnboarding(app);
    return;
  }

  // Verify credentials against Firebase
  try {
    const player = await dbGet(dbRef('players/' + creds.uid));
    if (!player || player.passwordHash !== creds.pwdHash) {
      clearCreds();
      showOnboarding(app);
      return;
    }

    // Valid session — launch app
    logAppOpen(isPWA() ? 'pwa' : 'browser');
    showApp(app, player, creds);

  } catch (err) {
    console.error('Boot error:', err);
    showOnboarding(app);
  }
}

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

function showOnboarding(app) {
  // Phase 1B: full onboarding UI
  // Placeholder until auth screens are built
  app.innerHTML = `
    <div style="
      display:flex;flex-direction:column;align-items:center;
      justify-content:center;min-height:100dvh;padding:32px;text-align:center;
      font-family:'Lato',sans-serif;
    ">
      <div style="
        font-family:'Playfair Display',serif;font-size:48px;font-weight:700;
        color:#b84008;line-height:1;margin-bottom:8px;
      ">ATP</div>
      <div style="
        font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:3px;
        text-transform:uppercase;color:#8a7e72;margin-bottom:40px;
      ">Greenwich</div>
      <p style="color:#4a4038;font-size:15px;margin-bottom:32px;max-width:280px;line-height:1.6;">
        Amateur Tennis and Parrilla.<br>Private league for friends.
      </p>
      <button onclick="window._atpRequestAccess()" style="
        background:#b84008;color:white;border:none;border-radius:10px;
        padding:14px 32px;font-family:'Lato',sans-serif;font-size:15px;
        font-weight:700;cursor:pointer;width:100%;max-width:280px;margin-bottom:12px;
      ">Request Access</button>
      <button onclick="window._atpHaveCode()" style="
        background:transparent;color:#b84008;border:1.5px solid #b84008;
        border-radius:10px;padding:14px 32px;font-family:'Lato',sans-serif;
        font-size:15px;font-weight:700;cursor:pointer;width:100%;max-width:280px;
        margin-bottom:12px;
      ">I have an invite code</button>
      <button onclick="window._atpLogin()" style="
        background:transparent;color:#8a7e72;border:none;
        font-family:'Lato',sans-serif;font-size:14px;cursor:pointer;
        padding:8px;
      ">Already a member? Sign in</button>
      <div style="
        margin-top:48px;font-family:'IBM Plex Mono',monospace;
        font-size:10px;color:#c8bfb0;letter-spacing:1px;
      ">v0.01 — Phase 1A</div>
    </div>
  `;

  // Stub handlers — replaced in Phase 1B
  window._atpRequestAccess = () => alert('Request Access — coming in Phase 1B');
  window._atpHaveCode      = () => alert('Invite Code — coming in Phase 1B');
  window._atpLogin         = () => alert('Login — coming in Phase 1B');
}

function showApp(app, player, creds) {
  // Phase 1B: full app shell with bottom nav and tabs
  // Placeholder until main app UI is built
  app.innerHTML = `
    <div style="
      display:flex;flex-direction:column;align-items:center;
      justify-content:center;min-height:100dvh;padding:32px;text-align:center;
      font-family:'Lato',sans-serif;
    ">
      <div style="
        font-family:'Playfair Display',serif;font-size:32px;font-weight:700;
        color:#b84008;margin-bottom:8px;
      ">Welcome back</div>
      <div style="font-size:18px;color:#1c1814;font-weight:700;margin-bottom:4px;">
        ${player.name || 'Player'}
      </div>
      <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#8a7e72;margin-bottom:32px;">
        ELO ${player.eloRating || 1000}
      </div>
      <p style="color:#4a4038;font-size:14px;">
        Full app shell coming in Phase 1B.
      </p>
      <button onclick="window._atpSignOut()" style="
        margin-top:32px;background:transparent;color:#8a7e72;border:none;
        font-family:'Lato',sans-serif;font-size:14px;cursor:pointer;
      ">Sign out</button>
    </div>
  `;

  window._atpSignOut = () => {
    clearCreds();
    window.location.reload();
  };
}

// ─── Start ───────────────────────────────────────────────────────────────────
boot();
