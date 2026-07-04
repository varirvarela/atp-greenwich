// src/admin/main.js — ATP Greenwich Admin Dashboard
// Desktop app for managing players, leagues, invite codes, matches, and bracket.
// Auth: single admin password stored in config/adminPasswordHash (or default).

import '@admin/style.css';
import { dbGet, dbSet, dbRef, dbUpdate, dbPush, dbRemove, dbMultiUpdate, pRef, sRef } from '@shared/firebase.js';
import { escHtml, simpleHash, generateUid, generateInviteCode, timeAgo } from '@shared/utils.js';
import { buildLeagueTable, isQualified, getQualifiedPlayers } from '@shared/scoring.js';
import { calculateElo } from '@shared/elo.js';
import { avatarToSvg } from '@player/avatars.js';

const ADMIN_CREDS_KEY  = 'atp_admin_creds';
const DEFAULT_PASSWORD = 'atpgreenwich2026';

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function boot() {
  const app   = document.getElementById('app');
  const saved = _getSavedCreds();

  if (saved) {
    try {
      const config     = await dbGet(dbRef('config'));
      const storedHash = config && config.adminPasswordHash;
      if (storedHash ? storedHash === saved.pwdHash
                     : saved.pwdHash === simpleHash(DEFAULT_PASSWORD)) {
        showAdminShell(app);
        return;
      }
    } catch {}
  }

  showAdminLogin(app);
}

function _getSavedCreds() {
  try { return JSON.parse(localStorage.getItem(ADMIN_CREDS_KEY) || 'null'); } catch { return null; }
}

// ─── Login screen ─────────────────────────────────────────────────────────────

function showAdminLogin(app) {
  app.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;
      background:var(--bg);padding:24px;">
      <div style="width:100%;max-width:360px;">
        <div style="text-align:center;margin-bottom:32px;">
          <div style="font-family:var(--font-serif);font-size:36px;font-weight:700;
            color:var(--ace);line-height:1;">ATP</div>
          <div style="font-family:var(--font-mono);font-size:10px;letter-spacing:2.5px;
            text-transform:uppercase;color:var(--text3);margin-top:4px;">Admin Dashboard</div>
        </div>
        <div class="admin-form-panel">
          <div class="admin-input-group">
            <label class="admin-input-label">Password</label>
            <input id="admin-pwd" type="password" class="admin-input" placeholder="Admin password" autocomplete="current-password"/>
          </div>
          <button id="btn-admin-login" class="btn-admin btn-primary" style="width:100%;padding:10px;">
            Sign In
          </button>
          <div id="admin-login-error" style="display:none;color:var(--ace3);font-size:12px;
            text-align:center;margin-top:10px;">
            Incorrect password
          </div>
        </div>
      </div>
    </div>
  `;

  const pwdInput = app.querySelector('#admin-pwd');
  const loginBtn = app.querySelector('#btn-admin-login');
  const errEl    = app.querySelector('#admin-login-error');

  async function tryLogin() {
    const pwd  = pwdInput.value;
    const hash = simpleHash(pwd);
    errEl.style.display = 'none';
    loginBtn.disabled = true;
    loginBtn.textContent = '…';

    let valid = hash === simpleHash(DEFAULT_PASSWORD);
    if (!valid) {
      try {
        const config = await dbGet(dbRef('config'));
        valid = config && config.adminPasswordHash === hash;
      } catch {}
    }

    if (valid) {
      localStorage.setItem(ADMIN_CREDS_KEY, JSON.stringify({ pwdHash: hash }));
      showAdminShell(app);
    } else {
      errEl.style.display = 'block';
      loginBtn.disabled = false;
      loginBtn.textContent = 'Sign In';
      pwdInput.value = '';
      pwdInput.focus();
    }
  }

  loginBtn.addEventListener('click', tryLogin);
  pwdInput.addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(); });
  pwdInput.focus();
}

// ─── App shell ────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { id: 'players',  label: 'Players',      icon: userIcon() },
  { id: 'leagues',  label: 'Leagues',      icon: tableIcon() },
  { id: 'invites',  label: 'Invite Codes', icon: keyIcon() },
  { id: 'matches',  label: 'Matches',      icon: ballIcon() },
  { id: 'bracket',  label: 'Bracket',      icon: bracketIcon() },
  { id: 'settings', label: 'Settings',     icon: gearIcon() },
];

function showAdminShell(app) {
  app.innerHTML = `
    <div class="admin-shell" id="admin-shell">
      <div class="sidebar-overlay" id="sidebar-overlay"></div>
      <aside class="admin-sidebar" id="admin-sidebar">
        <div class="admin-brand">
          <div class="admin-logo">ATP</div>
          <div class="admin-sub">Admin Dashboard</div>
        </div>
        <nav class="admin-nav">
          ${NAV_ITEMS.map(it => `
            <button class="admin-nav-item" data-section="${it.id}">
              ${it.icon}${escHtml(it.label)}
            </button>
          `).join('')}
        </nav>
        <div class="admin-signout">
          <button class="admin-signout-btn" id="btn-admin-signout">Sign out</button>
        </div>
      </aside>
      <main class="admin-main">
        <div class="admin-mobile-topbar">
          <button class="admin-hamburger" id="btn-hamburger" aria-label="Open menu">
            <span></span><span></span><span></span>
          </button>
          <div style="font-family:var(--font-serif);font-weight:700;color:var(--ace);font-size:18px;">ATP</div>
          <div style="width:40px;"></div>
        </div>
        <div class="admin-content" id="admin-content">
          <div class="admin-loading"><div class="spinner"></div></div>
        </div>
      </main>
    </div>
  `;

  const sidebar  = app.querySelector('#admin-sidebar');
  const overlay  = app.querySelector('#sidebar-overlay');
  const hamburger = app.querySelector('#btn-hamburger');

  function openSidebar()  { sidebar.classList.add('open');  overlay.classList.add('open'); }
  function closeSidebar() { sidebar.classList.remove('open'); overlay.classList.remove('open'); }

  hamburger.addEventListener('click', () => {
    sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
  });
  overlay.addEventListener('click', closeSidebar);

  app.querySelectorAll('.admin-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      closeSidebar();
      _navTo(btn.dataset.section);
    });
  });

  app.querySelector('#btn-admin-signout').addEventListener('click', () => {
    localStorage.removeItem(ADMIN_CREDS_KEY);
    window.location.reload();
  });

  _navTo('players');
}

function _navTo(sectionId) {
  document.querySelectorAll('.admin-nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.section === sectionId);
  });
  const content = document.getElementById('admin-content');
  if (!content) return;
  content.innerHTML = `<div class="admin-loading"><div class="spinner"></div></div>`;
  _renderSection(sectionId, content).catch(err => {
    content.innerHTML = `<div class="admin-empty" style="color:var(--ace3);">
      Error loading section: ${escHtml(err.message)}
    </div>`;
  });
}

async function _renderSection(id, el) {
  switch (id) {
    case 'players':  return renderPlayers(el);
    case 'leagues':  return renderLeagues(el);
    case 'invites':  return renderInvites(el);
    case 'matches':  return renderMatches(el);
    case 'bracket':  return renderBracketAdmin(el);
    case 'settings': return renderSettings(el);
  }
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function toast(msg, type = '') {
  const t = document.createElement('div');
  t.className = `admin-toast${type ? ' ' + type : ''}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ─── Players ──────────────────────────────────────────────────────────────────

async function renderPlayers(el) {
  const allObj  = await dbGet(pRef());
  const players = allObj
    ? Object.entries(allObj).map(([uid, p]) => ({ uid, ...p }))
    : [];

  const pending    = players.filter(p => p.status === 'invited');
  const onboarding = players.filter(p => p.status === 'onboarding');
  const active     = players.filter(p => p.status === 'active');
  const other      = players.filter(p => !['invited','onboarding','active'].includes(p.status));

  el.innerHTML = `
    <div class="section-header">
      <div class="section-title">Players</div>
      <div class="section-actions">
        <span class="badge-admin badge-red">${pending.length} pending</span>
        <span class="badge-admin badge-orange">${onboarding.length} onboarding</span>
        <span class="badge-admin badge-green">${active.length} active</span>
      </div>
    </div>

    ${pending.length ? `
      <div class="section-group-label">Awaiting Approval (${pending.length})</div>
      ${pending.map(p => _playerCard(p)).join('')}
    ` : ''}

    ${onboarding.length ? `
      <div class="section-group-label">Completing Onboarding (${onboarding.length})</div>
      ${onboarding.map(p => _playerCard(p)).join('')}
    ` : ''}

    <div class="section-group-label">Active Players (${active.length})</div>
    ${active.length ? active.map(p => _playerCard(p)).join('') : `<div class="admin-empty">No active players yet.</div>`}

    ${other.length ? `
      <div class="section-group-label">Other (${other.length})</div>
      ${other.map(p => _playerCard(p)).join('')}
    ` : ''}
  `;

  // Approve buttons
  el.querySelectorAll('[data-action="approve"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = '…';
      await dbUpdate(pRef(btn.dataset.uid), { status: 'onboarding' });
      toast('Player approved — they can now complete onboarding', 'success');
      renderPlayers(el);
    });
  });

  // Set active directly
  el.querySelectorAll('[data-action="activate"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = '…';
      await dbUpdate(pRef(btn.dataset.uid), { status: 'active' });
      toast('Player set to active', 'success');
      renderPlayers(el);
    });
  });

  // Edit ELO
  el.querySelectorAll('[data-action="edit-elo"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const uid  = btn.dataset.uid;
      const name = btn.dataset.name;
      const cur  = btn.dataset.elo;
      const val  = window.prompt(`New ELO rating for ${name}:`, cur);
      if (val === null) return;
      const n = parseInt(val, 10);
      if (isNaN(n) || n < 0 || n > 3000) { toast('Invalid ELO value', 'error'); return; }
      await dbUpdate(pRef(uid), { eloRating: n });
      toast('ELO updated', 'success');
      renderPlayers(el);
    });
  });
}

