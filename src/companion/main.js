// src/companion/main.js — v0.01
// Companion app bootstrap. Phase 1A placeholder — full UI in Phase 7.

import { dbGet, dbRef } from '@shared/firebase.js';
import { simpleHash } from '@shared/utils.js';

const COMPANION_CREDS_KEY = 'atp_companion_creds';

async function boot() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div style="
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      min-height:100dvh;padding:32px;text-align:center;font-family:'Lato',sans-serif;
    ">
      <div style="
        font-family:'Playfair Display',serif;font-size:28px;font-weight:700;
        color:#b84008;margin-bottom:4px;
      ">ATP</div>
      <div style="
        font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:2px;
        text-transform:uppercase;color:#8a7e72;margin-bottom:24px;
      ">Admin Companion</div>
      <p style="color:#4a4038;font-size:14px;">Coming in Phase 7.</p>
    </div>
  `;
}

boot();
