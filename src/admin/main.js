// src/admin/main.js — ATP Greenwich Admin Dashboard
// Desktop app for managing players, leagues, invite codes, matches, and bracket.
// Auth: single admin password stored in config/adminPasswordHash (or default).

import '@admin/style.css';
import { APP_VERSION } from '@shared/changelog.js';
import { dbGet, dbSet, dbRef, dbUpdate, dbPush, dbRemove, dbMultiUpdate, pRef, sRef } from '@shared/firebase.js';
import { escHtml, simpleHash, generateUid, generateInviteCode, timeAgo } from '@shared/utils.js';
import { buildLeagueTable, isQualified, getQualifiedPlayers, calculateGroupPoints, generateFixtures } from '@shared/scoring.js';
import { calculateElo } from '@shared/elo.js';
import { avatarToSvg } from '@player/avatars.js';
import { showPlayerModal } from '@player/player-modal.js';
import { writeActivity } from '@shared/activity.js';

const ADMIN_CREDS_KEY  = 'atp_admin_creds';
const ADMIN_SEASON_KEY = 'atp_admin_season';
const DEFAULT_PASSWORD = 'atpgreenwich2026';
const OWNER_EMAIL      = 'pablorvarela@gmail.com';

let _adminEmail = '';

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function boot() {
  const app   = document.getElementById('app');

  // Auto-login: if a player marked isAdmin:true is already signed into the player app
  try {
    const pc = JSON.parse(localStorage.getItem('atp_player_creds') || 'null');
    if (pc?.uid && pc?.pwdHash && pc.pwdHash !== 'dev') {
      const pd = await dbGet(pRef(pc.uid));
      if (pd?.isAdmin === true && pd?.passwordHash === pc.pwdHash) {
        showAdminShell(app, pd);
        return;
      }
    }
  } catch {}

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
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--text3);
            margin-top:6px;">v${APP_VERSION}</div>
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

function showAdminShell(app, adminCreds) {
  _adminEmail = adminCreds?.email || '';
  app.innerHTML = `
    <div class="admin-shell" id="admin-shell">
      <div class="sidebar-overlay" id="sidebar-overlay"></div>
      <aside class="admin-sidebar" id="admin-sidebar">
        <div class="admin-brand">
          <div class="admin-logo">ATP</div>
          <div class="admin-sub">Admin Dashboard</div>
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--text3);
            margin-top:4px;letter-spacing:.3px;">v${APP_VERSION}</div>
        </div>
        <nav class="admin-nav">
          ${NAV_ITEMS.map(it => `
            <button class="admin-nav-item" data-section="${it.id}">
              ${it.icon}${escHtml(it.label)}
            </button>
          `).join('')}
        </nav>
        <div class="admin-signout">
          <a href="${import.meta.env.BASE_URL.replace('/admin/', '/')}"
            class="admin-signout-btn"
            style="display:block;text-align:center;text-decoration:none;
              margin-bottom:6px;color:var(--text2);background:var(--surface2);">
            ← Player App
          </a>
          <button class="admin-signout-btn" id="btn-admin-signout">Sign out</button>
        </div>
      </aside>
      <main class="admin-main">
        <div class="admin-mobile-topbar">
          <div style="font-family:var(--font-serif);font-weight:700;color:var(--ace);font-size:18px;">ATP</div>
          <a href="${import.meta.env.BASE_URL.replace('/admin/', '/')}"
            style="display:flex;align-items:center;gap:4px;padding:4px 10px;
              color:var(--text);text-decoration:none;font-size:12px;font-weight:600;
              background:var(--surface2);border:1px solid var(--border);
              border-radius:var(--radius);"
            title="Back to Player App">← Player</a>
        </div>
        <div class="admin-content" id="admin-content">
          <div class="admin-loading"><div class="spinner"></div></div>
        </div>
      </main>
      <nav class="admin-bottom-nav" id="admin-bottom-nav">
        ${NAV_ITEMS.map(it => `
          <button class="admin-bottom-nav-item" data-section="${it.id}">
            ${it.icon}
            <span>${escHtml(it.label)}</span>
          </button>
        `).join('')}
      </nav>
    </div>
  `;

  const sidebar  = app.querySelector('#admin-sidebar');
  const overlay  = app.querySelector('#sidebar-overlay');

  function openSidebar()  { sidebar.classList.add('open');  overlay.classList.add('open'); }
  function closeSidebar() { sidebar.classList.remove('open'); overlay.classList.remove('open'); }

  overlay.addEventListener('click', closeSidebar);

  app.querySelectorAll('.admin-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      closeSidebar();
      _navTo(btn.dataset.section);
    });
  });

  app.querySelectorAll('.admin-bottom-nav-item').forEach(btn => {
    btn.addEventListener('click', () => _navTo(btn.dataset.section));
  });

  app.querySelector('#btn-admin-signout').addEventListener('click', () => {
    localStorage.removeItem(ADMIN_CREDS_KEY);
    window.location.reload();
  });

  _navTo('players');
}