function _playerCard(p) {
  const statusClass = { invited: 'badge-red', onboarding: 'badge-orange', active: 'badge-green' }[p.status] || 'badge-muted';
  return `
    <div class="admin-card">
      ${avatarToSvg(p.avatarId || null, 36)}
      <div class="admin-card-body">
        <div class="admin-card-name">${escHtml(p.name || '(no name)')}</div>
        <div class="admin-card-sub">
          ${p.alias ? `@${escHtml(p.alias)} &middot; ` : ''}
          ${p.email ? escHtml(p.email) + ' &middot; ' : ''}
          ELO ${p.eloRating || '—'}
        </div>
      </div>
      <div class="admin-card-actions">
        <span class="badge-admin ${statusClass}">${escHtml(p.status || '?')}</span>
        ${p.status === 'invited' ? `
          <button class="btn-admin btn-teal" data-action="approve" data-uid="${p.uid}">Approve</button>
        ` : ''}
        ${p.status === 'onboarding' ? `
          <button class="btn-admin btn-teal" data-action="activate" data-uid="${p.uid}">Set Active</button>
        ` : ''}
        ${p.status === 'active' ? `
          <button class="btn-admin btn-secondary" data-action="edit-elo"
            data-uid="${p.uid}" data-name="${escHtml(p.alias || p.name || p.uid)}"
            data-elo="${p.eloRating || 1000}">Edit ELO</button>
        ` : ''}
      </div>
    </div>
  `;
}

// ─── Leagues ──────────────────────────────────────────────────────────────────

