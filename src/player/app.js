// src/player/app.js — Main app shell: top bar, bottom nav, tab routing
// Each tab renders a placeholder; real content arrives in later phases.

import { dbGet, dbRef, dbMultiUpdate, pRef, sRef } from '@shared/firebase.js';
import { escHtml } from '@shared/utils.js';
import { eloTierLabel } from '@shared/elo.js';
import { logTabView, logInstallPrompted, logInstallCompleted } from '@shared/analytics.js';
import { avatarToSvg, renderAvatarPicker } from '@player/avatars.js';
import { renderMatchesTab }   from '@player/matches.js';
import { renderStandingsTab } from '@player/standings.js';
import { renderFeedTab }      from '@player/feed.js';
import { renderBracketTab }   from '@player/bracket.js';
import { buildLeagueTable, calculateStanding } from '@shared/scoring.js';

// ─── Tab definitions ──────────────────────────────────────────────────────────
const TABS = [
  {
    id:    'feed',
    label: 'Feed',
    phase: 5,
    icon:  '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  },
  {
    id:    'matches',
    label: 'Matches',
    phase: 3,
    icon:  '<circle cx="12" cy="12" r="10"/><line x1="2" x2="22" y1="12" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  },
  {
    id:    'standings',
    label: 'Standings',
    phase: 4,
    icon:  '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>',
  },
  {
    id:    'bracket',
    label: 'Bracket',
    phase: 6,
    icon:  '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  },
  {
    id:    'profile',
    label: 'Profile',
    phase: null, // Profile is functional in Phase 1B
    icon:  '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  },
];

// ─── App shell ────────────────────────────────────────────────────────────────

export function showApp(container, player, creds, onSignOut) {
  // Mutable local copies so avatar changes propagate without full re-mount
  let _player = player;
  let _creds  = creds;

  function onAvatarChanged(newAvatarId) {
    _player = { ..._player, avatarId: newAvatarId };
    _creds  = { ..._creds,  avatarId: newAvatarId };
    // Re-render the profile tab in place
    const content = container.querySelector('#tab-content');
    if (content && activeTab === 'profile') {
      renderProfileTab(content, _player, _creds, onSignOut, onAvatarChanged);
    }
  }

  let activeTab    = 'feed';
  let tabEnterTime = Date.now();
  let _tabCleanup  = null;

  function navIcon(tab) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-linecap="round" stroke-linejoin="round">${tab.icon}</svg>`;
  }

  function renderShell(activeTabId) {
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;min-height:100dvh;">

        <!-- Top bar -->
        <div class="top-bar">
          <div style="display:flex;align-items:center;gap:8px;">
            <div class="top-bar-logo">ATP</div>
            ${import.meta.env.DEV ? `
              <div style="font-family:var(--font-mono);font-size:9px;font-weight:700;
                background:#f4a923;color:#fff;padding:2px 7px;border-radius:4px;
                letter-spacing:.8px;text-transform:uppercase;line-height:1.6;">
                DEV
              </div>` : ''}
          </div>
          <div class="top-bar-right" id="topbar-right">Greenwich</div>
        </div>

        <!-- Tab content -->
        <div class="page" id="tab-content" style="flex:1;"></div>

        <!-- Bottom navigation -->
        <nav class="bottom-nav" role="navigation" aria-label="Main navigation">
          ${TABS.map(tab => `
            <button class="nav-item${tab.id === activeTabId ? ' active' : ''}"
              data-tab="${tab.id}"
              aria-label="${tab.label}"
              aria-current="${tab.id === activeTabId ? 'page' : 'false'}">
              ${navIcon(tab)}
              <span class="nav-label">${tab.label}</span>
            </button>
          `).join('')}
        </nav>

      </div>
    `;

    // Wire up nav clicks
    container.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const newTab = btn.dataset.tab;
        if (newTab === activeTab) return;

        const timeOnPrev = Math.round((Date.now() - tabEnterTime) / 1000);
        logTabView(newTab, activeTab, timeOnPrev);

        activeTab = newTab;
        tabEnterTime = Date.now();

        // Update active state without full re-render
        container.querySelectorAll('.nav-item').forEach(b => {
          const isActive = b.dataset.tab === newTab;
          b.classList.toggle('active', isActive);
          b.setAttribute('aria-current', isActive ? 'page' : 'false');
        });

        renderTabContent(newTab);
      });
    });

    renderTabContent(activeTabId);
  }

  function renderTabContent(tabId) {
    // Detach any real-time listeners from the previous tab
    if (_tabCleanup) { _tabCleanup(); _tabCleanup = null; }

    const content  = container.querySelector('#tab-content');
    const topRight = container.querySelector('#topbar-right');
    if (!content) return;

    switch (tabId) {
      case 'feed':
        topRight.textContent = 'Greenwich';
        _tabCleanup = renderFeedTab(content, _player, _creds) || null;
        break;
      case 'matches':
        topRight.textContent = 'Matches';
        _tabCleanup = renderMatchesTab(content, _player, _creds) || null;
        break;
      case 'standings':
        topRight.textContent = 'Standings';
        _tabCleanup = renderStandingsTab(content, _player, _creds) || null;
        break;
      case 'bracket':
        topRight.textContent = 'Bracket';
        _tabCleanup = renderBracketTab(content, _player, _creds) || null;
        break;
      case 'profile':
        topRight.textContent = 'Profile';
        renderProfileTab(content, _player, _creds, onSignOut, onAvatarChanged);
        break;
      default:
        content.innerHTML = '';
    }
  }

  renderShell(activeTab);
  _setupInstallPrompt(container);
}

