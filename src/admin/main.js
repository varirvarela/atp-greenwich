// src/admin/main.js — v0.01
// Admin app bootstrap. Phase 1A placeholder — full UI in Phase 1B.

import { dbGet, dbRef } from '@shared/firebase.js';
import { simpleHash } from '@shared/utils.js';
import { runEloTests } from '@shared/elo.js';
import { runScoringTests } from '@shared/scoring.js';

// Expose test runners in admin for easy verification
window.runEloTests     = runEloTests;
window.runScoringTests = runScoringTests;
console.log('ATP Greenwich Admin — v0.01');
console.log('Run window.runEloTests() or window.runScoringTests() to verify logic.');

const ADMIN_CREDS_KEY = 'atp_admin_creds';
const DEFAULT_PASSWORD = 'atpgreenwich2026'; // change on first run via Settings

async function boot() {
  const app = document.getElementById('app');
  const saved = getSavedAdminCreds();

  if (saved && saved.pwdHash === simpleHash(DEFAULT_PASSWORD)) {
    showAdminShell(app);
    return;
  }

  if (saved) {
    // Verify against config
    try {
      const config = await dbGet(dbRef('config'));
      const storedHash = config && config.adminPasswordHash;
      if (storedHash && storedHash === saved.pwdHash) {
        showAdminShell(app);
        return;
      }
    } catch (err) {
      console.error('Admin boot error:', err);
    }
  }

  showAdminLogin(app);
}

function getSavedAdminCreds() {
  try {
    const raw = localStorage.getItem(ADMIN_CREDS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function showAdminLogin(app) {
  app.innerHTML = `
    <div style="
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      min-height:100vh;padding:32px;font-family:'Lato',sans-serif;
    ">
      <div style="
        font-family:'Playfair Display',serif;font-size:32px;font-weight:700;
        color:#b84008;margin-bottom:4px;
      ">ATP Greenwich</div>
      <div style="
        font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:2px;
        text-transform:uppercase;color:#8a7e72;margin-bottom:40px;
      ">Admin</div>
      <div style="width:100%;max-width:360px;">
        <input id="admin-pwd" type="password" placeholder="Admin password"
          style="
            width:100%;padding:12px 16px;border:1.5px solid #ddd6c8;border-radius:8px;
            font-family:'Lato',sans-serif;font-size:15px;background:#fff;
            color:#1c1814;margin-bottom:12px;outline:none;
          "
        />
        <button onclick="window._atpAdminLogin()" style="
          width:100%;background:#b84008;color:white;border:none;border-radius:8px;
          padding:13px;font-family:'Lato',sans-serif;font-size:15px;font-weight:700;
          cursor:pointer;
        ">Sign In</button>
        <div id="admin-error" style="
          color:#a02820;font-size:13px;text-align:center;margin-top:10px;display:none;
        ">Incorrect password</div>
      </div>
    </div>
  `;

  document.getElementById('admin-pwd').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') window._atpAdminLogin();
  });

  window._atpAdminLogin = async () => {
    const pwd = document.getElementById('admin-pwd').value;
    const hash = simpleHash(pwd);
    const errEl = document.getElementById('admin-error');

    // Check against default or stored hash
    let valid = hash === simpleHash(DEFAULT_PASSWORD);
    if (!valid) {
      try {
        const config = await dbGet(dbRef('config'));
        valid = config && config.adminPasswordHash === hash;
      } catch {}
    }

    if (valid) {
      localStorage.setItem(ADMIN_CREDS_KEY, JSON.stringify({ pwdHash: hash }));
      showAdminShell(document.getElementById('app'));
    } else {
      errEl.style.display = 'block';
      document.getElementById('admin-pwd').value = '';
    }
  };
}

function showAdminShell(app) {
  app.innerHTML = `
    <div style="padding:40px;font-family:'Lato',sans-serif;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:32px;border-bottom:1px solid #ddd6c8;padding-bottom:16px;">
        <div>
          <div style="font-family:'Playfair Display',serif;font-size:24px;font-weight:700;color:#b84008;">ATP Greenwich</div>
          <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#8a7e72;">Admin Dashboard · v0.01</div>
        </div>
        <button onclick="window._atpAdminSignOut()" style="
          background:transparent;border:1px solid #ddd6c8;border-radius:6px;
          padding:6px 14px;font-family:'IBM Plex Mono',monospace;font-size:11px;
          color:#8a7e72;cursor:pointer;
        ">Sign out</button>
      </div>
      <p style="color:#4a4038;">Full admin UI coming in Phase 1B and Phase 2.</p>
      <p style="color:#8a7e72;font-size:13px;margin-top:8px;">
        Open your browser console and run <code>window.runEloTests()</code> or 
        <code>window.runScoringTests()</code> to verify logic modules.
      </p>
    </div>
  `;

  window._atpAdminSignOut = () => {
    localStorage.removeItem(ADMIN_CREDS_KEY);
    window.location.reload();
  };
}

boot();