async function renderLeagues(el) {
  const [config, allPlayers, allSeasonsRaw] = await Promise.all([
    dbGet(dbRef('config')),
    dbGet(pRef()),
    dbGet(dbRef('seasons')),
  ]);
  const defaultSid = config && config.defaultSeason;
  const seasons    = allSeasonsRaw || {};

  // Active season first, then remaining sorted newest → oldest
  const sortedSeasons = Object.entries(seasons).sort(([sA], [sB]) => {
    if (sA === defaultSid) return -1;
    if (sB === defaultSid) return 1;
    return (seasons[sB].createdAt || 0) - (seasons[sA].createdAt || 0);
  });

  el.innerHTML = `
    <div class="section-header">
      <div class="section-title">Leagues</div>
      <div class="section-actions">
        <button class="btn-admin btn-primary" id="btn-new-season">+ New Season</button>
      </div>
    </div>

    <!-- New season form (hidden by default) -->
    <div id="new-season-form" style="display:none;" class="admin-form-panel">
      <div class="admin-form-title">Create Season</div>
      <div class="admin-form-row">
        <div class="admin-input-group" style="flex:1;">
          <label class="admin-input-label">Season Name</label>
          <input id="season-name-input" class="admin-input" placeholder="e.g. 2026 Spring"/>
        </div>
        <button class="btn-admin btn-primary" id="btn-create-season">Create</button>
      </div>
    </div>

    ${sortedSeasons.length === 0
      ? `<div class="admin-empty">No seasons yet. Create one above.</div>`
      : sortedSeasons.map(([sid, season]) => `
          <div style="margin-bottom:24px;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
              <div class="section-group-label" style="margin:0;">
                ${escHtml(season.name || sid)}
              </div>
              ${sid === defaultSid
                ? `<span class="badge-admin badge-green">Active</span>`
                : `<button class="btn-admin btn-ghost" style="font-size:11px;"
                     data-action="set-default-season" data-sid="${sid}">
                     Set as active
                   </button>`}
            </div>
            ${_renderSeason(sid, season, allPlayers || {})}
          </div>
        `).join('')}
  `;

  el.querySelector('#btn-new-season').addEventListener('click', () => {
    const form = el.querySelector('#new-season-form');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
  });

  el.querySelector('#btn-create-season').addEventListener('click', async () => {
    const name = el.querySelector('#season-name-input').value.trim();
    if (!name) { toast('Enter a season name', 'error'); return; }
    const sid = 'season_' + Date.now().toString(36);
    await dbSet(sRef(sid, null), { name, createdAt: Date.now() });
    await dbUpdate(dbRef('config'), { defaultSeason: sid });
    toast('Season created and set as active', 'success');
    renderLeagues(el);
  });

  // Set a past season as the active one
  el.querySelectorAll('[data-action="set-default-season"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { sid } = btn.dataset;
      const seasonName = seasons[sid] && seasons[sid].name ? seasons[sid].name : sid;
      if (!confirm(`Set "${seasonName}" as the active season? Players will see matches from this season.`)) return;
      await dbUpdate(dbRef('config'), { defaultSeason: sid });
      toast(`"${seasonName}" is now the active season`, 'success');
      renderLeagues(el);
    });
  });

  // Wire "Add League" buttons
  el.querySelectorAll('[data-action="add-league"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const sid  = btn.dataset.sid;
      const form = el.querySelector(`#add-league-form-${sid}`);
      if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
    });
  });

  el.querySelectorAll('[data-action="create-league"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const sid    = btn.dataset.sid;
      const nameEl = el.querySelector(`#league-name-input-${sid}`);
      const name   = nameEl ? nameEl.value.trim() : '';
      if (!name) { toast('Enter a league name', 'error'); return; }
      const lid = 'league_' + Date.now().toString(36);
      await dbSet(sRef(sid, lid), {
        name,
        division:     name.split(' ')[0],
        createdAt:    Date.now(),
        scoringConfig: { minMatches: 6, minWins: 4, bracketSize: 4 },
      });
      toast('League created', 'success');
      renderLeagues(el);
    });
  });

  // Wire "Add Member" buttons
  el.querySelectorAll('[data-action="add-member"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { sid, lid } = btn.dataset;
      const select = el.querySelector(`#member-select-${lid}`);
      const uid = select && select.value;
      if (!uid) { toast('Select a player', 'error'); return; }
      await dbSet(sRef(sid, lid, 'members/' + uid), { joinedAt: Date.now() });
      toast('Player added to league', 'success');
      renderLeagues(el);
    });
  });

  // Wire "Remove Member" buttons
  el.querySelectorAll('[data-action="remove-member"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { sid, lid, uid } = btn.dataset;
      if (!confirm('Remove this player from the league?')) return;
      await dbRemove(sRef(sid, lid, 'members/' + uid));
      toast('Player removed', 'success');
      renderLeagues(el);
    });
  });

  // Wire "Move Member" buttons
  el.querySelectorAll('[data-action="move-member"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const { sid, lid, uid, playerName } = btn.dataset;
      const seasonData = seasons[sid];
      const allLeagues = (seasonData && seasonData.leagues) ? seasonData.leagues : {};
      _showMovePlayerModal(uid, playerName, sid, lid, allLeagues, () => renderLeagues(el));
    });
  });
}

function _showMovePlayerModal(uid, playerName, sid, fromLid, allLeagues, onDone) {
  const targets = Object.entries(allLeagues).filter(([lid]) => lid !== fromLid);

  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(28,24,20,0.55);z-index:9000;
    display:flex;align-items:center;justify-content:center;padding:24px;
  `;
  overlay.innerHTML = `
    <div style="background:var(--surface);border-radius:16px;padding:24px;
      width:100%;max-width:380px;box-shadow:0 8px 32px rgba(28,24,20,0.2);">
      <div style="font-family:var(--font-serif);font-size:18px;font-weight:700;
        margin-bottom:8px;">Move Player</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:16px;">
        Moving <strong>${escHtml(playerName)}</strong> to a different league.
      </div>
      ${targets.length === 0 ? `
        <p style="font-size:13px;color:var(--text3);">No other leagues in this season.</p>
        <button id="btn-close-move" class="btn-admin btn-secondary" style="margin-top:12px;width:100%;">Close</button>
      ` : `
        <div class="admin-input-group">
          <label class="admin-input-label">Destination league</label>
          <select id="move-target-league" class="admin-input">
            <option value="">Select league…</option>
            ${targets.map(([lid, l]) =>
              `<option value="${escHtml(lid)}">${escHtml(l.name || lid)}</option>`
            ).join('')}
          </select>
        </div>
        <div style="display:flex;gap:10px;margin-top:16px;">
          <button id="btn-confirm-move" class="btn-admin btn-primary" style="flex:1;">Move</button>
          <button id="btn-close-move" class="btn-admin btn-secondary">Cancel</button>
        </div>
      `}
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#btn-close-move').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  const confirmBtn = overlay.querySelector('#btn-confirm-move');
  if (!confirmBtn) return;

  confirmBtn.addEventListener('click', async () => {
    const toLid = overlay.querySelector('#move-target-league').value;
    if (!toLid) { toast('Select a destination league', 'error'); return; }
    if (!confirm(`Move ${playerName} from current league to selected league?`)) return;

    confirmBtn.disabled = true;
    const updates = {};
    updates[`seasons/${sid}/leagues/${fromLid}/members/${uid}`] = null;
    updates[`seasons/${sid}/leagues/${toLid}/members/${uid}`]   = {
      joinedAt: Date.now(),
      transferredAt: Date.now(),
    };
    await dbMultiUpdate(updates);
    overlay.remove();
    toast(`${playerName} moved successfully`, 'success');
    onDone();
  });
}