function _navTo(sectionId) {
  document.querySelectorAll('.admin-nav-item, .admin-bottom-nav-item').forEach(b => {
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
  const [allObj, seasonsRaw] = await Promise.all([dbGet(pRef()), dbGet(dbRef('seasons'))]);
  const players = allObj
    ? Object.entries(allObj).map(([uid, p]) => ({ uid, ...p }))
    : [];
  const seasons = seasonsRaw || {};
  const leagueMemberUids = new Set(
    Object.values(seasons).flatMap(s =>
      Object.values(s.leagues || {}).flatMap(l => Object.keys(l.members || {}))
    )
  );

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
    ${active.length ? active.map(p => _playerCard(p, !leagueMemberUids.has(p.uid))).join('') : `<div class="admin-empty">No active players yet.</div>`}

    ${other.length ? `
      <div class="section-group-label">Other (${other.length})</div>
      ${other.map(p => _playerCard(p)).join('')}
    ` : ''}
  `;

  // Approve buttons
  el.querySelectorAll('[data-action="approve"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      btn.disabled = true; btn.textContent = '…';
      await dbUpdate(pRef(btn.dataset.uid), { status: 'onboarding' });
      toast('Player approved — they can now complete onboarding', 'success');
      renderPlayers(el);
    });
  });

  // Decline (remove) pending/onboarding player
  el.querySelectorAll('[data-action="decline"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = btn.dataset.name || btn.dataset.uid;
      if (!confirm(`Decline and remove ${name}? This will permanently delete their account.`)) return;
      btn.disabled = true;
      await dbRemove(pRef(btn.dataset.uid));
      toast('Player declined and removed', 'success');
      renderPlayers(el);
    });
  });

  // View profile / change league (card itself is the trigger)
  el.querySelectorAll('[data-action="view-player"]').forEach(card => {
    card.addEventListener('click', () => {
      const uid = card.dataset.uid;
      const player = players.find(p => p.uid === uid);
      if (player) _showPlayerProfileModal(player, () => renderPlayers(el));
    });
  });

  // Delete player (permanent)
  el.querySelectorAll('[data-action="delete-player"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const { uid, name } = btn.dataset;
      if (!confirm(`Permanently delete player "${name}"? This cannot be undone.`)) return;
      btn.disabled = true;
      await dbMultiUpdate({ [`players/${uid}`]: null });
      toast(`Player "${name}" deleted`, 'success');
      renderPlayers(el);
    });
  });

  // Toggle admin
  el.querySelectorAll('[data-action="toggle-admin"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const { uid } = btn.dataset;
      const nowAdmin = btn.dataset.isAdmin === 'true';
      const newVal   = !nowAdmin;
      btn.disabled   = true;
      await dbMultiUpdate({
        [`players/${uid}/isAdmin`]:   newVal || null,
        [`players/${uid}/adminRole`]: newVal ? 'League Admin' : null,
      });
      toast(`Admin ${newVal ? 'granted' : 'revoked'}`, 'success');
      renderPlayers(el);
    });
  });
}

function _playerCard(p, noLeague = false) {
  const statusClass = { invited: 'badge-red', onboarding: 'badge-orange', active: 'badge-green' }[p.status] || 'badge-muted';
  const displayName = escHtml(p.alias || p.name || p.uid);
  return `
    <div class="admin-card" data-action="view-player" data-uid="${p.uid}"
      style="cursor:pointer;" title="View profile">
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
        ${noLeague ? `<span class="badge-admin badge-orange" title="Not assigned to any league">No league</span>` : ''}
        ${p.status === 'invited' ? `
          <button class="btn-admin btn-teal" data-action="approve" data-uid="${p.uid}">Approve</button>
          <button class="btn-admin btn-danger" data-action="decline"
            data-uid="${p.uid}" data-name="${displayName}">Decline</button>
        ` : ''}
        ${p.status === 'onboarding' ? `
          <button class="btn-admin btn-danger" data-action="decline"
            data-uid="${p.uid}" data-name="${displayName}">Decline</button>
        ` : ''}
        ${p.status === 'active' ? `
          ${p.email === 'pablorvarela@gmail.com' ? `
            <span class="badge-admin badge-teal" style="cursor:default;" title="App owner — cannot be revoked">★ Owner</span>
          ` : `
            <button class="btn-admin ${p.isAdmin ? 'btn-danger' : 'btn-secondary'}"
              data-action="toggle-admin" data-uid="${p.uid}"
              data-is-admin="${p.isAdmin ? 'true' : 'false'}"
              title="${p.isAdmin ? 'Remove admin access' : 'Grant admin access'}">
              ${p.isAdmin ? '★ Admin' : 'Make Admin'}
            </button>
          `}
        ` : ''}
        ${p.email !== OWNER_EMAIL ? `
          <button class="btn-admin btn-danger" data-action="delete-player"
            data-uid="${p.uid}" data-name="${displayName}"
            style="font-size:11px;opacity:.7;" title="Permanently delete player">🗑</button>
        ` : ''}
      </div>
    </div>
  `;
}

async function _showPlayerProfileModal(player, onDone) {
  // Fetch all seasons to find which league this player belongs to
  const allSeasonsRaw = await dbGet(dbRef('seasons'));
  const seasons = allSeasonsRaw || {};

  // Find current league membership (most recent tournament first)
  let currentSid = null, currentLid = null, currentLeagueName = '';
  const seasonOrder = Object.keys(seasons).sort((a, b) =>
    (seasons[b].createdAt || 0) - (seasons[a].createdAt || 0)
  );
  for (const sid of seasonOrder) {
    const leagues = (seasons[sid] && seasons[sid].leagues) || {};
    for (const [lid, league] of Object.entries(leagues)) {
      if (league.members && league.members[player.uid]) {
        currentSid = sid; currentLid = lid;
        currentLeagueName = league.name || lid;
        break;
      }
    }
    if (currentSid) break;
  }

  const leagueList = [];
  for (const sid of seasonOrder) {
    const leagues = (seasons[sid] && seasons[sid].leagues) || {};
    for (const [lid, league] of Object.entries(leagues)) {
      leagueList.push({
        sid, lid,
        seasonName: seasons[sid].name || sid,
        leagueName: league.name || lid,
        isMember: !!(league.members && league.members[player.uid]),
      });
    }
  }

  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(28,24,20,0.55);z-index:9000;
    display:flex;align-items:center;justify-content:center;padding:24px;overflow-y:auto;
  `;
  overlay.innerHTML = `
    <div style="background:var(--surface);border-radius:16px;padding:24px;
      width:100%;max-width:420px;box-shadow:0 8px 32px rgba(28,24,20,0.2);">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
        ${avatarToSvg(player.avatarId || null, 48)}
        <div>
          <div style="font-family:var(--font-serif);font-size:18px;font-weight:700;">
            ${escHtml(player.name || '(no name)')}
          </div>
          ${player.alias ? `<div style="font-size:13px;color:var(--text3);">@${escHtml(player.alias)}</div>` : ''}
        </div>
      </div>

      <table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:16px;">
        <tr><td style="color:var(--text3);padding:4px 0;width:110px;">Email</td>
          <td>${escHtml(player.email || '—')}</td></tr>
        <tr><td style="color:var(--text3);padding:4px 0;">Status</td>
          <td>${escHtml(player.status || '—')}</td></tr>
        <tr><td style="color:var(--text3);padding:4px 0;">ELO Rating</td>
          <td style="font-family:var(--font-mono);font-weight:700;">${player.eloRating || 1000}</td></tr>
        <tr><td style="color:var(--text3);padding:4px 0;">League</td>
          <td>${currentLeagueName ? escHtml(currentLeagueName) : '<span style="color:var(--text3);">None</span>'}</td></tr>
        ${player.status === 'onboarding' || player.status === 'active' ? `
        <tr><td style="color:var(--text3);padding:4px 0;">Approval email</td>
          <td>${player.emailSent
            ? '<span style="color:var(--ace3);">✓ Sent</span>'
            : '<span style="color:var(--text3);">⏳ Pending</span>'}</td></tr>
        ` : ''}
      </table>

      <div class="admin-input-group">
        <label class="admin-input-label">Set ELO Rating</label>
        <div style="display:flex;gap:8px;">
          <input id="player-elo-input" type="number" class="admin-input"
            value="${player.eloRating || 1000}" min="0" max="3000" style="flex:1;">
          <button id="btn-set-elo" class="btn-admin btn-secondary">Set</button>
        </div>
      </div>

      <div class="admin-input-group" style="margin-top:12px;">
        <label class="admin-input-label">Reset Player Password</label>
        <div style="display:flex;gap:8px;">
          <input id="player-new-pwd" type="password" class="admin-input"
            placeholder="New password" style="flex:1;">
          <button id="btn-reset-pwd" class="btn-admin btn-secondary">Set</button>
        </div>
      </div>

      <div class="admin-input-group" style="margin-top:16px;">
        <label class="admin-input-label">League Membership</label>
        ${leagueList.length === 0 ? `
          <div style="font-size:13px;color:var(--text3);">No leagues found.</div>
        ` : leagueList.map(entry => `
          <label style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px;
            border-bottom:1px solid var(--border);cursor:pointer;">
            <input type="checkbox" data-sid="${entry.sid}" data-lid="${entry.lid}"
              class="league-assign-cb" ${entry.isMember ? 'checked' : ''}>
            <span style="flex:1;">${escHtml(entry.leagueName)}</span>
            <span style="color:var(--text3);font-size:11px;">${escHtml(entry.seasonName)}</span>
          </label>
        `).join('')}
      </div>

      <div style="display:flex;gap:8px;margin-top:16px;">
        <button id="btn-save-leagues" class="btn-admin btn-primary" style="flex:1;">Save Leagues</button>
        <button id="btn-close-profile" class="btn-admin btn-secondary">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#btn-close-profile').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#btn-set-elo').addEventListener('click', async () => {
    const input = overlay.querySelector('#player-elo-input');
    const n = parseInt(input.value, 10);
    if (isNaN(n) || n < 0 || n > 3000) { toast('Invalid ELO value (0–3000)', 'error'); return; }
    await dbUpdate(pRef(player.uid), { eloRating: n });
    toast('ELO updated', 'success');
    overlay.remove();
    onDone();
  });

  overlay.querySelector('#btn-reset-pwd').addEventListener('click', async () => {
    const input = overlay.querySelector('#player-new-pwd');
    const pwd   = input.value.trim();
    if (pwd.length < 4) { toast('Password must be at least 4 characters', 'error'); return; }
    await dbUpdate(pRef(player.uid), { passwordHash: simpleHash(pwd) });
    toast(`Password reset for ${player.alias || player.name}`, 'success');
    input.value = '';
  });

  overlay.querySelector('#btn-save-leagues').addEventListener('click', async () => {
    const saveBtn = overlay.querySelector('#btn-save-leagues');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    const updates = {};
    overlay.querySelectorAll('.league-assign-cb').forEach(cb => {
      const { sid, lid } = cb.dataset;
      const path = `seasons/${sid}/leagues/${lid}/members/${player.uid}`;
      const entry = leagueList.find(e => e.sid === sid && e.lid === lid);
      const wasMember = entry ? entry.isMember : false;
      if (cb.checked && !wasMember) {
        updates[path] = { joinedAt: Date.now() };
      } else if (!cb.checked && wasMember) {
        updates[path] = null;
      }
    });
    if (Object.keys(updates).length === 0) {
      toast('No changes', '');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Leagues';
      return;
    }
    await dbMultiUpdate(updates);
    Object.entries(updates).forEach(([path, val]) => {
      if (val !== null) {
        const [, sid, , lid] = path.split('/');
        writeActivity('joined_league', { uid: player.uid, sid, lid });
      }
    });
    toast('League assignments updated', 'success');
    overlay.remove();
    onDone();
  });
}

// ─── Season helper ────────────────────────────────────────────────────────────

function _getAdminSid(sortedSeasons) {
  const stored = localStorage.getItem(ADMIN_SEASON_KEY);
  if (stored && sortedSeasons.find(([sid]) => sid === stored)) return stored;
  const sid = sortedSeasons[0]?.[0] || '';
  if (sid) localStorage.setItem(ADMIN_SEASON_KEY, sid);
  return sid;
}

// ─── Leagues ──────────────────────────────────────────────────────────────────

async function renderLeagues(el) {
  const [allPlayers, allSeasonsRaw, leagueNotifsRaw] = await Promise.all([
    dbGet(pRef()),
    dbGet(dbRef('seasons')),
    dbGet(dbRef('notifications/league_assignment')),
  ]);
  const seasons = allSeasonsRaw || {};
  const leagueNotifications = leagueNotifsRaw || {};

  const sortedSeasons = Object.entries(seasons)
    .sort(([, sA], [, sB]) => (sB.createdAt || 0) - (sA.createdAt || 0));

  const viewSid = _getAdminSid(sortedSeasons);

  el.innerHTML = `
    <div class="section-header">
      <div class="section-title">Leagues</div>
      <div class="section-actions">
        <button class="btn-admin btn-primary" id="btn-new-tournament">+ New Tournament</button>
      </div>
    </div>

    <!-- New tournament form (hidden by default) -->
    <div id="new-tournament-form" style="display:none;" class="admin-form-panel">
      <div class="admin-form-title">Create Tournament</div>
      <div class="admin-form-row">
        <div class="admin-input-group" style="flex:1;">
          <label class="admin-input-label">Tournament Name</label>
          <input id="season-name-input" class="admin-input" placeholder="e.g. 2026 Spring"/>
        </div>
        <button class="btn-admin btn-primary" id="btn-create-tournament">Create</button>
      </div>
    </div>

    ${sortedSeasons.length === 0
      ? `<div class="admin-empty">No tournaments yet. Create one above.</div>`
      : `
        ${sortedSeasons.length > 1 ? `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
            <label class="admin-input-label" style="margin:0;flex-shrink:0;">Tournament</label>
            <select id="league-season-select" class="admin-input" style="flex:1;max-width:240px;">
              ${sortedSeasons.map(([sid, s]) =>
                `<option value="${sid}" ${sid===viewSid?'selected':''}>${escHtml(s.name||sid)}</option>`
              ).join('')}
            </select>
          </div>
        ` : ''}
        <div id="league-season-panel">
          ${sortedSeasons.map(([sid, season]) => `
            <div data-season-panel="${sid}" style="${sid===viewSid?'':'display:none;'}">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
                <div class="section-group-label" style="margin:0;">${escHtml(season.name||sid)}</div>
                ${season.status === 'over' ? `<span class="badge-admin badge-muted" style="background:#e0e0e0;">Over</span>` : ''}
                <div style="display:flex;gap:6px;margin-left:auto;">
                  <button class="btn-admin btn-ghost" style="font-size:11px;"
                    data-action="toggle-tournament-over" data-sid="${sid}"
                    data-is-over="${season.status === 'over'}">
                    ${season.status === 'over' ? 'Reopen' : 'Mark as Over'}
                  </button>
                  <button class="btn-admin btn-danger" style="font-size:11px;"
                    data-action="delete-tournament" data-sid="${sid}"
                    data-name="${escHtml(season.name||sid)}">Delete</button>
                </div>
              </div>
              ${_renderSeason(sid, season, allPlayers||{}, leagueNotifications)}
            </div>
          `).join('')}
        </div>
      `}
  `;

  el.querySelector('#btn-new-tournament').addEventListener('click', () => {
    const form = el.querySelector('#new-tournament-form');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
  });

  // Season filter
  const leagueSeasonSel = el.querySelector('#league-season-select');
  if (leagueSeasonSel) {
    leagueSeasonSel.addEventListener('change', e => {
      localStorage.setItem(ADMIN_SEASON_KEY, e.target.value);
      el.querySelectorAll('[data-season-panel]').forEach(p => {
        p.style.display = p.dataset.seasonPanel === e.target.value ? '' : 'none';
      });
    });
  }

  el.querySelector('#btn-create-tournament').addEventListener('click', async () => {
    const name = el.querySelector('#season-name-input').value.trim();
    if (!name) { toast('Enter a tournament name', 'error'); return; }
    const sid = 'season_' + Date.now().toString(36);
    await dbSet(sRef(sid, null), { name, createdAt: Date.now() });
    toast('Tournament created', 'success');
    renderLeagues(el);
  });

  el.querySelectorAll('[data-action="toggle-tournament-over"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { sid } = btn.dataset;
      const isOver = btn.dataset.isOver === 'true';
      const name = seasons[sid]?.name || sid;
      await dbUpdate(sRef(sid, null), { status: isOver ? null : 'over' });
      toast(isOver ? `"${name}" reopened` : `"${name}" marked as over`, 'success');
      renderLeagues(el);
    });
  });

  el.querySelectorAll('[data-action="delete-tournament"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { sid } = btn.dataset;
      const name = btn.dataset.name || sid;
      if (!confirm(`Delete tournament "${name}"? All leagues and matches within it will be permanently deleted.`)) return;
      await dbRemove(sRef(sid, null));
      toast('Tournament deleted', 'success');
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
        division:      name.split(' ')[0],
        createdAt:     Date.now(),
        scoringConfig: { minMatches: 6, minWins: 4, bracketSize: 4 },
        groupStageConfig: { matchesPerPlayer: 4, qualifyPoints: 6, deadline: null, status: 'pending' },
        pointsConfig:     { played: 1, wonBonus: 2, missed: -1, forfeitLoser: -1, forfeitWinner: 2 },
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
      await dbSet(dbRef(`notifications/league_assignment/${uid}_${sid}_${lid}`), { uid, sid, lid, createdAt: Date.now() });
      writeActivity('joined_league', { uid, sid, lid });
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

  // Toggle group stage config panel
  el.querySelectorAll('[data-action="toggle-gs-config"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = el.querySelector(`#gs-config-${btn.dataset.lid}`);
      if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });
  });

  // Save group stage config
  el.querySelectorAll('[data-action="save-gs-config"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { sid, lid } = btn.dataset;
      const mpp = parseInt(el.querySelector(`#gs-mpp-${lid}`)?.value, 10) || 4;
      const qp  = parseInt(el.querySelector(`#gs-qp-${lid}`)?.value,  10) || 6;
      const dlRaw = el.querySelector(`#gs-dl-${lid}`)?.value;
      const dl  = dlRaw ? new Date(dlRaw).getTime() : null;

      const pointsConfig = {
        played:        parseFloat(el.querySelector(`#gs-pts-played-${lid}`)?.value)  ?? 1,
        wonBonus:      parseFloat(el.querySelector(`#gs-pts-wonb-${lid}`)?.value)    ?? 2,
        missed:        parseFloat(el.querySelector(`#gs-pts-missed-${lid}`)?.value)  ?? -1,
        forfeitLoser:  parseFloat(el.querySelector(`#gs-pts-floss-${lid}`)?.value)   ?? -1,
        forfeitWinner: parseFloat(el.querySelector(`#gs-pts-fwin-${lid}`)?.value)    ?? 2,
      };

      const league = seasons[sid]?.leagues?.[lid] || {};
      const currentStatus = league.groupStageConfig?.status || 'pending';

      await dbMultiUpdate({
        [`seasons/${sid}/leagues/${lid}/groupStageConfig/matchesPerPlayer`]: mpp,
        [`seasons/${sid}/leagues/${lid}/groupStageConfig/qualifyPoints`]:    qp,
        [`seasons/${sid}/leagues/${lid}/groupStageConfig/deadline`]:         dl,
        [`seasons/${sid}/leagues/${lid}/groupStageConfig/status`]:           currentStatus,
        [`seasons/${sid}/leagues/${lid}/pointsConfig`]:                      pointsConfig,
      });
      toast('Group stage configuration saved', 'success');
      renderLeagues(el);
    });
  });

  // Release Fixtures — open a modal with smart defaults
  el.querySelectorAll('[data-action="release-fixtures"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const { sid, lid } = btn.dataset;
      const league = seasons[sid]?.leagues?.[lid] || {};
      _showReleaseFixturesModal(sid, lid, league, allPlayers || {}, () => renderLeagues(el));
    });
  });

  // Close Group Stage
  el.querySelectorAll('[data-action="close-group-stage"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { sid, lid } = btn.dataset;
      const league     = seasons[sid]?.leagues?.[lid] || {};
      const gs         = league.groupStageConfig || {};
      const pointsCfg  = league.pointsConfig || {};
      const memberUids = Object.keys(league.members || {});

      const matchesObj = await dbGet(sRef(sid, lid, 'matches'));
      const allMatches = matchesObj || {};
      const qualifyPts = gs.qualifyPoints || 6;

      const standings = memberUids.map(uid => ({
        uid,
        pts: calculateGroupPoints(allMatches, uid, pointsCfg),
        name: (allPlayers[uid]?.alias || allPlayers[uid]?.name || uid),
      })).sort((a, b) => b.pts - a.pts);

      const qualifiers = standings.filter(s => s.pts >= qualifyPts);
      const msg =
        `Group Stage Summary (qualify: ≥${qualifyPts} pts)\n\n` +
        standings.map(s =>
          `${s.pts >= qualifyPts ? '✓' : '✗'} ${s.name}: ${s.pts} pts`
        ).join('\n') +
        `\n\n${qualifiers.length} player(s) qualify for bracket.` +
        `\n\nClose group stage and mark qualifiers?`;

      if (!confirm(msg)) return;

      const updates = {};
      updates[`seasons/${sid}/leagues/${lid}/groupStageConfig/status`] = 'closed';
      for (const { uid, pts } of standings) {
        updates[`seasons/${sid}/leagues/${lid}/members/${uid}/groupPoints`]   = pts;
        updates[`seasons/${sid}/leagues/${lid}/members/${uid}/qualified`]     = pts >= qualifyPts;
      }
      await dbMultiUpdate(updates);
      toast('Group stage closed. Qualifiers marked.', 'success');
      renderLeagues(el);
    });
  });
}