// ─── PWA install prompt ───────────────────────────────────────────────────────

function _setupInstallPrompt(container) {
  if (localStorage.getItem('pwa_install_dismissed') === '1') return;
  if (window.matchMedia('(display-mode: standalone)').matches) return;

  let deferredPrompt = null;

  const banner = document.createElement('div');
  banner.id = 'pwa-install-banner';
  banner.style.cssText = `
    display:none;position:fixed;bottom:64px;left:50%;transform:translateX(-50%);
    background:var(--text);color:#fff;border-radius:12px;
    padding:10px 14px 10px 16px;display:none;align-items:center;gap:10px;
    font-size:13px;font-family:var(--font-sans);z-index:900;
    box-shadow:0 4px 16px rgba(28,24,20,0.25);max-width:calc(100vw - 32px);
  `;
  banner.innerHTML = `
    <span style="flex:1;">Add ATP Greenwich to your home screen</span>
    <button id="pwa-install-btn" style="background:var(--ace);color:#fff;border:none;
      border-radius:8px;padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer;
      white-space:nowrap;">Install</button>
    <button id="pwa-dismiss-btn" style="background:none;border:none;color:rgba(255,255,255,0.6);
      cursor:pointer;font-size:18px;line-height:1;padding:0 2px;">×</button>
  `;
  document.body.appendChild(banner);

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    banner.style.display = 'flex';
    logInstallPrompted(navigator.userAgent.includes('Android') ? 'android' : 'ios');
  });

  banner.querySelector('#pwa-install-btn').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') logInstallCompleted(navigator.userAgent.includes('Android') ? 'android' : 'ios');
    deferredPrompt = null;
    banner.remove();
  });

  banner.querySelector('#pwa-dismiss-btn').addEventListener('click', () => {
    localStorage.setItem('pwa_install_dismissed', '1');
    banner.remove();
  });
}

// ─── Tab: Profile ─────────────────────────────────────────────────────────────