function _renderSeason(sid, season, allPlayers) {
  if (!season) return '<div class="admin-empty">Season data not found.</div>';
  const leagues = season.leagues || {};

  return `
    <div class="admin-form-panel" style="margin-bottom:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div style="font-weight:700;">${escHtml(season.name || sid)}</div>
        <button class="btn-admin btn-secondary" data-action="add-league" data-sid="${sid}">
          + Add League
        </button>
      </div>

      <div id="add-league-form-${sid}" style="display:none;margin-bottom:14px;">
        <div class="admin-form-row">
          <div class="admin-input-group" style="flex:1;">
            <label class="admin-input-label">League Name</label>
            <input id="league-name-input-${sid}" class="admin-input" placeholder="e.g. A Division"/>
          </div>
          <button class="btn-admin btn-teal" data-action="create-league" data-sid="${sid}">Create</button>
        </div>
      </div>

      ${Object.entries(leagues).map(([lid, league]) => {
        const members     = league.members || {};
        const memberUids  = Object.keys(members);
        const activePlayers = Object.entries(allPlayers)
          .filter(([uid, p]) => p.status === 'active' && !memberUids.includes(uid))
          .map(([uid, p]) => ({ uid, ...p }));

        return `
          <div style="background:var(--surface2);border-radius:var(--radius);
            padding:12px;margin-bottom:8px;">
            <div style="font-weight:700;font-size:13px;margin-bottom:8px;">
              ${escHtml(league.name || lid)}
              <span class="badge-admin badge-muted" style="margin-left:6px;">
                ${memberUids.length} members
              </span>
            </div>
            ${memberUids.map(uid => {
              const p = allPlayers[uid] || {};
              return `
                <div style="display:flex;align-items:center;gap:8px;padding:6px 0;
                  border-bottom:1px solid var(--border);">
                  ${avatarToSvg(p.avatarId || null, 24)}
                  <span style="flex:1;font-size:13px;">${escHtml(p.alias || p.name || uid)}</span>
                  <button class="btn-admin btn-ghost" style="color:var(--text3);font-size:11px;"
                    data-action="move-member" data-sid="${sid}" data-lid="${lid}" data-uid="${uid}"
                    data-player-name="${escHtml(p.alias || p.name || uid)}">
                    Move
                  </button>
                  <button class="btn-admin btn-ghost" style="color:var(--ace3);font-size:11px;"
                    data-action="remove-member" data-sid="${sid}" data-lid="${lid}" data-uid="${uid}">
                    Remove
                  </button>
                </div>
              `;
            }).join('')}
            ${activePlayers.length ? `
              <div style="display:flex;gap:8px;margin-top:10px;align-items:center;">
                <select id="member-select-${lid}" class="admin-input" style="flex:1;">
                  <option value="">Select player to add…</option>
                  ${activePlayers.map(p => `
                    <option value="${p.uid}">${escHtml(p.alias || p.name || p.uid)}</option>
                  `).join('')}
                </select>
                <button class="btn-admin btn-teal" data-action="add-member"
                  data-sid="${sid}" data-lid="${lid}">Add</button>
              </div>
            ` : ''}
          </div>
        `;
      }).join('')}

      ${Object.keys(leagues).length === 0 ? `
        <div class="admin-empty" style="padding:16px 0;">No leagues yet.</div>
      ` : ''}
    </div>
  `;
}

// ─── Invite Codes ─────────────────────────────────────────────────────────────

async function renderInvites(el) {
  const codesObj = await dbGet(dbRef('invite_codes'));
  const codes    = codesObj
    ? Object.entries(codesObj).map(([code, v]) => ({ code, ...v }))
    : [];

  const unused = codes.filter(c => !c.used);
  const used   = codes.filter(c => c.used);

  el.innerHTML = `
    <div class="section-header">
      <div class="section-title">Invite Codes</div>
      <div class="section-actions">
        <span class="badge-admin badge-green">${unused.length} available</span>
        <span class="badge-admin badge-muted">${used.length} used</span>
      </div>
    </div>

    <div class="admin-form-panel">
      <div class="admin-form-title">Generate New Code</div>
      <div class="admin-form-row">
        <div class="admin-input-group" style="flex:1;">
          <label class="admin-input-label">Code (auto-generated)</label>
          <input id="invite-code-input" class="admin-input" id="new-code"
            placeholder="Click Generate" readonly/>
        </div>
        <button class="btn-admin btn-secondary" id="btn-gen-code">Generate</button>
        <button class="btn-admin btn-primary" id="btn-save-code">Save</button>
      </div>
      <div id="invite-note" style="font-size:12px;color:var(--text3);margin-top:8px;"></div>
    </div>

    ${unused.length ? `
      <div class="section-group-label">Available (${unused.length})</div>
      ${unused.map(c => _inviteCard(c, false)).join('')}
    ` : `<div class="admin-empty">No unused codes. Generate one above.</div>`}

    ${used.length ? `
      <div class="section-group-label">Used (${used.length})</div>
      ${used.map(c => _inviteCard(c, true)).join('')}
    ` : ''}
  `;

  const codeInput = el.querySelector('#invite-code-input');
  el.querySelector('#btn-gen-code').addEventListener('click', () => {
    codeInput.value = generateInviteCode();
  });

  el.querySelector('#btn-save-code').addEventListener('click', async () => {
    const code = codeInput.value.trim().toUpperCase();
    if (!code || !code.includes('-')) { toast('Generate a code first', 'error'); return; }
    await dbSet(dbRef('invite_codes/' + code), { used: false, createdAt: Date.now() });
    toast('Invite code saved', 'success');
    renderInvites(el);
  });

  el.querySelectorAll('[data-action="revoke-code"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Revoke this invite code?')) return;
      await dbRemove(dbRef('invite_codes/' + btn.dataset.code));
      toast('Code revoked', 'success');
      renderInvites(el);
    });
  });
}

