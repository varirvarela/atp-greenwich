// src/companion/main.js — ATP Greenwich Admin Companion (Phase 7)
// Mobile-first courtside score entry. Logs in with admin credentials,
// shows all open matches, and lets you enter results on the spot.

import { dbGet, dbRef, dbUpdate, dbMultiUpdate, dbListen, pRef, sRef } from '@shared/firebase.js';
import { escHtml, simpleHash, timeAgo } from '@shared/utils.js';
import { calculateElo } from '@shared/elo.js';
import { avatarToSvg } from '@player/avatars.js';

const COMP_KEY         = 'atp_companion_creds';
const DEFAULT_PASSWORD = 'atpgreenwich2026';

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function boot() {
  const app   = document.getElementById('app');
  const saved = _getSaved();
  if (saved) {
    try {
      const config = await dbGet(dbRef('config'));
      const stored = config && config.adminPasswordHash;
      if (stored ? stored === saved.pwdHash : saved.pwdHash === simpleHash(DEFAULT_PASSWORD)) {
        showCompanionShell(app);
        return;
      }
    } catch {}
  }
  showLogin(app);
}

function _getSaved() {
  try { return JSON.parse(localStorage.getItem(COMP_KEY) || 'null'); } catch { return null; }
}

// ─── Login ────────────────────────────────────────────────────────────────────

function showLogin(app) {
  app.innerHTML = `
    <div style="min-height:100dvh;display:flex;flex-direction:column;align-items:center;
      justify-content:center;padding:32px 24px;background:var(--bg);">
      <div style="text-align:center;margin-bottom:32px;">
        <div style="font-family:'Playfair Display',serif;font-size:40px;font-weight:700;
          color:#b84008;line-height:1;">ATP</div>
        <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:3px;
          text-transform:uppercase;color:#8a7e72;margin-top:6px;">Court Companion</div>
      </div>
      <div style="width:100%;max-width:340px;">
        <div style="margin-bottom:10px;">
          <input id="comp-pwd" type="password"
            style="width:100%;padding:13px 16px;border:1.5px solid #ddd6c8;border-radius:12px;
              font-size:16px;background:#fff;color:#1c1814;outline:none;
              -webkit-appearance:none;"
            placeholder="Admin password" autocomplete="current-password"/>
        </div>
        <button id="btn-comp-login"
          style="width:100%;background:#b84008;color:#fff;border:none;border-radius:12px;
            padding:14px;font-size:16px;font-weight:700;cursor:pointer;">
          Sign In
        </button>
        <div id="comp-error" style="display:none;color:#a02820;font-size:13px;
          text-align:center;margin-top:10px;">
          Incorrect password
        </div>
      </div>
    </div>
  `;

  const pwd     = app.querySelector('#comp-pwd');
  const btn     = app.querySelector('#btn-comp-login');
  const errEl   = app.querySelector('#comp-error');

  async function tryLogin() {
    const hash = simpleHash(pwd.value);
    btn.disabled = true; btn.textContent = '…'; errEl.style.display = 'none';
    let valid = hash === simpleHash(DEFAULT_PASSWORD);
    if (!valid) {
      try {
        const cfg = await dbGet(dbRef('config'));
        valid = cfg && cfg.adminPasswordHash === hash;
      } catch {}
    }
    if (valid) {
      localStorage.setItem(COMP_KEY, JSON.stringify({ pwdHash: hash }));
      showCompanionShell(app);
    } else {
      errEl.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Sign In';
      pwd.value = '';
    }
  }

  btn.addEventListener('click', tryLogin);
  pwd.addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(); });
  pwd.focus();
}

// ─── Companion shell ──────────────────────────────────────────────────────────