function renderProfileTab(el, player, creds, onSignOut, onAvatarChanged) {
  const tier  = eloTierLabel(player.eloRating || 1000);
  const elo   = player.eloRating || 1000;
  const avatarSvg = player.avatarId
    ? avatarToSvg(player.avatarId, 80)
    : _defaultAvatarSvg(80);

  el.innerHTML = `
    <div style="padding-bottom:8px;">

      <!-- Avatar + name -->
      <div class="profile-header">
        ${avatarSvg}
        ${onAvatarChanged
          ? `<button class="btn btn-ghost btn-sm" id="btn-change-avatar"
               style="font-size:11px;padding:3px 10px;margin-top:2px;color:var(--ace2);height:auto;">
               Change avatar
             </button>`
          : ''}
        <div class="profile-name">${escHtml(player.name || 'Player')}</div>
        ${player.alias || player.username
          ? `<div class="profile-alias">@${escHtml(player.alias || player.username)}</div>`
          : ''}
        ${player.adminRole
          ? `<div class="badge badge-ace" style="margin-top:4px;">${escHtml(player.adminRole)}</div>`
          : ''}
      </div>

      <!-- ELO card -->
      <div class="card" style="text-align:center;margin-bottom:16px;">
        <div class="t-label t-muted" style="margin-bottom:8px;">ELO Rating</div>
        <div class="elo-display">${elo}</div>
        <div class="badge badge-ace" style="margin-top:8px;font-size:12px;">${escHtml(tier)}</div>
      </div>

      <!-- Season stats (loaded async below) -->
      <div class="card" style="margin-bottom:16px;" id="profile-stats-card">
        <div class="t-label t-muted" style="margin-bottom:12px;">Season Stats</div>
        <div style="text-align:center;padding:8px 0;">
          <div class="spinner spinner-sm" style="margin:0 auto;"></div>
        </div>
      </div>

      <!-- Account info -->
      <div class="card" style="margin-bottom:24px;">
        <div class="t-label t-muted" style="margin-bottom:12px;">Account</div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${player.email
            ? `<div class="flex-between">
                <span class="t-small t-muted">Email</span>
                <span class="t-small">${escHtml(player.email)}</span>
               </div>`
            : ''}
          <div class="flex-between">
            <span class="t-small t-muted">Status</span>
            <div class="badge badge-teal">${escHtml(player.status || 'active')}</div>
          </div>
          ${player.selfAssessment
            ? `<div class="flex-between">
                <span class="t-small t-muted">Self-assessed level</span>
                <span class="t-small">${escHtml(_levelLabel(player.selfAssessment.level))}</span>
               </div>`
            : ''}
        </div>
      </div>

      <!-- Sign out -->
      <button class="btn btn-surface" id="btn-signout"
        style="color:var(--ace3);border-color:var(--ace3);">
        Sign Out
      </button>

    </div>
  `;

  el.querySelector('#btn-signout').addEventListener('click', () => {
    if (confirm('Sign out of ATP Greenwich?')) {
      localStorage.removeItem('atp_player_creds');
      if (typeof onSignOut === 'function') onSignOut();
    }
  });

  // Load season stats asynchronously and populate the card
  _loadSeasonStats(creds.uid).then(stats => {
    const card = el.querySelector('#profile-stats-card');
    if (!card) return;
    const { wins, losses, played } = stats;
    card.innerHTML = `
      <div class="t-label t-muted" style="margin-bottom:12px;">Season Stats</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;text-align:center;">
        <div>
          <div style="font-family:var(--font-mono);font-size:22px;font-weight:500;color:var(--text);">
            ${wins}
          </div>
          <div class="t-label t-muted" style="margin-top:4px;">Wins</div>
        </div>
        <div>
          <div style="font-family:var(--font-mono);font-size:22px;font-weight:500;color:var(--text);">
            ${losses}
          </div>
          <div class="t-label t-muted" style="margin-top:4px;">Losses</div>
        </div>
        <div>
          <div style="font-family:var(--font-mono);font-size:22px;font-weight:500;color:var(--text);">
            ${played}
          </div>
          <div class="t-label t-muted" style="margin-top:4px;">Played</div>
        </div>
      </div>
    `;
  }).catch(() => {
    const card = el.querySelector('#profile-stats-card');
    if (card) card.innerHTML = `
      <div class="t-label t-muted" style="margin-bottom:12px;">Season Stats</div>
      <div style="text-align:center;padding:4px 0;">
        <span class="t-small t-muted">—</span>
      </div>
    `;
  });

  const changeBtn = el.querySelector('#btn-change-avatar');
  if (changeBtn && onAvatarChanged) {
    changeBtn.addEventListener('click', () => {
      showChangeAvatarModal(player, creds, onAvatarChanged);
    });
  }
}