function _inviteCard(c, isUsed) {
  return `
    <div class="admin-card">
      <div class="code-pill">${escHtml(c.code)}</div>
      <div class="admin-card-body">
        <div class="admin-card-sub">
          Created ${c.createdAt ? timeAgo(c.createdAt) : '—'}
          ${c.usedBy ? ' &middot; Used by uid: ' + escHtml(c.usedBy) : ''}
        </div>
      </div>
      <div class="admin-card-actions">
        <span class="badge-admin ${isUsed ? 'badge-muted' : 'badge-green'}">
          ${isUsed ? 'Used' : 'Available'}
        </span>
        ${!isUsed ? `
          <button class="btn-admin btn-danger" data-action="revoke-code"
            data-code="${escHtml(c.code)}">Revoke</button>
        ` : ''}
      </div>
    </div>
  `;
}

// ─── Matches ──────────────────────────────────────────────────────────────────

async function renderMatches(el) {
  const config  = await dbGet(dbRef('config'));
  const sid     = config && config.defaultSeason;
  if (!sid) { el.innerHTML = '<div class="admin-empty">No active season.</div>'; return; }

  const leagues = await dbGet(sRef(sid, null, 'leagues'));
  if (!leagues) { el.innerHTML = '<div class="admin-empty">No leagues in this season.</div>'; return; }

  const allPlayers = await dbGet(pRef()) || {};
  let allRows = [];

  for (const [lid, league] of Object.entries(leagues)) {
    const matchesObj = await dbGet(sRef(sid, lid, 'matches'));
    if (!matchesObj) continue;
    const rows = Object.entries(matchesObj).map(([mid, m]) => ({ mid, lid, sid, league, ...m }));
    allRows = allRows.concat(rows);
  }

  allRows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const disputed = allRows.filter(m => m.status === 'result_pending' && m.disputed);
  const pending  = allRows.filter(m => ['scheduled','result_pending','photo_pending'].includes(m.status) && !m.disputed);
  const done     = allRows.filter(m => m.status === 'confirmed').slice(0, 20);

  el.innerHTML = `
    <div class="section-header">
      <div class="section-title">Matches</div>
      <div class="section-actions">
        ${disputed.length ? `<span class="badge-admin badge-red">${disputed.length} disputed</span>` : ''}
        <span class="badge-admin badge-orange">${pending.length} in progress</span>
        <span class="badge-admin badge-muted">${done.length} recent confirmed</span>
      </div>
    </div>

    ${disputed.length ? `
      <div class="section-group-label">Disputed — needs resolution</div>
      ${disputed.map(m => _matchCard(m, allPlayers, true)).join('')}
    ` : ''}

    <div class="section-group-label">In Progress (${pending.length})</div>
    ${pending.length ? pending.map(m => _matchCard(m, allPlayers, false)).join('') : `<div class="admin-empty">No in-progress matches.</div>`}

    ${done.length ? `
      <div class="section-group-label">Recent Confirmed (${done.length})</div>
      ${done.map(m => _matchCard(m, allPlayers, false)).join('')}
    ` : ''}
  `;

  // Dismiss dispute (uphold original result)
  el.querySelectorAll('[data-action="dismiss-dispute"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { sid, lid, mid } = btn.dataset;
      if (!confirm('Dismiss this dispute and uphold the existing result?')) return;
      const base = `seasons/${sid}/leagues/${lid}/matches/${mid}`;
      await dbMultiUpdate({
        [base + '/disputed']:     null,
        [base + '/adminReviewed']: true,
        [base + '/reviewedAt']:   Date.now(),
      });
      toast('Dispute dismissed — result upheld', 'success');
      renderMatches(el);
    });
  });

  // Override result buttons
  el.querySelectorAll('[data-action="override-match"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const { sid, lid, mid } = btn.dataset;
      const matchRow = allRows.find(m => m.mid === mid);
      if (matchRow) _showOverrideModal(matchRow, allPlayers, () => renderMatches(el));
    });
  });

  // Cancel match
  el.querySelectorAll('[data-action="cancel-match"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Cancel this match?')) return;
      const { sid, lid, mid } = btn.dataset;
      await dbUpdate(sRef(sid, lid, 'matches/' + mid), { status: 'cancelled', cancelledAt: Date.now() });
      toast('Match cancelled', 'success');
      renderMatches(el);
    });
  });
}

function _matchCard(m, allPlayers, showOverride) {
  const pA = allPlayers[m.playerA] || {};
  const pB = allPlayers[m.playerB] || {};
  const statusClass = {
    scheduled:      'badge-muted',
    result_pending: 'badge-orange',
    photo_pending:  'badge-orange',
    confirmed:      'badge-green',
    cancelled:      'badge-muted',
  }[m.status] || 'badge-muted';

  const score = m.result && m.result.sets
    ? m.result.sets.map(s => `${s.a}-${s.b}`).join(' ')
    : '';

  return `
    <div class="admin-card">
      <div class="admin-card-body">
        <div class="admin-card-name">
          ${escHtml(pA.alias || pA.name || m.playerA)}
          vs
          ${escHtml(pB.alias || pB.name || m.playerB)}
        </div>
        <div class="admin-card-sub">
          ${escHtml(m.league && m.league.name || '')}
          ${score ? ' &middot; ' + escHtml(score) : ''}
          ${m.createdAt ? ' &middot; ' + timeAgo(m.createdAt) : ''}
          ${m.disputed ? ' &middot; <span style="color:var(--ace3);">Disputed</span>' : ''}
        </div>
      </div>
      <div class="admin-card-actions">
        <span class="badge-admin ${statusClass}">${escHtml(m.status || '?')}</span>
        ${m.disputed ? `
          <button class="btn-admin btn-teal" data-action="dismiss-dispute"
            data-sid="${m.sid}" data-lid="${m.lid}" data-mid="${m.mid}">
            Dismiss
          </button>
        ` : ''}
        ${m.status !== 'confirmed' && m.status !== 'cancelled' ? `
          <button class="btn-admin btn-secondary" data-action="override-match"
            data-sid="${m.sid}" data-lid="${m.lid}" data-mid="${m.mid}">
            Set Result
          </button>
          <button class="btn-admin btn-danger" data-action="cancel-match"
            data-sid="${m.sid}" data-lid="${m.lid}" data-mid="${m.mid}">
            Cancel
          </button>
        ` : ''}
      </div>
    </div>
  `;
}