function showCompanionShell(app) {
  app.innerHTML = `
    <div style="min-height:100dvh;display:flex;flex-direction:column;background:var(--bg);">
      <div style="position:sticky;top:0;z-index:50;background:var(--bg);
        border-bottom:1px solid #ddd6c8;padding:0 16px;height:52px;
        display:flex;align-items:center;justify-content:space-between;">
        <div style="font-family:'Playfair Display',serif;font-size:18px;font-weight:700;
          color:#b84008;">ATP</div>
        <div style="font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:2px;
          text-transform:uppercase;color:#8a7e72;" id="comp-title">Matches</div>
        <button id="btn-comp-signout" style="background:transparent;border:none;
          color:#8a7e72;font-size:12px;cursor:pointer;padding:4px 0;">
          Sign out
        </button>
      </div>
      <div id="comp-screen" style="flex:1;overflow-y:auto;"></div>
    </div>
  `;

  app.querySelector('#btn-comp-signout').addEventListener('click', () => {
    localStorage.removeItem(COMP_KEY);
    window.location.reload();
  });

  _setupInstallPrompt();
  showMatchList(app.querySelector('#comp-screen'), app.querySelector('#comp-title'));
}

function _setupInstallPrompt() {
  if (localStorage.getItem('comp_install_dismissed') === '1') return;
  if (window.matchMedia('(display-mode: standalone)').matches) return;

  let deferredPrompt = null;

  const banner = document.createElement('div');
  banner.style.cssText = `
    display:none;position:fixed;bottom:16px;left:50%;transform:translateX(-50%);
    background:#1c1814;color:#fff;border-radius:12px;padding:10px 14px 10px 16px;
    align-items:center;gap:10px;font-size:13px;z-index:900;
    box-shadow:0 4px 16px rgba(28,24,20,0.25);max-width:calc(100vw - 32px);
  `;
  banner.innerHTML = `
    <span style="flex:1;">Add Courtside to home screen</span>
    <button id="cp-install" style="background:#b84008;color:#fff;border:none;
      border-radius:8px;padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer;">
      Install</button>
    <button id="cp-dismiss" style="background:none;border:none;color:rgba(255,255,255,0.6);
      cursor:pointer;font-size:18px;line-height:1;padding:0 2px;">×</button>
  `;
  document.body.appendChild(banner);

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    banner.style.display = 'flex';
  });

  banner.querySelector('#cp-install').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    banner.remove();
  });

  banner.querySelector('#cp-dismiss').addEventListener('click', () => {
    localStorage.setItem('comp_install_dismissed', '1');
    banner.remove();
  });
}

// ─── Match list ───────────────────────────────────────────────────────────────

function showMatchList(screen, titleEl) {
  titleEl.textContent = 'Open Matches';
  screen.innerHTML = `
    <div style="padding:16px;text-align:center;">
      <div class="spinner" style="margin:0 auto 10px;"></div>
      <p style="font-size:13px;color:#8a7e72;">Loading matches…</p>
    </div>
  `;

  (async () => {
    const config = await dbGet(dbRef('config'));
    const sid    = config && config.defaultSeason;
    if (!sid) { _noData(screen, 'No active season'); return; }

    const leagues    = await dbGet(sRef(sid, null, 'leagues'));
    const allPlayers = await dbGet(pRef()) || {};
    if (!leagues)  { _noData(screen, 'No leagues configured'); return; }

    let openMatches = [];
    for (const [lid, league] of Object.entries(leagues)) {
      const matchesObj = await dbGet(sRef(sid, lid, 'matches'));
      if (!matchesObj) continue;
      for (const [mid, m] of Object.entries(matchesObj)) {
        if (['scheduled', 'result_pending', 'photo_pending'].includes(m.status)) {
          openMatches.push({ mid, lid, sid, league, ...m });
        }
      }
    }
    openMatches.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

    if (!openMatches.length) {
      _noData(screen, 'No open matches — all caught up!');
      return;
    }

    screen.innerHTML = `
      <div style="padding:12px 0 80px;">
        ${openMatches.map(m => {
          const pA = allPlayers[m.playerA] || {};
          const pB = allPlayers[m.playerB] || {};
          const statusText = { scheduled: 'Scheduled', result_pending: 'Awaiting confirm',
            photo_pending: 'Awaiting photo' }[m.status] || m.status;
          const statusColor = { scheduled: '#8a7e72', result_pending: '#a07e10',
            photo_pending: '#0a6a5e' }[m.status] || '#8a7e72';
          return `
            <div data-mid="${m.mid}" data-lid="${m.lid}" data-sid="${m.sid}"
              class="comp-match-row"
              style="display:flex;align-items:center;gap:12px;padding:14px 16px;
                border-bottom:1px solid #ddd6c8;background:#fff;cursor:pointer;
                active-background:#f0ebe2;transition:background 0.1s;">
              <div style="flex:1;min-width:0;">
                <div style="font-weight:700;font-size:15px;color:#1c1814;
                  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                  ${escHtml(pA.alias || pA.name || m.playerA)}
                  <span style="color:#8a7e72;font-weight:400;margin:0 6px;">vs</span>
                  ${escHtml(pB.alias || pB.name || m.playerB)}
                </div>
                <div style="font-size:12px;color:#8a7e72;margin-top:3px;">
                  ${escHtml(m.league && m.league.name || '')}
                  ${m.createdAt ? ' · ' + timeAgo(m.createdAt) : ''}
                </div>
              </div>
              <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;
                color:${statusColor};letter-spacing:0.5px;white-space:nowrap;flex-shrink:0;">
                ${escHtml(statusText)}
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c8bfb0"
                stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m9 18 6-6-6-6"/>
              </svg>
            </div>
          `;
        }).join('')}
      </div>
    `;

    screen.querySelectorAll('.comp-match-row').forEach(row => {
      row.addEventListener('touchstart', () => { row.style.background = '#f0ebe2'; }, { passive: true });
      row.addEventListener('touchend',   () => { row.style.background = '#fff'; });
      row.addEventListener('click', () => {
        const m = openMatches.find(x => x.mid === row.dataset.mid);
        if (m) showScoreEntry(screen, titleEl, m, allPlayers, () => showMatchList(screen, titleEl));
      });
    });
  })().catch(err => {
    console.error('Companion match list error:', err);
    _noData(screen, 'Error loading matches');
  });
}