// ─── Change avatar modal ──────────────────────────────────────────────────────

function showChangeAvatarModal(player, creds, onAvatarChanged) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:0 0 16px;">
        <div style="font-size:16px;font-weight:700;color:var(--text);">Change Avatar</div>
        <button class="btn-icon" id="btn-close-av-modal" aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
          </svg>
        </button>
      </div>
      <div id="av-modal-picker-mount"></div>
    </div>
  `;

  document.body.appendChild(overlay);

  function closeModal() {
    overlay.remove();
  }

  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  overlay.querySelector('#btn-close-av-modal').addEventListener('click', closeModal);

  const mount = overlay.querySelector('#av-modal-picker-mount');
  renderAvatarPicker(mount, [], async (avatarId) => {
    try {
      await dbMultiUpdate({ [`players/${creds.uid}/avatarId`]: avatarId });
      try {
        const raw = localStorage.getItem('atp_player_creds');
        if (raw) {
          const saved = JSON.parse(raw);
          saved.avatarId = avatarId;
          localStorage.setItem('atp_player_creds', JSON.stringify(saved));
        }
      } catch {}
      closeModal();
      onAvatarChanged(avatarId);
    } catch (err) {
      console.error('Failed to save avatar:', err);
    }
  }, creds.uid, (id) => _appCheckNoDuplicate(id, creds.uid));
}

async function _appCheckNoDuplicate(avatarId, excludeUid) {
  try {
    const all = await dbGet(dbRef('players'));
    if (!all) return true;
    for (const [uid, p] of Object.entries(all)) {
      if (uid !== excludeUid && p && p.avatarId === avatarId) {
        return 'Someone else already has this one — trying another…';
      }
    }
    return true;
  } catch {
    return true; // fail open — never block the user on a network error
  }
}

// ─── Season stats loader ──────────────────────────────────────────────────────

async function _loadSeasonStats(uid) {
  try {
    const sid = await dbGet(dbRef('config/defaultSeason'));
    if (!sid) return { wins: 0, losses: 0, played: 0 };
    const leagues = await dbGet(sRef(sid, null, 'leagues'));
    if (!leagues) return { wins: 0, losses: 0, played: 0 };
    for (const [lid] of Object.entries(leagues)) {
      const member = await dbGet(sRef(sid, lid, 'members/' + uid));
      if (member === null) continue;
      const matchesObj = await dbGet(sRef(sid, lid, 'matches'));
      if (!matchesObj) return { wins: 0, losses: 0, played: 0 };
      const myMatches = Object.values(matchesObj).filter(
        m => m.status === 'confirmed' && (m.playerA === uid || m.playerB === uid)
      );
      const standing = calculateStanding(myMatches, uid);
      return {
        wins:   standing.matchesWon,
        losses: standing.matchesPlayed - standing.matchesWon,
        played: standing.matchesPlayed,
      };
    }
  } catch {}
  return { wins: 0, losses: 0, played: 0 };
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function _defaultAvatarSvg(sz) {
  return `<svg width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${sz}" height="${sz}" rx="${sz / 2}" fill="#f0ebe2"/>
    <circle cx="${sz / 2}" cy="${sz * 0.38}" r="${sz * 0.18}" fill="#c8bfb0"/>
    <ellipse cx="${sz / 2}" cy="${sz * 0.75}" rx="${sz * 0.27}" ry="${sz * 0.16}" fill="#c8bfb0"/>
  </svg>`;
}

function _levelLabel(key) {
  const map = {
    beginner_new: 'Just starting out',
    beginner:     'Beginner',
    intermediate: 'Intermediate',
    advanced:     'Advanced',
    expert:       'Expert',
  };
  return map[key] || key || '';
}