function _showOverrideModal(match, allPlayers, onDone) {
  const pA = allPlayers[match.playerA] || {};
  const pB = allPlayers[match.playerB] || {};
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(28,24,20,0.55);z-index:9000;
    display:flex;align-items:center;justify-content:center;padding:24px;
  `;
  overlay.innerHTML = `
    <div style="background:var(--surface);border-radius:16px;padding:24px;
      width:100%;max-width:420px;box-shadow:0 8px 32px rgba(28,24,20,0.2);">
      <div style="font-family:var(--font-serif);font-size:18px;font-weight:700;
        margin-bottom:16px;">Set Match Result</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:16px;">
        ${escHtml(pA.alias || pA.name || match.playerA)}
        vs
        ${escHtml(pB.alias || pB.name || match.playerB)}
      </div>

      <div class="admin-input-group">
        <label class="admin-input-label">Winner</label>
        <select id="winner-select" class="admin-input">
          <option value="">Select winner…</option>
          <option value="${match.playerA}">${escHtml(pA.alias || pA.name || match.playerA)}</option>
          <option value="${match.playerB}">${escHtml(pB.alias || pB.name || match.playerB)}</option>
        </select>
      </div>

      <div class="admin-input-group">
        <label class="admin-input-label">Score (e.g. 6-3 6-4)</label>
        <input id="score-input" class="admin-input" placeholder="6-3 7-5"/>
      </div>

      <div style="display:flex;gap:10px;margin-top:16px;">
        <button id="btn-confirm-override" class="btn-admin btn-primary" style="flex:1;">
          Confirm Result
        </button>
        <button id="btn-cancel-override" class="btn-admin btn-secondary">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#btn-cancel-override').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#btn-confirm-override').addEventListener('click', async () => {
    const winner = overlay.querySelector('#winner-select').value;
    const score  = overlay.querySelector('#score-input').value.trim();
    if (!winner) { toast('Select a winner', 'error'); return; }

    // Parse sets
    const sets = score.split(/\s+/).map(s => {
      const [a, b] = s.split('-').map(Number);
      return isNaN(a) || isNaN(b) ? null : { a, b };
    }).filter(Boolean);

    // Calculate ELO
    const pAData = allPlayers[match.playerA] || {};
    const pBData = allPlayers[match.playerB] || {};
    const eloA = pAData.eloRating || 1000;
    const eloB = pBData.eloRating || 1000;
    const aWins = winner === match.playerA;
    const eloResult = calculateElo(eloA, eloB, aWins ? 'a' : 'b');

    const now = Date.now();
    const updates = {};
    const base = `seasons/${match.sid}/leagues/${match.lid}/matches/${match.mid}`;
    updates[base + '/status']        = 'confirmed';
    updates[base + '/confirmedAt']   = now;
    updates[base + '/adminOverride'] = true;
    updates[base + '/disputed']      = null;
    updates[base + '/result']        = { winner, sets };
    if (score) updates[base + '/score'] = score;
    updates[`players/${match.playerA}/eloRating`] = eloResult.newA;
    updates[`players/${match.playerB}/eloRating`] = eloResult.newB;

    await dbMultiUpdate(updates);
    overlay.remove();
    toast('Result confirmed — ELO updated', 'success');
    onDone();
  });
}

// ─── Bracket ──────────────────────────────────────────────────────────────────

async function renderBracketAdmin(el) {
  const config = await dbGet(dbRef('config'));
  const sid    = config && config.defaultSeason;
  if (!sid) { el.innerHTML = '<div class="admin-empty">No active season.</div>'; return; }

  const leagues = await dbGet(sRef(sid, null, 'leagues'));
  if (!leagues) { el.innerHTML = '<div class="admin-empty">No leagues in this season.</div>'; return; }

  const allPlayers = await dbGet(pRef()) || {};

  el.innerHTML = `
    <div class="section-header">
      <div class="section-title">Playoff Bracket</div>
    </div>
    <div id="bracket-leagues"></div>
  `;

  const leaguesEl = el.querySelector('#bracket-leagues');

  for (const [lid, league] of Object.entries(leagues)) {
    const [membersObj, matchesObj, bracketData, scoringConfig] = await Promise.all([
      dbGet(sRef(sid, lid, 'members')),
      dbGet(sRef(sid, lid, 'matches')),
      dbGet(sRef(sid, lid, 'bracket')),
      dbGet(sRef(sid, lid, 'scoringConfig')),
    ]);

    const memberUids = Object.keys(membersObj || {});
    const cfg        = scoringConfig || { minMatches: 6, minWins: 4, bracketSize: 4 };
    const table      = buildLeagueTable(matchesObj || {}, memberUids);
    const qualified  = getQualifiedPlayers(table, cfg);

    const div = document.createElement('div');
    div.innerHTML = `
      <div class="admin-form-panel">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
          <div style="font-weight:700;">${escHtml(league.name || lid)}</div>
          <div style="display:flex;gap:8px;">
            ${!bracketData || bracketData.status === 'pending' ? `
              <button class="btn-admin btn-primary" id="btn-gen-bracket-${lid}">
                Generate Bracket (${qualified.length} qualified)
              </button>
            ` : `
              <span class="badge-admin badge-green">Bracket Active</span>
              <button class="btn-admin btn-danger" id="btn-reset-bracket-${lid}">Reset</button>
            `}
          </div>
        </div>

        ${bracketData && bracketData.status !== 'pending'
          ? _renderBracketAdminView(bracketData, allPlayers, sid, lid)
          : _renderQualifiedTable(table, qualified, allPlayers, cfg)
        }
      </div>
    `;
    leaguesEl.appendChild(div);

    const genBtn = div.querySelector(`#btn-gen-bracket-${lid}`);
    if (genBtn) {
      genBtn.addEventListener('click', async () => {
        if (qualified.length < 2) { toast('Need at least 2 qualified players', 'error'); return; }
        if (!confirm(`Generate bracket for ${qualified.length} players?`)) return;
        const bracket = _generateBracket(qualified, allPlayers);
        await dbSet(sRef(sid, lid, 'bracket'), bracket);
        toast('Bracket generated!', 'success');
        renderBracketAdmin(el);
      });
    }

    const resetBtn = div.querySelector(`#btn-reset-bracket-${lid}`);
    if (resetBtn) {
      resetBtn.addEventListener('click', async () => {
        if (!confirm('Reset the bracket? All bracket results will be lost.')) return;
        await dbRemove(sRef(sid, lid, 'bracket'));
        toast('Bracket reset', 'success');
        renderBracketAdmin(el);
      });
    }

    // Wire bracket result buttons
    div.querySelectorAll('[data-action="set-bracket-result"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const { sid: s, lid: l, rk, mk } = btn.dataset;
        _showBracketResultModal(s, l, rk, mk, bracketData, allPlayers, () => renderBracketAdmin(el));
      });
    });
  }
}