function _showReleaseFixturesModal(sid, lid, league, allPlayers, onDone) {
  const gs          = league.groupStageConfig || {};
  const pts         = league.pointsConfig     || {};
  const memberUids  = Object.keys(league.members || {});
  const mpp         = gs.matchesPerPlayer || 4;
  const qualifyPts  = gs.qualifyPoints ?? 6;

  // Smart default for qualifyPoints: 2/3 of max achievable pts (played+wonBonus per win)
  const ptsPerWin   = (pts.played ?? 1) + (pts.wonBonus ?? 2);
  const smartQP     = Math.round(mpp * ptsPerWin * (2 / 3));

  const deadlineDefault = gs.deadline
    ? new Date(gs.deadline - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    : '';

  const previewCount = Math.floor(memberUids.length * mpp / 2);

  const overlay = document.createElement('div');
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(28,24,20,0.55);z-index:9000;
    display:flex;align-items:center;justify-content:center;padding:24px;overflow-y:auto;`;
  overlay.innerHTML = `
    <div style="background:var(--surface);border-radius:16px;padding:24px;
      width:100%;max-width:440px;box-shadow:0 8px 32px rgba(28,24,20,0.2);">
      <div style="font-family:var(--font-serif);font-size:18px;font-weight:700;margin-bottom:4px;">
        Release Group Fixtures
      </div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:16px;">
        ${memberUids.length} players · <span id="fixture-preview">${previewCount}</span> fixtures will be created
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
        <div class="admin-input-group">
          <label class="admin-input-label">Matches per player</label>
          <input id="rf-mpp" class="admin-input" type="number" min="1" max="20" value="${mpp}"/>
        </div>
        <div class="admin-input-group">
          <label class="admin-input-label">
            Qualify points (≥)
            <span style="color:var(--text3);font-weight:400;"> — recommended ${smartQP}</span>
          </label>
          <input id="rf-qp" class="admin-input" type="number" min="0" value="${qualifyPts}"/>
        </div>
        <div class="admin-input-group" style="grid-column:1/-1;">
          <label class="admin-input-label">Deadline to complete all matches</label>
          <input id="rf-deadline" class="admin-input" type="datetime-local" value="${deadlineDefault}"/>
        </div>
      </div>

      <div style="background:rgba(184,64,8,.06);border-radius:8px;padding:10px 12px;
        font-size:12px;color:var(--ace);margin-bottom:16px;">
        Point system: won ${(pts.played??1)+(pts.wonBonus??2)} pts &nbsp;·&nbsp;
        lost ${pts.played??1} pts &nbsp;·&nbsp;
        missed ${pts.missed??-1} pts &nbsp;·&nbsp;
        forfeit ${pts.forfeitLoser??-1} / +${pts.forfeitWinner??2} pts
      </div>

      <div style="display:flex;gap:10px;">
        <button id="btn-rf-confirm" class="btn-admin btn-teal" style="flex:1;">
          Release Fixtures
        </button>
        <button id="btn-rf-cancel" class="btn-admin btn-secondary">Cancel</button>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-top:8px;text-align:center;">
        This action cannot be undone.
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Live-update fixture count preview
  const mppInput = overlay.querySelector('#rf-mpp');
  mppInput.addEventListener('input', () => {
    const n = parseInt(mppInput.value, 10) || 0;
    overlay.querySelector('#fixture-preview').textContent = Math.floor(memberUids.length * n / 2);
  });

  overlay.querySelector('#btn-rf-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#btn-rf-confirm').addEventListener('click', async () => {
    if (memberUids.length < 2) { toast('Need at least 2 members', 'error'); return; }

    const newMpp = parseInt(mppInput.value, 10) || mpp;
    const newQP  = parseInt(overlay.querySelector('#rf-qp').value, 10) ?? qualifyPts;
    const dlRaw  = overlay.querySelector('#rf-deadline').value;
    const dl     = dlRaw ? new Date(dlRaw).getTime() : null;

    const btn = overlay.querySelector('#btn-rf-confirm');
    btn.disabled = true; btn.textContent = '…';

    const pairs = generateFixtures(memberUids, newMpp);
    if (!pairs.length) {
      toast('Could not generate fixtures — check player count vs matches per player', 'error');
      btn.disabled = false; btn.textContent = 'Release Fixtures';
      return;
    }

    const now = Date.now();
    const updates = {};
    for (const [playerA, playerB] of pairs) {
      const mid = 'gm_' + now.toString(36) + '_' + Math.random().toString(36).slice(2, 7);
      const base = `seasons/${sid}/leagues/${lid}/matches/${mid}`;
      updates[base + '/playerA']    = playerA;
      updates[base + '/playerB']    = playerB;
      updates[base + '/proposedBy'] = 'admin';
      updates[base + '/proposedAt'] = now;
      updates[base + '/status']     = 'scheduled';
      updates[base + '/groupMatch'] = true;
      updates[base + '/deadline']   = dl;
      updates[base + '/result']     = null;
    }
    updates[`seasons/${sid}/leagues/${lid}/groupStageConfig/status`]          = 'active';
    updates[`seasons/${sid}/leagues/${lid}/groupStageConfig/matchesPerPlayer`] = newMpp;
    updates[`seasons/${sid}/leagues/${lid}/groupStageConfig/qualifyPoints`]    = newQP;
    if (dl) updates[`seasons/${sid}/leagues/${lid}/groupStageConfig/deadline`] = dl;
    updates[`notifications/group_fixtures/${sid}_${lid}`] = { sid, lid, deadline: dl || null, createdAt: Date.now() };

    await dbMultiUpdate(updates);
    writeActivity('fixtures_released', { sid, lid, fixtureCount: pairs.length });
    overlay.remove();
    toast(`${pairs.length} fixtures released`, 'success');
    onDone();
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

function _renderSeason(sid, season, allPlayers, leagueNotifications = {}) {
  if (!season) return '<div class="admin-empty">Tournament data not found.</div>';
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
        const membersInOtherLeagues = new Set(
          Object.entries(leagues)
            .filter(([l]) => l !== lid)
            .flatMap(([, l]) => Object.keys(l.members || {}))
        );
        const activePlayers = Object.entries(allPlayers)
          .filter(([uid, p]) => p.status === 'active' && !memberUids.includes(uid))
          .map(([uid, p]) => ({ uid, ...p }));
        const freeAgents = activePlayers
          .filter(p => !membersInOtherLeagues.has(p.uid))
          .sort((a, b) => (a.eloRating || 1000) - (b.eloRating || 1000));
        const inOtherLeague = activePlayers
          .filter(p => membersInOtherLeagues.has(p.uid))
          .sort((a, b) => (a.eloRating || 1000) - (b.eloRating || 1000));

        const gs     = league.groupStageConfig || {};
        const pts    = league.pointsConfig    || {};
        const gsStatus = gs.status || 'pending';
        const statusBadge = {
          pending: `<span class="badge-admin badge-muted">Pending</span>`,
          active:  `<span class="badge-admin badge-green">Active</span>`,
          closed:  `<span class="badge-admin badge-muted" style="background:#e0e0e0;">Closed</span>`,
        }[gsStatus] || '';
        const deadlineStr = gs.deadline
          ? new Date(gs.deadline).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
          : 'not set';

        return `
          <div style="background:var(--surface2);border-radius:var(--radius);
            padding:12px;margin-bottom:8px;">

            <!-- League header -->
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
              <div style="font-weight:700;font-size:13px;flex:1;">
                ${escHtml(league.name || lid)}
              </div>
              <span class="badge-admin badge-muted">${memberUids.length} members</span>
            </div>

            <!-- Members list -->
            ${memberUids.map(uid => {
              const p = allPlayers[uid] || {};
              const notifKey = `${uid}_${sid}_${lid}`;
              const leagueEmailSent = leagueNotifications[notifKey]?.emailSent === true;
              return `
                <div style="display:flex;align-items:center;gap:8px;padding:6px 0;
                  border-bottom:1px solid var(--border);">
                  ${avatarToSvg(p.avatarId || null, 24)}
                  <span style="flex:1;font-size:13px;">${escHtml(p.alias || p.name || uid)}</span>
                  <span title="${leagueEmailSent ? 'League email sent' : 'League email not yet sent'}"
                    style="font-size:10px;color:${leagueEmailSent ? 'var(--ace3)' : 'var(--text3)'};">
                    ${leagueEmailSent ? '✉ sent' : '✉ pending'}
                  </span>
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

            <!-- Add member -->
            ${(freeAgents.length || inOtherLeague.length) ? `
              <div style="display:flex;gap:8px;margin-top:10px;align-items:center;">
                <select id="member-select-${lid}" class="admin-input" style="flex:1;">
                  <option value="">Select player to add…</option>
                  ${freeAgents.length ? `
                    <optgroup label="Not in any league">
                      ${freeAgents.map(p => `
                        <option value="${p.uid}">${escHtml(p.alias || p.name || p.uid)} — ELO ${p.eloRating || 1000}</option>
                      `).join('')}
                    </optgroup>
                  ` : ''}
                  ${inOtherLeague.length ? `
                    <optgroup label="Already in a league">
                      ${inOtherLeague.map(p => `
                        <option value="${p.uid}">${escHtml(p.alias || p.name || p.uid)} — ELO ${p.eloRating || 1000}</option>
                      `).join('')}
                    </optgroup>
                  ` : ''}
                </select>
                <button class="btn-admin btn-teal" data-action="add-member"
                  data-sid="${sid}" data-lid="${lid}">Add</button>
              </div>
            ` : ''}

            <!-- Group stage section -->
            <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border);">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                <div style="font-size:12px;font-weight:700;color:var(--text2);">Group Stage</div>
                ${statusBadge}
                <button class="btn-admin btn-ghost" style="font-size:11px;margin-left:auto;"
                  data-action="toggle-gs-config" data-lid="${lid}">Configure ▾</button>
              </div>

              <!-- Config form (hidden by default) -->
              <div id="gs-config-${lid}" style="display:none;background:var(--surface);
                border-radius:6px;padding:10px;margin-bottom:10px;">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
                  <div class="admin-input-group">
                    <label class="admin-input-label">Matches per player</label>
                    <input id="gs-mpp-${lid}" class="admin-input" type="number" min="1" max="20"
                      value="${gs.matchesPerPlayer || 4}"/>
                  </div>
                  <div class="admin-input-group">
                    <label class="admin-input-label">Qualify points (≥)</label>
                    <input id="gs-qp-${lid}" class="admin-input" type="number" min="0"
                      value="${gs.qualifyPoints || 6}"/>
                  </div>
                  <div class="admin-input-group" style="grid-column:1/-1;">
                    <label class="admin-input-label">Deadline (${deadlineStr})</label>
                    <input id="gs-dl-${lid}" class="admin-input" type="datetime-local"
                      value="${gs.deadline ? new Date(gs.deadline - new Date().getTimezoneOffset()*60000).toISOString().slice(0,16) : ''}"/>
                  </div>
                </div>
                <div style="font-size:11px;font-weight:700;color:var(--text3);
                  margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px;">
                  Point values (defaults: played 1 · won bonus 2 · missed −1 · forfeit −1/+2)
                </div>
                <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:10px;">
                  ${[
                    ['gs-pts-played-'+lid,   'Played',          pts.played        ?? 1 ],
                    ['gs-pts-wonb-'+lid,     'Won bonus',       pts.wonBonus      ?? 2 ],
                    ['gs-pts-missed-'+lid,   'Missed',          pts.missed        ?? -1],
                    ['gs-pts-floss-'+lid,    'Forfeit (loser)', pts.forfeitLoser  ?? -1],
                    ['gs-pts-fwin-'+lid,     'Forfeit (win)',   pts.forfeitWinner ?? 2 ],
                  ].map(([id, label, val]) => `
                    <div class="admin-input-group">
                      <label class="admin-input-label" style="font-size:9px;">${label}</label>
                      <input id="${id}" class="admin-input" type="number" value="${val}" style="padding:4px 6px;"/>
                    </div>
                  `).join('')}
                </div>
                <button class="btn-admin btn-primary" style="width:100%;"
                  data-action="save-gs-config" data-sid="${sid}" data-lid="${lid}">
                  Save Configuration
                </button>
              </div>

              <!-- Action buttons -->
              <div style="display:flex;gap:8px;">
                ${gsStatus === 'pending' ? `
                  <button class="btn-admin btn-teal" style="flex:1;"
                    data-action="release-fixtures" data-sid="${sid}" data-lid="${lid}"
                    ${memberUids.length < 2 ? 'disabled title="Need at least 2 members"' : ''}>
                    Release Fixtures
                  </button>
                ` : gsStatus === 'active' ? `
                  <button class="btn-admin btn-primary" style="flex:1;"
                    data-action="close-group-stage" data-sid="${sid}" data-lid="${lid}">
                    Close Group Stage
                  </button>
                ` : `
                  <div style="font-size:12px;color:var(--text3);">Group stage closed.</div>
                `}
              </div>
            </div>
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
      if (!confirm('Delete this invite code?')) return;
      await dbRemove(dbRef('invite_codes/' + btn.dataset.code));
      toast('Code deleted', 'success');
      renderInvites(el);
    });
  });

  el.querySelectorAll('[data-action="toggle-code"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { code, used } = btn.dataset;
      const markUsed = used !== 'true';
      await dbUpdate(dbRef('invite_codes/' + code), { used: markUsed });
      toast(`Code marked as ${markUsed ? 'used' : 'available'}`, 'success');
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
        <button class="btn-admin btn-ghost" style="font-size:11px;"
          data-action="toggle-code" data-code="${escHtml(c.code)}" data-used="${isUsed}">
          Mark ${isUsed ? 'Available' : 'Used'}
        </button>
        <button class="btn-admin btn-danger" data-action="revoke-code"
          data-code="${escHtml(c.code)}">Delete</button>
      </div>
    </div>
  `;
}

// ─── Matches ──────────────────────────────────────────────────────────────────

async function renderMatches(el) {
  const [allSeasonsRaw, allPlayers] = await Promise.all([
    dbGet(dbRef('seasons')),
    dbGet(pRef()),
  ]);
  const players = allPlayers || {};
  const seasons = allSeasonsRaw || {};

  const sortedSeasons = Object.entries(seasons)
    .sort(([, sA], [, sB]) => (sB.createdAt || 0) - (sA.createdAt || 0));

  if (!sortedSeasons.length) {
    el.innerHTML = '<div class="admin-empty">No tournaments found.</div>';
    return;
  }

  // Filter state
  let activeSid    = _getAdminSid(sortedSeasons);
  let activeLid    = 'all';
  let activeStatus = 'all';
  let searchPlayer = '';

  let allRows  = [];
  let leagueMap = {};

  async function loadMatches() {
    const leagues = await dbGet(sRef(activeSid, null, 'leagues'));
    leagueMap = leagues || {};
    allRows = [];
    for (const [lid, league] of Object.entries(leagueMap)) {
      const matchesObj = await dbGet(sRef(activeSid, lid, 'matches'));
      if (!matchesObj) continue;
      for (const [mid, m] of Object.entries(matchesObj)) {
        allRows.push({ mid, lid, sid: activeSid, leagueName: league.name || lid, ...m });
      }
    }
    allRows.sort((a, b) => (b.proposedAt || b.createdAt || 0) - (a.proposedAt || a.createdAt || 0));
  }

  function filteredRows() {
    return allRows.filter(m => {
      if (activeLid !== 'all' && m.lid !== activeLid) return false;
      if (activeStatus === 'open' && !['scheduled','result_pending','photo_pending'].includes(m.status)) return false;
      if (activeStatus === 'complete' && m.status !== 'confirmed') return false;
      if (activeStatus === 'disputed' && !m.disputed) return false;
      if (activeStatus === 'cancelled' && m.status !== 'cancelled') return false;
      if (searchPlayer) {
        const pA = players[m.playerA] || {};
        const pB = players[m.playerB] || {};
        const names = [pA.name, pA.alias, pB.name, pB.alias].filter(Boolean).join(' ').toLowerCase();
        if (!names.includes(searchPlayer.toLowerCase())) return false;
      }
      return true;
    });
  }

  function renderFilters() {
    const leagueOpts = Object.entries(leagueMap)
      .map(([lid, l]) => `<option value="${lid}" ${activeLid===lid?'selected':''}>${escHtml(l.name||lid)}</option>`)
      .join('');
    return `
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
        <select id="filter-season" class="admin-input" style="flex:1;min-width:120px;">
          ${sortedSeasons.map(([sid, s]) =>
            `<option value="${sid}" ${sid===activeSid?'selected':''}>${escHtml(s.name||sid)}</option>`
          ).join('')}
        </select>
        <select id="filter-league" class="admin-input" style="flex:1;min-width:100px;">
          <option value="all" ${activeLid==='all'?'selected':''}>All leagues</option>
          ${leagueOpts}
        </select>
        <select id="filter-status" class="admin-input" style="flex:1;min-width:100px;">
          <option value="all"      ${activeStatus==='all'?'selected':''}>All statuses</option>
          <option value="open"     ${activeStatus==='open'?'selected':''}>Open</option>
          <option value="complete" ${activeStatus==='complete'?'selected':''}>Confirmed</option>
          <option value="disputed" ${activeStatus==='disputed'?'selected':''}>Disputed</option>
          <option value="cancelled"${activeStatus==='cancelled'?'selected':''}>Cancelled</option>
        </select>
        <input id="filter-player" class="admin-input" placeholder="Search player…"
          value="${escHtml(searchPlayer)}" style="flex:2;min-width:120px;"/>
      </div>
    `;
  }

  function renderList() {
    const rows     = filteredRows();
    const disputed = rows.filter(m => m.disputed);
    const open     = rows.filter(m => !m.disputed && ['scheduled','result_pending','photo_pending'].includes(m.status));
    const done     = rows.filter(m => m.status === 'confirmed');
    const other    = rows.filter(m => !['scheduled','result_pending','photo_pending','confirmed'].includes(m.status) && !m.disputed);

    const statsEl = el.querySelector('#match-stats');
    if (statsEl) statsEl.innerHTML = `
      ${disputed.length ? `<span class="badge-admin badge-red">${disputed.length} disputed</span>` : ''}
      <span class="badge-admin badge-orange">${open.length} open</span>
      ${done.length ? `<span class="badge-admin badge-green">${done.length} confirmed</span>` : ''}
    `;

    const listEl = el.querySelector('#match-list');
    if (!listEl) return;

    if (!rows.length) {
      listEl.innerHTML = '<div class="admin-empty">No matches match your filters.</div>';
      return;
    }

    listEl.innerHTML = `
      ${disputed.length ? `<div class="section-group-label">Disputed (${disputed.length})</div>
        ${disputed.map(m => _matchCard(m, players)).join('')}` : ''}
      ${open.length ? `<div class="section-group-label">Open (${open.length})</div>
        ${open.map(m => _matchCard(m, players)).join('')}` : ''}
      ${done.length ? `<div class="section-group-label">Confirmed (${done.length})</div>
        ${done.map(m => _matchCard(m, players)).join('')}` : ''}
      ${other.length ? `<div class="section-group-label">Other (${other.length})</div>
        ${other.map(m => _matchCard(m, players)).join('')}` : ''}
    `;

    // Click card → edit modal
    listEl.querySelectorAll('.admin-card[data-mid]').forEach(card => {
      card.style.cursor = 'pointer';
      card.addEventListener('click', e => {
        if (e.target.closest('button')) return;
        const row = rows.find(m => m.mid === card.dataset.mid);
        if (row) _showMatchEditModal(row, players, () => loadMatches().then(renderList));
      });
    });

    // Dismiss dispute
    listEl.querySelectorAll('[data-action="dismiss-dispute"]').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm('Dismiss this dispute and uphold the existing result?')) return;
        const { sid, lid, mid } = btn.dataset;
        const base = `seasons/${sid}/leagues/${lid}/matches/${mid}`;
        await dbMultiUpdate({ [base+'/disputed']: null, [base+'/adminReviewed']: true, [base+'/reviewedAt']: Date.now() });
        toast('Dispute dismissed — result upheld', 'success');
        loadMatches().then(renderList);
      });
    });

    // Cancel match
    listEl.querySelectorAll('[data-action="cancel-match"]').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm('Cancel this match?')) return;
        const { sid, lid, mid } = btn.dataset;
        await dbUpdate(sRef(sid, lid, 'matches/' + mid), { status: 'cancelled', cancelledAt: Date.now() });
        toast('Match cancelled', 'success');
        loadMatches().then(renderList);
      });
    });
  }

  // Initial shell
  el.innerHTML = `
    <div class="section-header">
      <div class="section-title">Matches</div>
      <div class="section-actions" id="match-stats"></div>
    </div>
    ${renderFilters()}
    <div id="match-list"><div class="admin-loading"><div class="spinner"></div></div></div>
  `;

  // Wire filter controls
  el.querySelector('#filter-season').addEventListener('change', async e => {
    activeSid = e.target.value;
    localStorage.setItem(ADMIN_SEASON_KEY, activeSid);
    activeLid = 'all';
    el.querySelector('#match-list').innerHTML = '<div class="admin-loading"><div class="spinner"></div></div>';
    await loadMatches();
    el.querySelector('#filter-league').innerHTML =
      `<option value="all">All leagues</option>` +
      Object.entries(leagueMap).map(([lid, l]) =>
        `<option value="${lid}">${escHtml(l.name||lid)}</option>`
      ).join('');
    renderList();
  });
  el.querySelector('#filter-league').addEventListener('change', e => { activeLid = e.target.value; renderList(); });
  el.querySelector('#filter-status').addEventListener('change', e => { activeStatus = e.target.value; renderList(); });
  el.querySelector('#filter-player').addEventListener('input',  e => { searchPlayer = e.target.value; renderList(); });

  await loadMatches();
  renderList();
}

function _matchCard(m, allPlayers) {
  const pA = allPlayers[m.playerA] || {};
  const pB = allPlayers[m.playerB] || {};
  const statusClass = {
    scheduled: 'badge-muted', result_pending: 'badge-orange',
    photo_pending: 'badge-orange', confirmed: 'badge-green', cancelled: 'badge-muted',
  }[m.status] || 'badge-muted';
  const score = m.result?.sets ? m.result.sets.map(s => `${s.a}-${s.b}`).join(' ') : '';
  return `
    <div class="admin-card" data-mid="${m.mid}">
      <div class="admin-card-body">
        <div class="admin-card-name">
          ${escHtml(pA.alias||pA.name||m.playerA)} vs ${escHtml(pB.alias||pB.name||m.playerB)}
        </div>
        <div class="admin-card-sub">
          ${escHtml(m.leagueName||'')}
          ${score ? ' &middot; ' + escHtml(score) : ''}
          ${m.proposedAt||m.createdAt ? ' &middot; ' + timeAgo(m.proposedAt||m.createdAt) : ''}
          ${m.disputed ? ' &middot; <span style="color:var(--ace3);">Disputed</span>' : ''}
          ${m.groupMatch ? ' &middot; <span style="color:#0a7a5e;">Group</span>' : ''}
        </div>
      </div>
      <div class="admin-card-actions">
        <span class="badge-admin ${statusClass}">${escHtml(m.status||'?')}</span>
        ${m.disputed ? `
          <button class="btn-admin btn-teal" data-action="dismiss-dispute"
            data-sid="${m.sid}" data-lid="${m.lid}" data-mid="${m.mid}">Dismiss</button>
        ` : ''}
        ${m.status !== 'cancelled' ? `
          <button class="btn-admin btn-secondary"
            onclick="event.stopPropagation();"
            data-action="open-edit" data-mid="${m.mid}">Edit</button>
        ` : ''}
        ${!['confirmed','cancelled'].includes(m.status) ? `
          <button class="btn-admin btn-danger" data-action="cancel-match"
            data-sid="${m.sid}" data-lid="${m.lid}" data-mid="${m.mid}">Cancel</button>
        ` : ''}
      </div>
    </div>
  `;
}

function _isAdminValidTennisSet(a, b) {
  if (isNaN(a) || isNaN(b) || a < 0 || b < 0) return false;
  const w = Math.max(a, b), l = Math.min(a, b);
  if (w === 6 && l <= 4) return true;
  if (w === 7 && l === 5) return true;
  if (w === 7 && l === 6) return true;
  return false;
}

function _showMatchEditModal(match, allPlayers, onDone) {
  const pA = allPlayers[match.playerA] || {};
  const pB = allPlayers[match.playerB] || {};

  // Build initial sets from existing result, or one blank set
  const existingSets = match.result?.sets?.length ? match.result.sets : [{ a: '', b: '' }];

  function setsHtml(sets) {
    return sets.map((s, i) => {
      const hasTb = (s.a === 7 && s.b === 6) || (s.a === 6 && s.b === 7);
      return `
        <div data-set-row="${i}" style="margin-bottom:4px;">
          <div class="admin-form-row" style="display:flex;flex-direction:row;flex-wrap:nowrap;gap:6px;align-items:center;">
            <span style="font-size:11px;color:var(--text3);width:40px;flex-shrink:0;">Set ${i+1}</span>
            <input class="admin-input set-a" type="number" min="0" max="7" inputmode="numeric" value="${s.a ?? ''}"
              placeholder="A" style="width:56px;text-align:center;padding:6px 4px;flex-shrink:0;"/>
            <span style="color:var(--text3);">—</span>
            <input class="admin-input set-b" type="number" min="0" max="7" inputmode="numeric" value="${s.b ?? ''}"
              placeholder="B" style="width:56px;text-align:center;padding:6px 4px;flex-shrink:0;"/>
            <button type="button" class="btn-admin btn-ghost" data-remove-set="${i}"
              style="color:var(--ace3);padding:4px 8px;font-size:18px;line-height:1;">×</button>
          </div>
          <div data-tb-row="${i}" style="display:${hasTb ? 'flex' : 'none'};gap:6px;align-items:center;padding-left:46px;margin-top:3px;">
            <span style="font-size:11px;color:var(--text3);width:24px;flex-shrink:0;">TB</span>
            <input class="admin-input tb-a" type="number" min="0" max="99" inputmode="numeric" value="${s.tb?.a ?? ''}"
              placeholder="A" style="width:56px;text-align:center;padding:6px 4px;flex-shrink:0;"/>
            <span style="color:var(--text3);">—</span>
            <input class="admin-input tb-b" type="number" min="0" max="99" inputmode="numeric" value="${s.tb?.b ?? ''}"
              placeholder="B" style="width:56px;text-align:center;padding:6px 4px;flex-shrink:0;"/>
          </div>
        </div>
      `;
    }).join('');
  }

  const isConfirmed = match.status === 'confirmed';

  const overlay = document.createElement('div');
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(28,24,20,0.55);z-index:9000;
    display:flex;align-items:center;justify-content:center;padding:24px;overflow-y:auto;`;
  overlay.innerHTML = `
    <div style="background:var(--surface);border-radius:16px;padding:24px;
      width:100%;max-width:440px;box-shadow:0 8px 32px rgba(28,24,20,0.2);">
      <div style="font-family:var(--font-serif);font-size:18px;font-weight:700;margin-bottom:4px;">
        Edit Match
      </div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:${isConfirmed?'10':'16'}px;">
        ${escHtml(pA.alias||pA.name||match.playerA)} vs ${escHtml(pB.alias||pB.name||match.playerB)}
        &nbsp;·&nbsp;<span class="badge-admin ${isConfirmed?'badge-green':'badge-orange'}">${escHtml(match.status)}</span>
      </div>
      ${isConfirmed ? `
        <div style="background:rgba(184,64,8,.08);border-radius:8px;padding:8px 10px;
          font-size:12px;color:var(--ace);margin-bottom:14px;">
          This match is confirmed. Saving will override the result and recalculate ELO.
        </div>
      ` : ''}

      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
        color:var(--text3);margin-bottom:8px;">
        Score &nbsp;
        <span style="font-size:11px;color:var(--text3);font-weight:400;">(${escHtml(pA.alias||pA.name||'A')} — ${escHtml(pB.alias||pB.name||'B')})</span>
      </div>
      <div id="set-rows">${setsHtml(existingSets)}</div>
      <button type="button" id="btn-add-set" class="btn-admin btn-ghost"
        style="margin-top:4px;margin-bottom:14px;font-size:12px;">+ Add Set</button>

      <div class="admin-input-group">
        <label class="admin-input-label">Winner</label>
        <select id="winner-select" class="admin-input">
          <option value="">Auto (from sets)</option>
          <option value="${match.playerA}" ${match.result?.winner===match.playerA?'selected':''}>
            ${escHtml(pA.alias||pA.name||match.playerA)}</option>
          <option value="${match.playerB}" ${match.result?.winner===match.playerB?'selected':''}>
            ${escHtml(pB.alias||pB.name||match.playerB)}</option>
        </select>
      </div>

      <div style="display:flex;gap:10px;margin-top:16px;">
        <button id="btn-save-match" class="btn-admin btn-primary" style="flex:1;">Save Result</button>
        <button id="btn-close-match" class="btn-admin btn-secondary">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const setRowsEl = overlay.querySelector('#set-rows');

  function refreshRemoveButtons() {
    overlay.querySelectorAll('[data-remove-set]').forEach(btn => {
      btn.onclick = () => {
        const rows = [...setRowsEl.querySelectorAll('[data-set-row]')];
        if (rows.length <= 1) return;
        rows[parseInt(btn.dataset.removeSet)].remove();
        // re-index labels
        setRowsEl.querySelectorAll('[data-set-row]').forEach((r, i) => {
          r.dataset.setRow = i;
          r.querySelector('span').textContent = `Set ${i+1}`;
          const rmBtn = r.querySelector('[data-remove-set]');
          if (rmBtn) rmBtn.dataset.removeSet = i;
          const tbRow = r.querySelector('[data-tb-row]');
          if (tbRow) tbRow.dataset.tbRow = i;
        });
        refreshRemoveButtons();
      };
    });
  }
  refreshRemoveButtons();

  setRowsEl.addEventListener('input', e => {
    const inp = e.target;
    if (!inp.classList.contains('set-a') && !inp.classList.contains('set-b')) return;
    const row = inp.closest('[data-set-row]');
    if (!row) return;
    const a = parseInt(row.querySelector('.set-a').value, 10);
    const b = parseInt(row.querySelector('.set-b').value, 10);
    const tbRow = row.querySelector('[data-tb-row]');
    if (!tbRow) return;
    const show = (a === 7 && b === 6) || (a === 6 && b === 7);
    tbRow.style.display = show ? 'flex' : 'none';
    if (!show) { tbRow.querySelector('.tb-a').value = ''; tbRow.querySelector('.tb-b').value = ''; }
  });

  overlay.querySelector('#btn-add-set').addEventListener('click', () => {
    const idx = setRowsEl.querySelectorAll('[data-set-row]').length;
    const div = document.createElement('div');
    div.innerHTML = setsHtml([{ a: '', b: '' }]).replace('Set 1', `Set ${idx+1}`)
      .replace('data-set-row="0"', `data-set-row="${idx}"`)
      .replace('data-remove-set="0"', `data-remove-set="${idx}"`);
    setRowsEl.appendChild(div.firstElementChild);
    refreshRemoveButtons();
  });

  overlay.querySelector('#btn-close-match').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#btn-save-match').addEventListener('click', async () => {
    const saveBtn = overlay.querySelector('#btn-save-match');
    saveBtn.disabled = true; saveBtn.textContent = '…';

    const setRows = [...setRowsEl.querySelectorAll('[data-set-row]')];
    const sets = [];
    for (const r of setRows) {
      const a = parseInt(r.querySelector('.set-a').value, 10);
      const b = parseInt(r.querySelector('.set-b').value, 10);
      if (isNaN(a) || isNaN(b)) continue;
      if (!_isAdminValidTennisSet(a, b)) {
        toast(`Invalid set score ${a}–${b}. Valid: 6-0 to 6-4, 7-5, 7-6`, 'error');
        saveBtn.disabled = false; saveBtn.textContent = 'Save Result';
        return;
      }
      const tbRow = r.querySelector('[data-tb-row]');
      const tbVisible = tbRow && tbRow.style.display !== 'none';
      let tb = null;
      if (tbVisible) {
        const tba = parseInt(tbRow.querySelector('.tb-a').value, 10);
        const tbb = parseInt(tbRow.querySelector('.tb-b').value, 10);
        if (!isNaN(tba) && !isNaN(tbb)) tb = { a: tba, b: tbb };
      }
      sets.push(tb ? { a, b, tb } : { a, b });
    }

    // Auto-derive winner from sets if not manually chosen
    let winner = overlay.querySelector('#winner-select').value;
    if (!winner && sets.length) {
      const aWins = sets.filter(s => s.a > s.b).length;
      const bWins = sets.filter(s => s.b > s.a).length;
      if (aWins > bWins) winner = match.playerA;
      else if (bWins > aWins) winner = match.playerB;
    }
    if (!winner) { toast('Could not determine winner — select manually', 'error'); saveBtn.disabled = false; saveBtn.textContent = 'Save Result'; return; }

    const pAData = allPlayers[match.playerA] || {};
    const pBData = allPlayers[match.playerB] || {};
    const eloResult = calculateElo(pAData.eloRating||1000, pBData.eloRating||1000, winner===match.playerA ? 'a' : 'b');

    const now  = Date.now();
    const base = `seasons/${match.sid}/leagues/${match.lid}/matches/${match.mid}`;
    const updates = {
      [base + '/status']:        'confirmed',
      [base + '/confirmedAt']:   match.confirmedAt || now,
      [base + '/adminOverride']: true,
      [base + '/disputed']:      null,
      [base + '/result']:        { winner, sets },
      [`players/${match.playerA}/eloRating`]: eloResult.newA,
      [`players/${match.playerB}/eloRating`]: eloResult.newB,
    };
    await dbMultiUpdate(updates);
    overlay.remove();
    toast('Match saved — ELO updated', 'success');
    onDone();
  });
}

// ─── Bracket ──────────────────────────────────────────────────────────────────

async function renderBracketAdmin(el) {
  const [allSeasonsRaw, allPlayers] = await Promise.all([
    dbGet(dbRef('seasons')),
    dbGet(pRef()),
  ]);
  const players = allPlayers || {};
  const seasons = allSeasonsRaw || {};

  const sortedSeasons = Object.entries(seasons)
    .sort(([, sA], [, sB]) => (sB.createdAt || 0) - (sA.createdAt || 0));

  if (!sortedSeasons.length) { el.innerHTML = '<div class="admin-empty">No tournaments.</div>'; return; }

  let activeSid = _getAdminSid(sortedSeasons);
  let activeLid = null; // null = all leagues

  async function loadAndRender() {
    const leagues = await dbGet(sRef(activeSid, null, 'leagues'));
    if (!leagues) { el.querySelector('#bracket-body').innerHTML = '<div class="admin-empty">No leagues.</div>'; return; }

    const leagueEntries = Object.entries(leagues);
    if (!activeLid) activeLid = leagueEntries[0]?.[0] || null;

    // Update league tabs
    const tabsEl = el.querySelector('#bracket-league-tabs');
    if (tabsEl) {
      tabsEl.innerHTML = leagueEntries.map(([lid, l]) => `
        <button class="btn-admin ${lid===activeLid?'btn-primary':'btn-ghost'}"
          data-lid="${lid}" style="font-size:12px;">${escHtml(l.name||lid)}</button>
      `).join('');
      tabsEl.querySelectorAll('button[data-lid]').forEach(btn => {
        btn.addEventListener('click', () => { activeLid = btn.dataset.lid; loadAndRender(); });
      });
    }

    const bodyEl = el.querySelector('#bracket-body');
    bodyEl.innerHTML = '<div class="admin-loading"><div class="spinner"></div></div>';

    if (!activeLid || !leagues[activeLid]) { bodyEl.innerHTML = '<div class="admin-empty">Select a league.</div>'; return; }
    const lid    = activeLid;
    const league = leagues[lid];

    const [membersObj, matchesObj, bracketData, scoringConfig] = await Promise.all([
      dbGet(sRef(activeSid, lid, 'members')),
      dbGet(sRef(activeSid, lid, 'matches')),
      dbGet(sRef(activeSid, lid, 'bracket')),
      dbGet(sRef(activeSid, lid, 'scoringConfig')),
    ]);

    const memberUids  = Object.keys(membersObj || {});
    const allMatches  = matchesObj || {};
    const cfg         = scoringConfig || { minMatches: 6, minWins: 4, bracketSize: 4 };
    const gsConfig    = league.groupStageConfig || {};
    const pointsCfg   = league.pointsConfig     || {};
    const table       = buildLeagueTable(allMatches, memberUids);
    // When group stage is closed, use the qualified flag set during close (not minMatches/minWins)
    const qualified   = gsConfig.status === 'closed'
      ? table.filter(row => membersObj?.[row.uid]?.qualified === true)
      : getQualifiedPlayers(table, cfg);

    // Attach group points to table rows
    for (const row of table) {
      row.groupPoints = calculateGroupPoints(allMatches, row.uid, pointsCfg);
    }

    const div = document.createElement('div');
    div.innerHTML = `
      <div class="admin-form-panel">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
          <div style="font-weight:700;">${escHtml(league.name||lid)}</div>
          <div style="display:flex;gap:8px;">
            ${!bracketData || bracketData.status === 'pending' ? `
              <button class="btn-admin btn-primary" id="btn-gen-bracket">
                Generate Bracket (${qualified.length} qualified)
              </button>
            ` : `
              <span class="badge-admin badge-green">Bracket Active</span>
              <button class="btn-admin btn-danger" id="btn-reset-bracket">Reset</button>
            `}
          </div>
        </div>
        ${bracketData && bracketData.status !== 'pending'
          ? _renderBracketAdminView(bracketData, players, activeSid, lid)
          : _renderQualifiedTable(table, qualified, players, cfg, gsConfig)}
      </div>
    `;
    bodyEl.innerHTML = '';
    bodyEl.appendChild(div);

    // Player row click-through
    div.querySelectorAll('[data-view-player]').forEach(row => {
      row.addEventListener('click', () => {
        showPlayerModal(row.dataset.viewPlayer, players, allMatches, null);
      });
    });

    const genBtn = div.querySelector('#btn-gen-bracket');
    if (genBtn) {
      genBtn.addEventListener('click', async () => {
        if (qualified.length < 2) { toast('Need at least 2 qualified players', 'error'); return; }
        if (!confirm(`Generate bracket for ${qualified.length} players?`)) return;
        const bracket = _generateBracket(qualified, players);
        await dbSet(sRef(activeSid, lid, 'bracket'), bracket);
        await dbSet(dbRef(`notifications/bracket/${activeSid}_${lid}`), { sid: activeSid, lid, createdAt: Date.now() });
        toast('Bracket generated!', 'success');
        loadAndRender();
      });
    }
    const resetBtn = div.querySelector('#btn-reset-bracket');
    if (resetBtn) {
      resetBtn.addEventListener('click', async () => {
        if (!confirm('Reset the bracket? All bracket results will be lost.')) return;
        await dbRemove(sRef(activeSid, lid, 'bracket'));
        toast('Bracket reset', 'success');
        loadAndRender();
      });
    }
    div.querySelectorAll('[data-action="set-bracket-result"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const { sid: s, lid: l, rk, mk } = btn.dataset;
        _showBracketResultModal(s, l, rk, mk, bracketData, players, loadAndRender);
      });
    });
    div.querySelectorAll('[data-action="bye-advance"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { sid: s, lid: l, rk, mk } = btn.dataset;
        const bracket = await dbGet(sRef(s, l, 'bracket'));
        if (!bracket) return;
        const m = bracket.rounds[rk]?.matches[mk];
        if (!m) return;
        const winner = m.playerA || m.playerB;
        if (!winner) return;
        const ri     = parseInt(rk.replace('r', ''), 10);
        const mi     = parseInt(mk.replace('m', ''), 10);
        const nextRk = 'r' + (ri + 1);
        const nextMk = 'm' + Math.floor(mi / 2);
        const side   = mi % 2 === 0 ? 'playerA' : 'playerB';
        const updates = {
          [`seasons/${s}/leagues/${l}/bracket/rounds/${rk}/matches/${mk}/winner`]: winner,
          [`seasons/${s}/leagues/${l}/bracket/rounds/${rk}/matches/${mk}/score`]:  'BYE',
        };
        if (bracket.rounds[nextRk]?.matches[nextMk] !== undefined) {
          updates[`seasons/${s}/leagues/${l}/bracket/rounds/${nextRk}/matches/${nextMk}/${side}`] = winner;
        }
        await dbMultiUpdate(updates);
        toast('BYE advanced', 'success');
        loadAndRender();
      });
    });
  }

  el.innerHTML = `
    <div class="section-header">
      <div class="section-title">Playoff Bracket</div>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;align-items:center;">
      ${sortedSeasons.length > 1 ? `
        <select id="bracket-season-select" class="admin-input" style="max-width:200px;">
          ${sortedSeasons.map(([sid, s]) =>
            `<option value="${sid}" ${sid===activeSid?'selected':''}>${escHtml(s.name||sid)}</option>`
          ).join('')}
        </select>
      ` : ''}
      <div id="bracket-league-tabs" style="display:flex;gap:6px;flex-wrap:wrap;"></div>
    </div>
    <div id="bracket-body"><div class="admin-loading"><div class="spinner"></div></div></div>
  `;

  const seasonSel = el.querySelector('#bracket-season-select');
  if (seasonSel) {
    seasonSel.addEventListener('change', e => {
      activeSid = e.target.value;
      localStorage.setItem(ADMIN_SEASON_KEY, activeSid);
      activeLid = null;
      loadAndRender();
    });
  }

  await loadAndRender();
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
  // Odd player gets a bye
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

  // Propagate BYE winners through all rounds; auto-BYE any match left with one player and no source
  for (const rk of Object.keys(rounds).sort()) {
    const ri     = parseInt(rk.replace('r', ''), 10);
    const nextRk = 'r' + (ri + 1);
    if (!rounds[nextRk]) continue;
    for (const mk of Object.keys(rounds[rk].matches)) {
      const m = rounds[rk].matches[mk];
      if (!m.winner) continue;
      const mi     = parseInt(mk.replace('m', ''), 10);
      const nextMk = 'm' + Math.floor(mi / 2);
      const side   = mi % 2 === 0 ? 'playerA' : 'playerB';
      if (rounds[nextRk].matches[nextMk] && !rounds[nextRk].matches[nextMk][side]) {
        rounds[nextRk].matches[nextMk][side] = m.winner;
      }
    }
    for (const mk of Object.keys(rounds[nextRk].matches)) {
      const nm  = rounds[nextRk].matches[mk];
      if (nm.winner) continue;
      const nmi = parseInt(mk.replace('m', ''), 10);
      const hasSrcA = ('m' + (nmi * 2))     in rounds[rk].matches;
      const hasSrcB = ('m' + (nmi * 2 + 1)) in rounds[rk].matches;
      if (nm.playerA && !nm.playerB && !hasSrcB) { nm.winner = nm.playerA; nm.score = 'BYE'; }
      else if (!nm.playerA && nm.playerB && !hasSrcA) { nm.winner = nm.playerB; nm.score = 'BYE'; }
    }
  }

  return { status: 'active', bracketSize: n, createdAt: Date.now(), rounds };
}

function _renderQualifiedTable(table, qualified, allPlayers, cfg, gsConfig) {
  const bracketSize = cfg.bracketSize || 4;
  const gsStatus    = gsConfig?.status || 'pending';
  const showPts     = gsStatus === 'active' || gsStatus === 'closed';
  const qualifyPts  = gsConfig?.qualifyPoints ?? 6;

  return `
    <div style="overflow-x:auto;">
    <table class="admin-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Player</th>
          ${showPts ? '<th>Pts</th>' : ''}
          <th>W</th>
          <th>P</th>
          <th>GD</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${table.map((row, i) => {
          const p  = allPlayers[row.uid] || {};
          const q  = showPts ? (row.groupPoints ?? 0) >= qualifyPts : isQualified(row.standing, cfg);
          const s  = row.standing;
          const gp = row.groupPoints ?? null;
          return `
            <tr data-view-player="${row.uid}" style="cursor:pointer;"
              title="Click to view player profile">
              <td style="font-family:var(--font-mono);color:var(--text3);">${i + 1}</td>
              <td style="font-weight:${q ? '700' : '400'};">
                <div style="display:flex;align-items:center;gap:6px;">
                  ${avatarToSvg(p.avatarId || null, 22)}
                  ${escHtml(p.alias || p.name || row.uid)}
                </div>
              </td>
              ${showPts ? `
                <td style="font-family:var(--font-mono);font-weight:700;
                  color:${q ? 'var(--ace2)' : 'var(--text)'}">${gp ?? 0}</td>
              ` : ''}
              <td style="font-family:var(--font-mono);">${s.matchesWon}</td>
              <td style="font-family:var(--font-mono);">${s.matchesPlayed}</td>
              <td style="font-family:var(--font-mono);">${s.gameDiff >= 0 ? '+' : ''}${s.gameDiff}</td>
              <td><span class="badge-admin ${q ? 'badge-green' : 'badge-muted'}">
                ${q ? 'Qualified' : 'Not yet'}
              </span></td>
            </tr>
          `;
        }).join('')}
        ${table.length === 0 ? `
          <tr><td colspan="${showPts ? 7 : 6}"
            style="text-align:center;color:var(--text3);padding:16px;">No data</td></tr>
        ` : ''}
      </tbody>
    </table>
    </div>
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
              ${(m.playerA || m.playerB) && !(m.playerA && m.playerB) && !m.winner ? `
                <button class="btn-admin btn-secondary" data-action="bye-advance"
                  data-sid="${sid}" data-lid="${lid}" data-rk="${rk}" data-mk="${mk}">
                  Advance BYE
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
    writeActivity('bracket_advance', { sid, lid, playerId: winner?.uid || (typeof winner === 'string' ? winner : null), round: rk });
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
      <div class="admin-form-title">App Info</div>
      <div style="font-size:13px;color:var(--text2);">
        <div style="margin-bottom:4px;">ATP Greenwich Admin · v${APP_VERSION}</div>
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