// ─── Score entry ──────────────────────────────────────────────────────────────

function showScoreEntry(screen, titleEl, match, allPlayers, onBack) {
  const pA      = allPlayers[match.playerA] || {};
  const pB      = allPlayers[match.playerB] || {};
  const isPro10 = match.format === 'pro10';
  titleEl.textContent = 'Enter Result';

  let selectedWinner = null;
  let sets = [{ a: '', b: '' }, { a: '', b: '' }];
  let pro10Score = { a: '', b: '' };

  function render() {
    screen.innerHTML = `
      <div style="padding:16px 16px 80px;">

        <!-- Back button -->
        <button id="btn-back" style="background:transparent;border:none;color:#8a7e72;
          font-size:14px;cursor:pointer;padding:4px 0;margin-bottom:16px;
          display:flex;align-items:center;gap:6px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m15 18-6-6 6-6"/>
          </svg>
          All matches
        </button>

        <!-- Match header -->
        <div style="background:#fff;border:1px solid #ddd6c8;border-radius:14px;
          padding:16px;margin-bottom:16px;">
          <div style="display:flex;align-items:center;justify-content:space-between;
            margin-bottom:10px;">
            <div style="font-size:11px;font-family:'IBM Plex Mono',monospace;letter-spacing:1px;
              text-transform:uppercase;color:#8a7e72;">
              ${escHtml(match.league && match.league.name || 'Match')}
            </div>
            ${isPro10 ? `<div style="font-family:'IBM Plex Mono',monospace;font-size:9px;
              letter-spacing:1px;text-transform:uppercase;color:#b84008;
              background:#fdf0e8;padding:2px 8px;border-radius:8px;">Pro 10</div>` : ''}
          </div>
          <div style="display:flex;align-items:center;justify-content:space-around;gap:8px;">
            <div style="text-align:center;flex:1;">
              ${avatarToSvg(pA.avatarId || null, 40)}
              <div style="font-weight:700;font-size:14px;margin-top:6px;color:#1c1814;">
                ${escHtml(pA.alias || pA.name || match.playerA)}
              </div>
            </div>
            <div style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:#8a7e72;">vs</div>
            <div style="text-align:center;flex:1;">
              ${avatarToSvg(pB.avatarId || null, 40)}
              <div style="font-weight:700;font-size:14px;margin-top:6px;color:#1c1814;">
                ${escHtml(pB.alias || pB.name || match.playerB)}
              </div>
            </div>
          </div>
        </div>

        <!-- Winner selection -->
        <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:1.5px;
          text-transform:uppercase;color:#8a7e72;margin-bottom:8px;">Winner</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
          <button id="btn-winner-a" class="winner-btn"
            style="padding:14px 10px;border-radius:12px;font-weight:700;font-size:14px;
              border:2px solid ${selectedWinner === match.playerA ? '#b84008' : '#ddd6c8'};
              background:${selectedWinner === match.playerA ? '#fdf0e8' : '#fff'};
              color:${selectedWinner === match.playerA ? '#b84008' : '#1c1814'};
              cursor:pointer;transition:all 0.15s;">
            ${escHtml(pA.alias || pA.name || match.playerA)}
          </button>
          <button id="btn-winner-b" class="winner-btn"
            style="padding:14px 10px;border-radius:12px;font-weight:700;font-size:14px;
              border:2px solid ${selectedWinner === match.playerB ? '#b84008' : '#ddd6c8'};
              background:${selectedWinner === match.playerB ? '#fdf0e8' : '#fff'};
              color:${selectedWinner === match.playerB ? '#b84008' : '#1c1814'};
              cursor:pointer;transition:all 0.15s;">
            ${escHtml(pB.alias || pB.name || match.playerB)}
          </button>
        </div>

        ${isPro10 ? `
          <!-- Pro10 single score -->
          <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:1.5px;
            text-transform:uppercase;color:#8a7e72;margin-bottom:8px;">Score (0 – 10)</div>
          <div style="display:flex;align-items:flex-end;gap:12px;justify-content:center;
            margin-bottom:20px;">
            <div style="text-align:center;">
              <div style="font-size:11px;color:#8a7e72;margin-bottom:6px;">
                ${escHtml(pA.alias || pA.name || match.playerA)}
              </div>
              <input id="pro10-a" type="number" min="0" max="10" inputmode="numeric"
                value="${pro10Score.a}"
                style="width:72px;padding:12px;border:1.5px solid #ddd6c8;border-radius:10px;
                  font-size:24px;font-family:'IBM Plex Mono',monospace;text-align:center;
                  background:#fff;color:#1c1814;outline:none;-webkit-appearance:none;"/>
            </div>
            <div style="color:#8a7e72;font-size:20px;padding-bottom:12px;">–</div>
            <div style="text-align:center;">
              <div style="font-size:11px;color:#8a7e72;margin-bottom:6px;">
                ${escHtml(pB.alias || pB.name || match.playerB)}
              </div>
              <input id="pro10-b" type="number" min="0" max="10" inputmode="numeric"
                value="${pro10Score.b}"
                style="width:72px;padding:12px;border:1.5px solid #ddd6c8;border-radius:10px;
                  font-size:24px;font-family:'IBM Plex Mono',monospace;text-align:center;
                  background:#fff;color:#1c1814;outline:none;-webkit-appearance:none;"/>
            </div>
          </div>
        ` : `
          <!-- BO3 set scores -->
          <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:1.5px;
            text-transform:uppercase;color:#8a7e72;margin-bottom:8px;">Set Scores</div>
          ${sets.map((s, i) => `
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
              <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#8a7e72;
                width:36px;flex-shrink:0;">Set ${i + 1}</div>
              <input class="set-score-a" data-set="${i}" data-side="a"
                type="number" min="0" max="99" inputmode="numeric" value="${s.a}"
                style="width:56px;padding:10px;border:1.5px solid #ddd6c8;border-radius:10px;
                  font-size:18px;font-family:'IBM Plex Mono',monospace;text-align:center;
                  background:#fff;color:#1c1814;outline:none;-webkit-appearance:none;"/>
              <div style="color:#8a7e72;font-size:16px;">–</div>
              <input class="set-score-b" data-set="${i}" data-side="b"
                type="number" min="0" max="99" inputmode="numeric" value="${s.b}"
                style="width:56px;padding:10px;border:1.5px solid #ddd6c8;border-radius:10px;
                  font-size:18px;font-family:'IBM Plex Mono',monospace;text-align:center;
                  background:#fff;color:#1c1814;outline:none;-webkit-appearance:none;"/>
              ${i > 1 ? `<button data-remove-set="${i}" style="background:transparent;
                border:none;color:#8a7e72;cursor:pointer;font-size:18px;padding:4px;">×</button>` : ''}
            </div>
          `).join('')}
          <button id="btn-add-set"
            style="width:100%;background:transparent;border:1.5px dashed #ddd6c8;
              border-radius:10px;padding:10px;color:#8a7e72;font-size:13px;cursor:pointer;
              margin-bottom:20px;">
            + Add 3rd set
          </button>
        `}

        <!-- Submit -->
        <button id="btn-submit-result"
          ${!selectedWinner ? 'disabled' : ''}
          style="width:100%;background:${selectedWinner ? '#b84008' : '#ddd6c8'};
            color:#fff;border:none;border-radius:12px;padding:16px;font-size:16px;
            font-weight:700;cursor:${selectedWinner ? 'pointer' : 'not-allowed'};
            margin-bottom:12px;">
          Confirm Result
        </button>
        <div id="comp-submit-error" style="display:none;color:#a02820;font-size:13px;
          text-align:center;"></div>
      </div>
    `;

    // Wire back
    screen.querySelector('#btn-back').addEventListener('click', onBack);

    // Wire winner buttons
    screen.querySelector('#btn-winner-a').addEventListener('click', () => {
      selectedWinner = match.playerA; render();
    });
    screen.querySelector('#btn-winner-b').addEventListener('click', () => {
      selectedWinner = match.playerB; render();
    });

    if (isPro10) {
      screen.querySelector('#pro10-a').addEventListener('input', e => { pro10Score.a = e.target.value; });
      screen.querySelector('#pro10-b').addEventListener('input', e => { pro10Score.b = e.target.value; });
    } else {
      // Wire set score inputs
      screen.querySelectorAll('.set-score-a, .set-score-b').forEach(input => {
        input.addEventListener('input', () => {
          sets[parseInt(input.dataset.set, 10)][input.dataset.side] = input.value;
        });
      });
      // Add set
      screen.querySelector('#btn-add-set').addEventListener('click', () => {
        if (sets.length >= 3) return;
        sets.push({ a: '', b: '' });
        render();
      });
      // Remove set
      screen.querySelectorAll('[data-remove-set]').forEach(btn => {
        btn.addEventListener('click', () => {
          sets.splice(parseInt(btn.dataset.removeSet, 10), 1);
          render();
        });
      });
    }

    // Submit
    screen.querySelector('#btn-submit-result').addEventListener('click', async () => {
      const errEl = screen.querySelector('#comp-submit-error');
      if (!selectedWinner) { errEl.textContent = 'Select a winner'; errEl.style.display = 'block'; return; }

      const submitBtn = screen.querySelector('#btn-submit-result');
      submitBtn.disabled = true; submitBtn.textContent = 'Saving…';
      errEl.style.display = 'none';

      try {
        const allPlayersLatest = await dbGet(pRef()) || {};
        const pAData = allPlayersLatest[match.playerA] || {};
        const pBData = allPlayersLatest[match.playerB] || {};
        const eloA   = pAData.eloRating || 1000;
        const eloB   = pBData.eloRating || 1000;
        const aWins  = selectedWinner === match.playerA;
        const eloRes = calculateElo(eloA, eloB, aWins ? 'a' : 'b');

        const now    = Date.now();
        const updates = {};
        const base   = `seasons/${match.sid}/leagues/${match.lid}/matches/${match.mid}`;
        updates[base + '/status']        = 'confirmed';
        updates[base + '/confirmedAt']   = now;
        updates[base + '/adminOverride'] = true;
        updates[`players/${match.playerA}/eloRating`] = eloRes.newA;
        updates[`players/${match.playerB}/eloRating`] = eloRes.newB;

        if (isPro10) {
          const sA = parseInt(screen.querySelector('#pro10-a').value, 10);
          const sB = parseInt(screen.querySelector('#pro10-b').value, 10);
          updates[base + '/result'] = {
            winner: selectedWinner,
            score: { a: isNaN(sA) ? 0 : sA, b: isNaN(sB) ? 0 : sB },
          };
        } else {
          const parsedSets = sets
            .map(s => ({ a: parseInt(s.a, 10), b: parseInt(s.b, 10) }))
            .filter(s => !isNaN(s.a) && !isNaN(s.b));
          updates[base + '/result'] = { winner: selectedWinner, sets: parsedSets };
        }

        await dbMultiUpdate(updates);
        _showSuccess(screen, titleEl, pA, pB, aWins, eloRes, () => showMatchList(screen, titleEl));
      } catch (err) {
        console.error('Submit error:', err);
        errEl.textContent = 'Failed to save. Try again.';
        errEl.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Confirm Result';
      }
    });
  }

  render();
}

// ─── Success screen ───────────────────────────────────────────────────────────

function _showSuccess(screen, titleEl, pA, pB, aWins, eloRes, onContinue) {
  titleEl.textContent = 'Result Saved';
  const winner = aWins ? pA : pB;
  const loser  = aWins ? pB : pA;
  const deltaW = aWins ? eloRes.deltaA : eloRes.deltaB;
  const deltaL = aWins ? eloRes.deltaB : eloRes.deltaA;

  screen.innerHTML = `
    <div style="min-height:60dvh;display:flex;flex-direction:column;align-items:center;
      justify-content:center;padding:32px 24px;text-align:center;gap:16px;">
      <div style="font-size:48px;">🎾</div>
      <div style="font-family:'Playfair Display',serif;font-size:22px;font-weight:700;
        color:#1c1814;">Result Confirmed</div>
      <div style="font-size:15px;color:#4a4038;">
        <strong>${escHtml(winner.alias || winner.name || '')}</strong> won
      </div>
      <div style="background:#fff;border:1px solid #ddd6c8;border-radius:12px;
        padding:14px 20px;width:100%;max-width:260px;">
        <div style="display:flex;justify-content:space-between;font-size:13px;">
          <span style="color:#4a4038;">${escHtml(winner.alias || winner.name || '')}</span>
          <span style="font-family:'IBM Plex Mono',monospace;color:#0a6a5e;font-weight:700;">
            +${deltaW}
          </span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-top:8px;">
          <span style="color:#4a4038;">${escHtml(loser.alias || loser.name || '')}</span>
          <span style="font-family:'IBM Plex Mono',monospace;color:#a02820;font-weight:700;">
            ${deltaL}
          </span>
        </div>
      </div>
      <button id="btn-next-match" style="background:#b84008;color:#fff;border:none;
        border-radius:12px;padding:14px 32px;font-size:15px;font-weight:700;cursor:pointer;
        margin-top:8px;">
        Next Match
      </button>
    </div>
  `;

  screen.querySelector('#btn-next-match').addEventListener('click', onContinue);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _noData(screen, msg) {
  screen.innerHTML = `
    <div style="min-height:50dvh;display:flex;flex-direction:column;align-items:center;
      justify-content:center;gap:12px;padding:32px;text-align:center;">
      <div style="font-size:32px;">🎾</div>
      <div style="font-size:15px;color:#4a4038;">${escHtml(msg)}</div>
    </div>
  `;
}

// ─── CSS variables used in inline styles ─────────────────────────────────────
// Injected at runtime so companion doesn't need a separate stylesheet.
const style = document.createElement('style');
style.textContent = `
  :root {
    --bg: #f7f3ec; --surface: #fff; --surface2: #f0ebe2;
    --border: #ddd6c8; --border2: #c8bfb0;
    --text: #1c1814; --text2: #4a4038; --text3: #8a7e72;
    --ace: #b84008; --ace2: #0a6a5e; --ace3: #a02820;
    --ace-bg: #fdf0e8; --ace2-bg: #e8f5f2; --ace3-bg: #fcecea;
    --font-serif: 'Playfair Display', serif;
    --font-mono: 'IBM Plex Mono', monospace;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: 'Lato', sans-serif;
    min-height: 100dvh; -webkit-text-size-adjust: 100%; }
  input[type=number]::-webkit-inner-spin-button,
  input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  input[type=number] { -moz-appearance: textfield; }
  .spinner {
    width: 24px; height: 24px; border: 2px solid #ddd6c8; border-top-color: #b84008;
    border-radius: 50%; animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
`;
document.head.appendChild(style);

boot();