function _generateBracket(qualified, allPlayers) {
  const players = qualified.map(r => r.uid);
  const n       = players.length;

  // Standard seeding: 1v(n), 2v(n-1), ... for first round
  const roundMatches = {};
  for (let i = 0; i < Math.floor(n / 2); i++) {
    roundMatches['m' + i] = {
      playerA: players[i],
      playerB: players[n - 1 - i],
      winner:  null,
      score:   '',
    };
  }
  // Odd player gets a bye to next round (simplified — just include them once)
  if (n % 2 === 1) {
    roundMatches['m' + Math.floor(n / 2)] = {
      playerA: players[Math.floor(n / 2)],
      playerB: null,
      winner:  players[Math.floor(n / 2)],
      score:   'BYE',
    };
  }

  const rounds = { r0: { name: n <= 4 ? 'Semifinals' : 'Quarterfinals', matches: roundMatches } };

  // Add subsequent empty rounds
  let matchCount = Math.ceil(n / 2);
  let roundIdx   = 1;
  while (matchCount > 1) {
    matchCount = Math.ceil(matchCount / 2);
    const emptyMatches = {};
    for (let i = 0; i < matchCount; i++) {
      emptyMatches['m' + i] = { playerA: null, playerB: null, winner: null, score: '' };
    }
    const roundName = matchCount === 1 ? 'Final' : matchCount === 2 ? 'Semifinals' : 'Quarterfinals';
    rounds['r' + roundIdx] = { name: roundName, matches: emptyMatches };
    roundIdx++;
  }

  return { status: 'active', bracketSize: n, createdAt: Date.now(), rounds };
}

function _renderQualifiedTable(table, qualified, allPlayers, cfg) {
  const bracketSize = cfg.bracketSize || 4;
  return `
    <table class="admin-table">
      <thead>
        <tr><th>#</th><th>Player</th><th>W</th><th>P</th><th>GD</th><th>Status</th></tr>
      </thead>
      <tbody>
        ${table.map((row, i) => {
          const p   = allPlayers[row.uid] || {};
          const q   = isQualified(row.standing, cfg);
          const s   = row.standing;
          return `
            <tr>
              <td style="font-family:var(--font-mono);color:var(--text3);">${i + 1}</td>
              <td style="font-weight:${i < bracketSize ? '700' : '400'};">
                ${escHtml(p.alias || p.name || row.uid)}
              </td>
              <td style="font-family:var(--font-mono);">${s.matchesWon}</td>
              <td style="font-family:var(--font-mono);">${s.matchesPlayed}</td>
              <td style="font-family:var(--font-mono);">${s.gameDiff >= 0 ? '+' : ''}${s.gameDiff}</td>
              <td><span class="badge-admin ${q ? 'badge-green' : 'badge-muted'}">
                ${q ? 'Qualified' : 'Not yet'}
              </span></td>
            </tr>
          `;
        }).join('')}
        ${table.length === 0 ? `<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:16px;">No data</td></tr>` : ''}
      </tbody>
    </table>
  `;
}

function _renderBracketAdminView(bracket, allPlayers, sid, lid) {
  const rounds    = bracket.rounds || {};
  const roundKeys = Object.keys(rounds).sort();
  return roundKeys.map(rk => {
    const round     = rounds[rk];
    const matchKeys = Object.keys(round.matches || {}).sort();
    return `
      <div style="margin-bottom:16px;">
        <div style="font-weight:700;font-size:12px;letter-spacing:1px;text-transform:uppercase;
          color:var(--text3);margin-bottom:8px;">${escHtml(round.name || rk)}</div>
        ${matchKeys.map(mk => {
          const m  = round.matches[mk];
          const pA = m.playerA ? (allPlayers[m.playerA] || {}) : null;
          const pB = m.playerB ? (allPlayers[m.playerB] || {}) : null;
          return `
            <div style="display:flex;align-items:center;gap:10px;padding:8px;
              background:var(--surface2);border-radius:var(--radius-sm);margin-bottom:6px;">
              <span style="font-size:13px;flex:1;">
                ${pA ? escHtml(pA.alias || pA.name || m.playerA) : 'TBD'}
                vs
                ${pB ? escHtml(pB.alias || pB.name || m.playerB) : 'TBD'}
                ${m.score ? `<span style="color:var(--text3);font-size:11px;"> · ${escHtml(m.score)}</span>` : ''}
              </span>
              ${m.winner ? `<span class="badge-admin badge-green">
                ${escHtml((allPlayers[m.winner] || {}).alias || m.winner)}
              </span>` : ''}
              ${m.playerA && m.playerB && !m.winner ? `
                <button class="btn-admin btn-secondary" data-action="set-bracket-result"
                  data-sid="${sid}" data-lid="${lid}" data-rk="${rk}" data-mk="${mk}">
                  Set Result
                </button>
              ` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;
  }).join('');
}

function _showBracketResultModal(sid, lid, rk, mk, bracket, allPlayers, onDone) {
  const match = bracket.rounds[rk].matches[mk];
  const pA    = allPlayers[match.playerA] || {};
  const pB    = allPlayers[match.playerB] || {};
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(28,24,20,0.55);z-index:9000;
    display:flex;align-items:center;justify-content:center;padding:24px;
  `;
  overlay.innerHTML = `
    <div style="background:var(--surface);border-radius:16px;padding:24px;
      width:100%;max-width:380px;">
      <div style="font-weight:700;font-size:16px;margin-bottom:14px;">Bracket Match Result</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:14px;">
        ${escHtml(pA.alias || pA.name || match.playerA)} vs ${escHtml(pB.alias || pB.name || match.playerB)}
      </div>
      <div class="admin-input-group">
        <label class="admin-input-label">Winner</label>
        <select id="br-winner" class="admin-input">
          <option value="">Select winner…</option>
          <option value="${match.playerA}">${escHtml(pA.alias || pA.name || match.playerA)}</option>
          <option value="${match.playerB}">${escHtml(pB.alias || pB.name || match.playerB)}</option>
        </select>
      </div>
      <div class="admin-input-group">
        <label class="admin-input-label">Score</label>
        <input id="br-score" class="admin-input" placeholder="6-3 7-5"/>
      </div>
      <div style="display:flex;gap:10px;margin-top:14px;">
        <button id="btn-br-confirm" class="btn-admin btn-primary" style="flex:1;">Confirm</button>
        <button id="btn-br-cancel" class="btn-admin btn-secondary">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#btn-br-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#btn-br-confirm').addEventListener('click', async () => {
    const winner = overlay.querySelector('#br-winner').value;
    const score  = overlay.querySelector('#br-score').value.trim();
    if (!winner) { toast('Select a winner', 'error'); return; }
    const updates = {};
    updates[`seasons/${sid}/leagues/${lid}/bracket/rounds/${rk}/matches/${mk}/winner`] = winner;
    updates[`seasons/${sid}/leagues/${lid}/bracket/rounds/${rk}/matches/${mk}/score`]  = score;
    // Advance winner to next round
    const roundIdx = parseInt(rk.replace('r', ''), 10);
    const matchIdx = parseInt(mk.replace('m', ''), 10);
    const nextRk   = 'r' + (roundIdx + 1);
    const nextMk   = 'm' + Math.floor(matchIdx / 2);
    const side     = matchIdx % 2 === 0 ? 'playerA' : 'playerB';
    if (bracket.rounds[nextRk]) {
      updates[`seasons/${sid}/leagues/${lid}/bracket/rounds/${nextRk}/matches/${nextMk}/${side}`] = winner;
    } else {
      // Final completed — set champion
      updates[`seasons/${sid}/leagues/${lid}/bracket/champion`] = winner;
      updates[`seasons/${sid}/leagues/${lid}/bracket/status`]   = 'complete';
    }
    await dbMultiUpdate(updates);
    overlay.remove();
    toast('Result saved', 'success');
    onDone();
  });
}

// ─── Settings ─────────────────────────────────────────────────────────────────

async function renderSettings(el) {
  const config = await dbGet(dbRef('config')) || {};

  el.innerHTML = `
    <div class="section-header">
      <div class="section-title">Settings</div>
    </div>

    <div class="admin-form-panel">
      <div class="admin-form-title">Change Admin Password</div>
      <div class="admin-input-group">
        <label class="admin-input-label">New Password</label>
        <input id="new-pwd-input" type="password" class="admin-input" placeholder="New password (min 8 chars)"/>
      </div>
      <div class="admin-input-group">
        <label class="admin-input-label">Confirm Password</label>
        <input id="confirm-pwd-input" type="password" class="admin-input" placeholder="Confirm new password"/>
      </div>
      <button class="btn-admin btn-primary" id="btn-change-pwd">Update Password</button>
    </div>

    <div class="admin-form-panel">
      <div class="admin-form-title">Default Season</div>
      <div class="admin-input-group">
        <label class="admin-input-label">Season ID</label>
        <input id="season-id-input" class="admin-input"
          value="${escHtml(config.defaultSeason || '')}"
          placeholder="e.g. season_abc123"/>
      </div>
      <button class="btn-admin btn-secondary" id="btn-set-season">Set Default Season</button>
    </div>

    <div class="admin-form-panel">
      <div class="admin-form-title">App Info</div>
      <div style="font-size:13px;color:var(--text2);">
        <div style="margin-bottom:4px;">ATP Greenwich Admin · v0.06</div>
        <div style="color:var(--text3);">Firebase project: atp-greenwich</div>
      </div>
    </div>
  `;

  el.querySelector('#btn-change-pwd').addEventListener('click', async () => {
    const newPwd = el.querySelector('#new-pwd-input').value;
    const confPwd = el.querySelector('#confirm-pwd-input').value;
    if (newPwd.length < 8) { toast('Password must be at least 8 characters', 'error'); return; }
    if (newPwd !== confPwd) { toast('Passwords do not match', 'error'); return; }
    const hash = simpleHash(newPwd);
    await dbUpdate(dbRef('config'), { adminPasswordHash: hash });
    localStorage.setItem(ADMIN_CREDS_KEY, JSON.stringify({ pwdHash: hash }));
    toast('Password updated', 'success');
    el.querySelector('#new-pwd-input').value = '';
    el.querySelector('#confirm-pwd-input').value = '';
  });

  el.querySelector('#btn-set-season').addEventListener('click', async () => {
    const sid = el.querySelector('#season-id-input').value.trim();
    if (!sid) { toast('Enter a season ID', 'error'); return; }
    await dbUpdate(dbRef('config'), { defaultSeason: sid });
    toast('Default season updated', 'success');
  });
}

// ─── SVG icons ────────────────────────────────────────────────────────────────

function _svg(path) {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}
function userIcon()    { return _svg('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'); }
function tableIcon()   { return _svg('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>'); }
function keyIcon()     { return _svg('<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>'); }
function ballIcon()    { return _svg('<circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'); }
function bracketIcon() { return _svg('<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>'); }
function gearIcon()    { return _svg('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'); }

// ─── Start ────────────────────────────────────────────────────────────────────
boot();
