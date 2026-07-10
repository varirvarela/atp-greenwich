// src/player/app.js — Main app shell: top bar, bottom nav, tab routing
// Each tab renders a placeholder; real content arrives in later phases.

import { dbGet, dbRef, dbListen, dbMultiUpdate, pRef, sRef } from '@shared/firebase.js';
import { writeActivity } from '@shared/activity.js';
import { escHtml, simpleHash } from '@shared/utils.js';
import { eloTierLabel } from '@shared/elo.js';
import { logTabView, logInstallPrompted, logInstallCompleted } from '@shared/analytics.js';
import { avatarToSvg, renderAvatarPicker } from '@player/avatars.js';
import { renderMatchesTab }   from '@player/matches.js';
import { renderStandingsTab } from '@player/standings.js';
import { renderFeedTab }      from '@player/feed.js';
import { renderBracketTab }   from '@player/bracket.js';
import { buildLeagueTable, calculateStanding } from '@shared/scoring.js';
import { APP_VERSION, changesSince } from '@shared/changelog.js';

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
    const content = container.querySelector('#tab-content');
    if (content && activeTab === 'profile') {
      renderProfileTab(content, _player, _creds, onSignOut, onAvatarChanged, onAliasChanged, onReplayTutorial);
    }
  }

  function onAliasChanged(newAlias) {
    _player = { ..._player, alias: newAlias, username: newAlias };
    const content = container.querySelector('#tab-content');
    if (content && activeTab === 'profile') {
      renderProfileTab(content, _player, _creds, onSignOut, onAvatarChanged, onAliasChanged, onReplayTutorial);
    } else {
      // Update the alias display in place without full re-render
      const aliasEl = container.querySelector('#profile-alias-display');
      if (aliasEl) aliasEl.textContent = '@' + newAlias;
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

        <!-- Top bar: tournament + league pills only -->
        <div class="top-bar">
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;">
            <span style="font-size:9px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;
              color:var(--text3);padding-left:4px;">Season</span>
            <div id="tournament-switcher-area"></div>
          </div>
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;">
            <span style="font-size:9px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;
              color:var(--text3);padding-left:4px;">League</span>
            <div id="league-switcher-area"></div>
          </div>
        </div>

        <!-- Tab content -->
        <div class="page" id="tab-content" style="flex:1;"></div>

        <!-- Version footer (fixed above bottom nav via .app-version-footer CSS) -->
        <div class="app-version-footer">
          ATP Greenwich · v${APP_VERSION}${import.meta.env.DEV ? ' · <span style="color:#b84008;font-weight:700;">DEV</span>' : ''}
        </div>

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

        // Clear badges when opening their respective tabs
        if (newTab === 'feed') {
          localStorage.setItem(FEED_LAST_OPEN_KEY, String(Date.now()));
          _updateNavBadge(container, 'feed', 0);
        }
        if (newTab === 'matches') {
          localStorage.setItem(MATCHES_LAST_OPEN_KEY, String(Date.now()));
          _updateNavBadge(container, 'matches', 0);
        }

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
    if (_tabCleanup) { _tabCleanup(); _tabCleanup = null; }
    const content = container.querySelector('#tab-content');
    if (!content) return;
    switch (tabId) {
      case 'feed':      _tabCleanup = renderFeedTab(content, _player, _creds) || null; break;
      case 'matches':   _tabCleanup = renderMatchesTab(content, _player, _creds) || null; break;
      case 'standings': _tabCleanup = renderStandingsTab(content, _player, _creds) || null; break;
      case 'bracket':   _tabCleanup = renderBracketTab(content, _player, _creds) || null; break;
      case 'profile':   renderProfileTab(content, _player, _creds, onSignOut, onAvatarChanged, onAliasChanged, onReplayTutorial); break;
      default: content.innerHTML = '';
    }
  }

  function navigateToTab(tabId) {
    activeTab = tabId;
    container.querySelectorAll('.nav-item').forEach(b => {
      const isActive = b.dataset.tab === tabId;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-current', isActive ? 'page' : 'false');
    });
    renderTabContent(tabId);
  }

  function onReplayTutorial() {
    localStorage.removeItem(WALKTHROUGH_KEY);
    navigateToTab('feed');
    _showWalkthroughModal(navigateToTab);
  }

  renderShell(activeTab);
  _setupInstallPrompt(container);
  _setupPushNotifications(creds.uid);
  _checkWhatsNew();
  _checkWalkthrough(navigateToTab);

  // Top-bar switchers: unified tournament + league init
  (async () => {
    const allSeasons = await dbGet(dbRef('seasons'));
    if (!allSeasons) return;
    const seasonOrder = Object.keys(allSeasons).sort((a, b) =>
      (allSeasons[b].createdAt || 0) - (allSeasons[a].createdAt || 0)
    );

    // Seasons the player has at least one league membership in
    const playerSeasons = [];
    for (const sid of seasonOrder) {
      const leagues = allSeasons[sid]?.leagues;
      if (!leagues) continue;
      for (const lid of Object.keys(leagues)) {
        const member = await dbGet(sRef(sid, lid, 'members/' + creds.uid));
        if (member !== null) {
          playerSeasons.push({ sid, name: allSeasons[sid].name || sid });
          break;
        }
      }
    }
    if (playerSeasons.length === 0) return;

    const storedSid = localStorage.getItem('atp_active_season');
    if (!storedSid || !playerSeasons.find(s => s.sid === storedSid)) {
      localStorage.setItem('atp_active_season', playerSeasons[0].sid);
    }

    // League pill — shows ALL leagues in the active tournament
    async function _initLeaguePill() {
      const sid    = localStorage.getItem('atp_active_season') || playerSeasons[0].sid;
      const lArea  = container.querySelector('#league-switcher-area');
      if (!lArea) return;
      const allLeagues = Object.entries(allSeasons[sid]?.leagues || {})
        .map(([lid, l]) => ({ sid, lid, leagueName: l.name || lid }));
      if (allLeagues.length === 0) { lArea.innerHTML = ''; return; }

      // Default to player's own league if atp_active_lid not set or invalid
      const storedLid = localStorage.getItem('atp_active_lid');
      if (!storedLid || !allLeagues.find(l => l.lid === storedLid)) {
        let def = null;
        for (const { lid } of allLeagues) {
          const m = await dbGet(sRef(sid, lid, 'members/' + creds.uid));
          if (m !== null) { def = lid; break; }
        }
        localStorage.setItem('atp_active_lid', def || allLeagues[0].lid);
      }

      function _drawLeaguePill() {
        const curLid = localStorage.getItem('atp_active_lid') || allLeagues[0].lid;
        const cur    = allLeagues.find(l => l.lid === curLid) || allLeagues[0];
        lArea.innerHTML = `
          <button id="league-switch-btn"
            style="display:flex;align-items:center;gap:5px;background:var(--surface2);
              border:1px solid var(--border);border-radius:20px;padding:5px 12px;
              font-size:13px;font-weight:700;cursor:pointer;
              color:var(--text);width:100%;letter-spacing:.2px;">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;text-align:left;">
              ${escHtml(cur.leagueName)}
            </span>
            ${allLeagues.length > 1 ? `
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2.5" stroke-linecap="round" style="flex-shrink:0;">
                <polyline points="6 9 12 15 18 9"/>
              </svg>` : ''}
          </button>
        `;
        if (allLeagues.length > 1) {
          lArea.querySelector('#league-switch-btn').addEventListener('click', () => {
            _showLeaguePicker(allLeagues, container, () => {
              _drawLeaguePill();
              renderTabContent(activeTab);
            });
          });
        }
      }
      _drawLeaguePill();
    }

    await _initLeaguePill();

    // Start badge listeners now that we have the active season + all its leagues
    const badgeSid     = localStorage.getItem('atp_active_season') || playerSeasons[0].sid;
    const badgeLeagues = Object.keys(allSeasons[badgeSid]?.leagues || {});
    _startBadgeListeners(container, creds.uid, badgeSid, badgeLeagues);

    // Tournament pill
    const tArea = container.querySelector('#tournament-switcher-area');
    if (!tArea) return;

    function _drawTournamentPill() {
      const curSid = localStorage.getItem('atp_active_season') || playerSeasons[0].sid;
      const cur    = playerSeasons.find(s => s.sid === curSid) || playerSeasons[0];
      tArea.innerHTML = `
        <button id="tournament-switch-btn"
          style="display:flex;align-items:center;gap:5px;background:rgba(184,64,8,.1);
            border:1px solid var(--ace);border-radius:20px;padding:5px 12px;
            font-size:13px;font-weight:700;cursor:pointer;
            color:var(--ace);width:100%;letter-spacing:.2px;">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;text-align:left;">
            ${escHtml(cur.name)}
          </span>
          ${playerSeasons.length > 1 ? `
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2.5" stroke-linecap="round" style="flex-shrink:0;">
              <polyline points="6 9 12 15 18 9"/>
            </svg>` : ''}
        </button>
      `;
      if (playerSeasons.length > 1) {
        tArea.querySelector('#tournament-switch-btn').addEventListener('click', () => {
          _showTournamentPicker(playerSeasons, container, async () => {
            localStorage.removeItem('atp_active_lid');
            _drawTournamentPill();
            await _initLeaguePill();
            renderTabContent(activeTab);
          });
        });
      }
    }
    _drawTournamentPill();
  })().catch(() => {});
}

async function _loadAllLeagues(uid) {
  try {
    const allSeasons = await dbGet(dbRef('seasons'));
    if (!allSeasons) return [];
    const seasonOrder = Object.keys(allSeasons).sort((a, b) =>
      (allSeasons[b].createdAt || 0) - (allSeasons[a].createdAt || 0)
    );
    const result = [];
    for (const sid of seasonOrder) {
      const leagues = allSeasons[sid]?.leagues;
      if (!leagues) continue;
      for (const [lid, league] of Object.entries(leagues)) {
        const member = await dbGet(sRef(sid, lid, 'members/' + uid));
        if (member !== null) result.push({ sid, lid, leagueName: league.name || 'League' });
      }
    }
    return result;
  } catch { return []; }
}

function _showTournamentPicker(seasons, container, onSwitch) {
  const currentSid = localStorage.getItem('atp_active_season') || seasons[0]?.sid;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div style="font-size:16px;font-weight:700;padding:0 0 16px;">Switch Tournament</div>
      <div style="display:flex;flex-direction:column;gap:8px;padding-bottom:8px;">
        ${seasons.map(s => `
          <div class="tap-card${s.sid === currentSid ? ' selected' : ''}"
            data-sid="${escHtml(s.sid)}"
            style="padding:14px 16px;">
            <div style="font-weight:700;font-size:14px;">${escHtml(s.name)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelectorAll('[data-sid]').forEach(card => {
    card.addEventListener('click', () => {
      const sid = card.dataset.sid;
      localStorage.setItem('atp_active_season', sid);
      localStorage.removeItem('atp_active_lid');
      overlay.remove();
      onSwitch();
    });
  });
}

function _showLeaguePicker(allLeagues, container, onSwitch) {
  const currentLid = localStorage.getItem('atp_active_lid') || allLeagues[0]?.lid;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div style="font-size:16px;font-weight:700;padding:0 0 16px;">Switch League</div>
      <div style="display:flex;flex-direction:column;gap:8px;padding-bottom:8px;">
        ${allLeagues.map(l => `
          <div class="tap-card${l.lid === currentLid ? ' selected' : ''}"
            data-lid="${escHtml(l.lid)}"
            style="padding:14px 16px;">
            <div style="font-weight:700;font-size:14px;">${escHtml(l.leagueName)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelectorAll('[data-lid]').forEach(card => {
    card.addEventListener('click', () => {
      const lid = card.dataset.lid;
      localStorage.setItem('atp_active_lid', lid);
      overlay.remove();
      onSwitch();
    });
  });
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

// ─── Push notifications opt-in ────────────────────────────────────────────────

async function _setupPushNotifications(uid) {
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!vapidKey) return; // not configured
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  try {
    const reg = await navigator.serviceWorker.register(
      import.meta.env.BASE_URL + 'sw.js',
      { scope: import.meta.env.BASE_URL }
    );

    if (Notification.permission === 'granted') {
      await _subscribePush(reg, uid, vapidKey);
      return;
    }

    if (Notification.permission === 'denied') return;
    if (localStorage.getItem('push_dismissed') === '1') return;

    // Show a non-intrusive opt-in banner
    const banner = document.createElement('div');
    banner.id = 'push-opt-in-banner';
    banner.style.cssText = `
      position:fixed;bottom:64px;left:50%;transform:translateX(-50%);
      background:var(--text);color:#fff;border-radius:12px;
      padding:10px 14px;display:flex;align-items:center;gap:10px;
      font-size:13px;font-family:var(--font-sans);z-index:900;
      box-shadow:0 4px 16px rgba(28,24,20,0.25);max-width:calc(100vw - 32px);
    `;
    banner.innerHTML = `
      <span style="flex:1;">Get notified when you're challenged or a result is entered</span>
      <button id="push-enable-btn" style="background:var(--ace);color:#fff;border:none;
        border-radius:8px;padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer;
        white-space:nowrap;">Enable</button>
      <button id="push-later-btn" style="background:none;border:none;
        color:rgba(255,255,255,0.6);cursor:pointer;font-size:18px;line-height:1;padding:0 2px;">×</button>
    `;
    document.body.appendChild(banner);

    banner.querySelector('#push-enable-btn').addEventListener('click', async () => {
      banner.remove();
      const perm = await Notification.requestPermission();
      if (perm === 'granted') await _subscribePush(reg, uid, vapidKey);
    });

    banner.querySelector('#push-later-btn').addEventListener('click', () => {
      localStorage.setItem('push_dismissed', '1');
      banner.remove();
    });

  } catch (err) {
    console.warn('Push setup failed:', err);
  }
}

async function _subscribePush(reg, uid, vapidKey) {
  try {
    const existing = await reg.pushManager.getSubscription();
    const sub = existing || await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: _urlBase64ToUint8Array(vapidKey),
    });
    await dbMultiUpdate({ [`players/${uid}/pushSubscription`]: sub.toJSON() });
  } catch (err) {
    console.warn('Push subscribe failed:', err);
  }
}

function _urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// ─── Tab: Profile ─────────────────────────────────────────────────────────────

function renderProfileTab(el, player, creds, onSignOut, onAvatarChanged, onAliasChanged, onReplayTutorial) {
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
          ? `<div style="display:flex;align-items:center;gap:6px;">
               <div class="profile-alias" id="profile-alias-display">@${escHtml(player.alias || player.username)}</div>
               ${onAliasChanged ? `
                 <button id="btn-edit-alias" aria-label="Edit alias"
                   style="background:transparent;border:none;cursor:pointer;padding:2px;
                     color:var(--text3);display:flex;align-items:center;line-height:1;">
                   <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2" stroke-linecap="round"
                     stroke-linejoin="round">
                     <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                   </svg>
                 </button>` : ''}
             </div>`
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

      <!-- ELO explanation accordion -->
      <details style="margin-bottom:16px;border-radius:var(--radius);overflow:hidden;
        border:1px solid var(--border);">
        <summary style="background:var(--surface2);padding:10px 12px;font-size:12px;
          font-weight:700;cursor:pointer;list-style:none;display:flex;
          justify-content:space-between;align-items:center;">
          <span>How ELO works</span>
          <span style="color:var(--text3);font-size:10px;">tap to expand</span>
        </summary>
        <div style="background:var(--surface2);padding:10px 14px 16px;
          border-top:1px solid var(--border);font-size:12px;color:var(--text2);line-height:1.65;">
          <p style="margin:0 0 8px;">Your ELO measures skill relative to other players. It updates after every confirmed match using this formula:</p>
          <div style="background:var(--surface);border-radius:6px;padding:8px 12px;
            font-family:var(--font-mono);font-size:11px;margin-bottom:10px;
            border:1px solid var(--border);color:var(--text);">
            New ELO = Old ELO + 32 × (W − Eₐ)<br>
            <span style="color:var(--text3);font-size:10px;">
              W = 1 if you won, 0 if you lost<br>
              Eₐ = 1 / (1 + 10^((opponent − yours) / 400))
            </span>
          </div>
          <p style="margin:0 0 6px;font-weight:700;color:var(--text);">Examples</p>
          <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px;">
            <div style="background:var(--surface);border-radius:6px;padding:8px 12px;
              border-left:3px solid var(--ace2);font-size:11px;">
              <strong>You (1000) beat a stronger player (1200):</strong><br>
              Eₐ = 1 / (1 + 10^((1200−1000)/400)) ≈ 0.24<br>
              Change = 32 × (1 − 0.24) = <strong style="color:var(--ace2);">+24 pts</strong>
            </div>
            <div style="background:var(--surface);border-radius:6px;padding:8px 12px;
              border-left:3px solid var(--ace3);font-size:11px;">
              <strong>You (1000) lose to a weaker player (800):</strong><br>
              Eₐ = 1 / (1 + 10^((800−1000)/400)) ≈ 0.76<br>
              Change = 32 × (0 − 0.76) = <strong style="color:var(--ace3);">−24 pts</strong>
            </div>
          </div>
          <p style="margin:0;color:var(--text3);">Everyone starts at 1000. The bigger the upset, the larger the swing.</p>
        </div>
      </details>

      <!-- League format explanation accordion -->
      <details style="margin-bottom:16px;border-radius:var(--radius);overflow:hidden;
        border:1px solid var(--border);">
        <summary style="background:var(--surface2);padding:10px 12px;font-size:12px;
          font-weight:700;cursor:pointer;list-style:none;display:flex;
          justify-content:space-between;align-items:center;">
          <span>How the League Works</span>
          <span style="color:var(--text3);font-size:10px;">tap to expand</span>
        </summary>
        <div style="padding:14px 16px;display:flex;flex-direction:column;gap:14px;font-size:13px;line-height:1.6;color:var(--text2);">
          <div>
            <strong style="color:var(--text);display:block;margin-bottom:4px;">Group phase</strong>
            You are assigned to a league for the season. Your ranking is based on group stage points earned from match results.
          </div>
          <div>
            <strong style="color:var(--text);display:block;margin-bottom:4px;">Scheduled matches</strong>
            The admin releases a set of fixtures with a play-by deadline. All matches — scheduled or ad-hoc — use the same scoring rules. The difference: if a scheduled match is not played before the deadline, both players receive a points penalty.
          </div>
          <div>
            <strong style="color:var(--text);display:block;margin-bottom:4px;">Ad-hoc matches</strong>
            You can challenge any player in your league at any time. These count toward your ELO and stats — but if an ad-hoc match is not played, there is no penalty.
          </div>
          <div>
            <strong style="color:var(--text);display:block;margin-bottom:4px;">Knockout bracket</strong>
            Once the group stage closes, the top-ranked players qualify for the elimination bracket. From there it is straight knockout.
          </div>
        </div>
      </details>

      ${(player.isAdmin || player.email === 'pablorvarela@gmail.com') ? `
      <!-- Admin / Owner access -->
      <div class="card" style="margin-bottom:16px;background:var(--ace-bg);border-color:var(--ace);">
        <div class="t-label" style="color:var(--ace);margin-bottom:8px;">
          ${player.email === 'pablorvarela@gmail.com' ? 'App Owner' : 'Admin Access'}
        </div>
        <p class="t-small" style="color:var(--text2);margin-bottom:12px;">
          ${player.email === 'pablorvarela@gmail.com'
            ? 'You are the app owner. Open the dashboard to manage players, leagues, and matches.'
            : 'You have admin privileges. Open the dashboard to manage players, leagues, and matches.'}
        </p>
        <a href="${import.meta.env.BASE_URL}admin/"
          style="display:block;text-align:center;text-decoration:none;
            background:var(--ace);color:#fff;border-radius:var(--radius);
            padding:10px;font-weight:700;font-size:14px;">
          Open Admin Panel →
        </a>
      </div>
      ` : ''}

      <!-- Season stats (loaded async below) -->
      <div class="card" style="margin-bottom:16px;" id="profile-stats-card">
        <div class="t-label t-muted" style="margin-bottom:12px;">Season Stats</div>
        <div style="text-align:center;padding:8px 0;">
          <div class="spinner spinner-sm" style="margin:0 auto;"></div>
        </div>
      </div>

      <!-- ELO history chart (loaded async below) -->
      <div class="card" style="margin-bottom:16px;" id="profile-elo-chart">
        <div class="t-label t-muted" style="margin-bottom:10px;">ELO History</div>
        <div style="text-align:center;padding:8px 0;">
          <div class="spinner spinner-sm" style="margin:0 auto;"></div>
        </div>
      </div>

      <!-- Account info -->
      <div class="card" style="margin-bottom:16px;">
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

      <!-- Replay tutorial -->
      <div style="margin-bottom:16px;text-align:center;">
        <button class="btn btn-ghost btn-sm" id="btn-replay-tutorial"
          style="color:var(--text3);font-size:12px;">
          Replay app tutorial
        </button>
      </div>

      <!-- Security -->
      <div class="card" style="margin-bottom:24px;">
        <div class="t-label t-muted" style="margin-bottom:12px;">Security</div>
        <button class="btn btn-surface btn-sm" id="btn-change-password"
          style="width:100%;text-align:left;justify-content:flex-start;gap:10px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          Change Password
        </button>
      </div>

      <!-- En honor a Pepe -->
      <details style="margin-bottom:24px;border-radius:var(--radius);overflow:hidden;
        border:1px solid var(--border);">
        <summary style="background:var(--surface2);padding:10px 14px;font-size:13px;
          font-weight:700;cursor:pointer;list-style:none;display:flex;align-items:center;
          gap:8px;color:var(--text);">
          <span>🎾</span>
          <span>En honor a Pepe</span>
        </summary>
        <div style="background:var(--surface2);padding:14px;border-top:1px solid var(--border);
          font-size:13px;color:var(--text2);line-height:1.7;">
          <img src="${import.meta.env.BASE_URL}images/Pepe.jpeg"
            alt="Pepe" style="width:100%;border-radius:8px;display:block;
            margin-bottom:14px;object-fit:cover;max-height:320px;">
          <p style="margin:0 0 8px;font-weight:700;color:var(--text);">ATP — Amigos en el Tenis gracias a Pepe.</p>
          <p style="margin:0 0 8px;">Pepe fue quien nos reunió a todos para jugar al tenis. Con su energía y entusiasmo inagotable, creó una liga amateur a pulmón que nos entretuvo por varias temporadas y forjó amistades duraderas.</p>
          <p style="margin:0 0 8px;">No somos tenistas. Somos los <em>Salieris de Pepe</em>: convocados por su pasión, unidos por la cancha, y eternamente agradecidos por haber sido parte de algo que empezó con una simple invitación suya.</p>
          <p style="margin:0;font-size:11px;color:var(--text3);">Este es el legado de Pepe.</p>
        </div>
      </details>

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

  el.querySelector('#btn-change-password')?.addEventListener('click', () => {
    showChangePasswordModal(player, creds);
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

  // Load ELO history chart
  dbGet(dbRef(`players/${creds.uid}/eloHistory`)).then(raw => {
    const chartCard = el.querySelector('#profile-elo-chart');
    if (!chartCard) return;
    const history = Array.isArray(raw) ? raw : (raw ? Object.values(raw) : []);
    if (history.length < 2) {
      chartCard.innerHTML = `
        <div class="t-label t-muted" style="margin-bottom:10px;">ELO History</div>
        <div style="text-align:center;padding:8px 0;">
          <span class="t-small t-muted">Not enough data yet</span>
        </div>
      `;
      return;
    }
    // Sort by timestamp, compute cumulative ELO from current rating
    const sorted = [...history].sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const currentElo = player.eloRating || 1000;
    const totalDelta = sorted.reduce((s, e) => s + (e.delta || 0), 0);
    let running = currentElo - totalDelta;
    const points = sorted.map(e => { running += (e.delta || 0); return running; });

    chartCard.innerHTML = `
      <div class="t-label t-muted" style="margin-bottom:10px;">ELO History</div>
      ${_renderEloSparkline(points, currentElo)}
      <div style="display:flex;justify-content:space-between;margin-top:6px;">
        <span class="t-small t-muted">${points[0]}</span>
        <span class="t-small" style="font-family:var(--font-mono);font-weight:700;">${currentElo}</span>
      </div>
    `;
  }).catch(() => {
    const chartCard = el.querySelector('#profile-elo-chart');
    if (chartCard) chartCard.style.display = 'none';
  });

  const changeBtn = el.querySelector('#btn-change-avatar');
  if (changeBtn && onAvatarChanged) {
    changeBtn.addEventListener('click', () => {
      showChangeAvatarModal(player, creds, onAvatarChanged);
    });
  }

  const editAliasBtn = el.querySelector('#btn-edit-alias');
  if (editAliasBtn && onAliasChanged) {
    editAliasBtn.addEventListener('click', () => {
      showEditAliasModal(player, creds, onAliasChanged);
    });
  }

  const replayTutorialBtn = el.querySelector('#btn-replay-tutorial');
  if (replayTutorialBtn && onReplayTutorial) {
    replayTutorialBtn.addEventListener('click', onReplayTutorial);
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
      writeActivity('profile_change', { uid: creds.uid, what: 'avatar', newVal: avatarId });
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
  }, player.avatarId || creds.uid, (id) => _appCheckNoDuplicate(id, creds.uid));
}

// ─── Edit alias modal ─────────────────────────────────────────────────────────

function showEditAliasModal(player, creds, onAliasChanged) {
  const currentAlias = (player.alias || player.username || '').toLowerCase();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:0 0 16px;">
        <div style="font-size:16px;font-weight:700;">Change Alias</div>
        <button class="btn-icon" id="btn-close-alias-modal" aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
          </svg>
        </button>
      </div>
      <div class="input-group">
        <label class="input-label" for="alias-edit-input">Alias</label>
        <input class="input" id="alias-edit-input" type="text"
          value="${escHtml(player.alias || player.username || '')}"
          maxlength="30" autocomplete="off" autocapitalize="none"
          autocorrect="off" spellcheck="false">
        <div id="alias-edit-hint" class="input-hint" style="font-size:12px;color:var(--text3);
          margin-top:4px;">Letters, numbers, and underscores.</div>
      </div>
      <div style="padding-top:16px;">
        <button class="btn btn-primary" id="btn-save-alias" disabled>Save</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  function closeModal() { overlay.remove(); }
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  overlay.querySelector('#btn-close-alias-modal').addEventListener('click', closeModal);

  const input   = overlay.querySelector('#alias-edit-input');
  const hint    = overlay.querySelector('#alias-edit-hint');
  const saveBtn = overlay.querySelector('#btn-save-alias');
  let aliasValid = false;
  let debounce   = null;

  input.focus();
  input.select();

  input.addEventListener('input', () => {
    clearTimeout(debounce);
    aliasValid = false;
    saveBtn.disabled = true;
    hint.style.color = 'var(--text3)';

    const val = input.value.trim();

    if (val.toLowerCase() === currentAlias) {
      hint.textContent = 'This is your current alias.';
      return;
    }
    if (val.length < 2) {
      hint.textContent = 'At least 2 characters required.';
      return;
    }

    hint.textContent = 'Checking…';

    debounce = setTimeout(async () => {
      try {
        const all = await dbGet(dbRef('players'));
        const taken = all
          ? Object.entries(all)
              .filter(([id]) => id !== creds.uid)
              .some(([, p]) =>
                (p.alias    || '').toLowerCase() === val.toLowerCase() ||
                (p.username || '').toLowerCase() === val.toLowerCase()
              )
          : false;

        if (taken) {
          hint.textContent   = 'Alias already taken — choose another.';
          hint.style.color   = 'var(--ace3)';
          aliasValid         = false;
        } else {
          hint.textContent   = 'Alias available ✓';
          hint.style.color   = 'var(--ace2)';
          aliasValid         = true;
          saveBtn.disabled   = false;
        }
      } catch {
        aliasValid         = true;
        saveBtn.disabled   = false;
      }
    }, 500);
  });

  saveBtn.addEventListener('click', async () => {
    const newAlias = input.value.trim();
    if (!aliasValid || newAlias.length < 2) return;
    saveBtn.disabled  = true;
    saveBtn.textContent = 'Saving…';
    try {
      await dbMultiUpdate({
        [`players/${creds.uid}/alias`]:    newAlias,
        [`players/${creds.uid}/username`]: newAlias,
      });
      writeActivity('profile_change', { uid: creds.uid, what: 'alias', newVal: newAlias });
      closeModal();
      onAliasChanged(newAlias);
    } catch (err) {
      console.error('Save alias error:', err);
      saveBtn.disabled    = false;
      saveBtn.textContent = 'Save';
    }
  });
}

// ─── ELO sparkline ───────────────────────────────────────────────────────────

function _renderEloSparkline(points, currentElo) {
  const W = 280, H = 60, PAD = 4;
  const min = Math.min(...points) - 10;
  const max = Math.max(...points) + 10;
  const range = max - min || 1;
  const step  = (W - PAD * 2) / (points.length - 1);

  const coords = points.map((v, i) => [
    PAD + i * step,
    PAD + (1 - (v - min) / range) * (H - PAD * 2),
  ]);

  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' ');
  const area = line + ` L${coords[coords.length - 1][0].toFixed(1)},${H} L${PAD},${H} Z`;

  const last = coords[coords.length - 1];
  const color = currentElo >= points[0] ? 'var(--ace2)' : 'var(--ace3)';

  return `
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="display:block;overflow:visible;">
      <defs>
        <linearGradient id="elo-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.22"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${area}" fill="url(#elo-grad)" stroke="none"/>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3.5"
        fill="${color}" stroke="var(--surface)" stroke-width="1.5"/>
    </svg>
  `;
}

// ─── Change password modal ────────────────────────────────────────────────────

function showChangePasswordModal(player, creds) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:0 0 16px;">
        <div style="font-size:16px;font-weight:700;">Change Password</div>
        <button class="btn-icon" id="btn-close-pwd-modal" aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
          </svg>
        </button>
      </div>
      <div class="input-group" style="margin-bottom:12px;">
        <label class="input-label" for="pwd-current">Current password</label>
        <input class="input" id="pwd-current" type="password" autocomplete="current-password">
      </div>
      <div class="input-group" style="margin-bottom:12px;">
        <label class="input-label" for="pwd-new">New password</label>
        <input class="input" id="pwd-new" type="password" autocomplete="new-password" minlength="6">
      </div>
      <div class="input-group" style="margin-bottom:16px;">
        <label class="input-label" for="pwd-confirm">Confirm new password</label>
        <input class="input" id="pwd-confirm" type="password" autocomplete="new-password">
        <div id="pwd-hint" class="input-hint" style="font-size:12px;color:var(--text3);margin-top:4px;"></div>
      </div>
      <button class="btn btn-primary" id="btn-save-pwd">Save Password</button>
    </div>
  `;

  document.body.appendChild(overlay);

  function closeModal() { overlay.remove(); }
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  overlay.querySelector('#btn-close-pwd-modal').addEventListener('click', closeModal);

  const hint    = overlay.querySelector('#pwd-hint');
  const saveBtn = overlay.querySelector('#btn-save-pwd');

  function validate() {
    const np = overlay.querySelector('#pwd-new').value;
    const cp = overlay.querySelector('#pwd-confirm').value;
    if (np.length > 0 && np.length < 6) {
      hint.textContent   = 'At least 6 characters required.';
      hint.style.color   = 'var(--ace3)';
      saveBtn.disabled   = true;
      return;
    }
    if (cp && np !== cp) {
      hint.textContent   = 'Passwords do not match.';
      hint.style.color   = 'var(--ace3)';
      saveBtn.disabled   = true;
      return;
    }
    hint.textContent = '';
    saveBtn.disabled = !(np.length >= 6 && np === cp);
  }

  overlay.querySelector('#pwd-new').addEventListener('input', validate);
  overlay.querySelector('#pwd-confirm').addEventListener('input', validate);
  saveBtn.disabled = true;

  saveBtn.addEventListener('click', async () => {
    const currentPwd = overlay.querySelector('#pwd-current').value;
    const newPwd     = overlay.querySelector('#pwd-new').value;

    if (simpleHash(currentPwd) !== player.passwordHash) {
      hint.textContent = 'Current password is incorrect.';
      hint.style.color = 'var(--ace3)';
      return;
    }

    saveBtn.disabled    = true;
    saveBtn.textContent = 'Saving…';
    try {
      await dbMultiUpdate({ [`players/${creds.uid}/passwordHash`]: simpleHash(newPwd) });
      player.passwordHash = simpleHash(newPwd);
      closeModal();
    } catch (err) {
      console.error('Change password error:', err);
      hint.textContent    = 'Failed to save — try again.';
      hint.style.color    = 'var(--ace3)';
      saveBtn.disabled    = false;
      saveBtn.textContent = 'Save Password';
    }
  });
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

// ─── Nav badges ──────────────────────────────────────────────────────────────

const FEED_LAST_OPEN_KEY    = 'atp_feed_last_open';
const MATCHES_LAST_OPEN_KEY = 'atp_matches_last_open';

function _updateNavBadge(cont, tabId, count) {
  const btn = cont.querySelector(`.nav-item[data-tab="${tabId}"]`);
  if (!btn) return;
  if (btn.classList.contains('active') && tabId === 'feed') {
    localStorage.setItem(FEED_LAST_OPEN_KEY, String(Date.now()));
    count = 0;
  }
  if (btn.classList.contains('active') && tabId === 'matches') {
    localStorage.setItem(MATCHES_LAST_OPEN_KEY, String(Date.now()));
    count = 0;
  }
  let badge = btn.querySelector('.nav-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'nav-badge';
    btn.appendChild(badge);
  }
  badge.textContent = count > 9 ? '9+' : String(count);
  badge.style.display = count > 0 ? '' : 'none';
}

function _startBadgeListeners(cont, uid, sid, leagueIds) {
  // Feed badge: count activity items newer than last feed open
  dbListen(dbRef('activity'), (actObj) => {
    if (!actObj) { _updateNavBadge(cont, 'feed', 0); return; }
    const lastOpen = parseInt(localStorage.getItem(FEED_LAST_OPEN_KEY) || '0', 10);
    const count = Object.values(actObj).filter(item => (item.ts || 0) > lastOpen).length;
    _updateNavBadge(cont, 'feed', count);
  });

  // Matches badge: scheduled challenges received after the matches tab was last opened
  const pendingByLeague = {};
  for (const lid of leagueIds) {
    dbListen(sRef(sid, lid, 'matches'), (matchesObj) => {
      const lastOpen = parseInt(localStorage.getItem(MATCHES_LAST_OPEN_KEY) || '0', 10);
      pendingByLeague[lid] = !matchesObj ? 0 :
        Object.values(matchesObj).filter(m =>
          m.status === 'scheduled' && m.playerB === uid && (m.proposedAt || 0) > lastOpen
        ).length;
      const total = Object.values(pendingByLeague).reduce((a, b) => a + b, 0);
      _updateNavBadge(cont, 'matches', total);
    });
  }
}

// ─── What's New ───────────────────────────────────────────────────────────────

const SEEN_VERSION_KEY = 'atp_seen_version';

function _checkWhatsNew() {
  const lastSeen = localStorage.getItem(SEEN_VERSION_KEY);

  // First install — silently mark as seen, no modal
  if (!lastSeen) {
    localStorage.setItem(SEEN_VERSION_KEY, APP_VERSION);
    return;
  }

  // Already up to date
  if (lastSeen === APP_VERSION) return;

  const newEntries = changesSince(lastSeen);
  if (!newEntries.length) {
    localStorage.setItem(SEEN_VERSION_KEY, APP_VERSION);
    return;
  }

  // Small delay so the app shell is visually settled before the modal appears
  setTimeout(() => _showWhatsNewModal(newEntries), 600);
}

function _showWhatsNewModal(entries) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-sheet" style="max-height:85dvh;overflow-y:auto;">
      <div class="modal-handle"></div>

      <div style="display:flex;align-items:center;gap:10px;padding-bottom:16px;
        border-bottom:1px solid var(--border);margin-bottom:20px;">
        <div style="font-size:22px;">🎾</div>
        <div>
          <div style="font-size:17px;font-weight:700;">What's New</div>
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--text3);
            letter-spacing:.5px;margin-top:2px;">v${APP_VERSION}</div>
        </div>
      </div>

      ${entries.map(entry => `
        <div style="margin-bottom:20px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
            <span style="font-family:var(--font-mono);font-size:11px;font-weight:700;
              background:var(--ace-bg,rgba(184,64,8,.08));color:var(--ace);
              padding:2px 8px;border-radius:20px;">v${escHtml(entry.version)}</span>
            <span style="font-size:11px;color:var(--text3);">${escHtml(entry.date)}</span>
          </div>
          <ul style="margin:0;padding:0 0 0 16px;display:flex;flex-direction:column;gap:6px;">
            ${entry.changes.map(c => `
              <li style="font-size:13px;line-height:1.5;color:var(--text);">${escHtml(c)}</li>
            `).join('')}
          </ul>
        </div>
      `).join('')}

      <div style="padding-top:4px;padding-bottom:8px;">
        <button class="btn btn-primary" id="btn-whats-new-close">Got it</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  function close() {
    localStorage.setItem(SEEN_VERSION_KEY, APP_VERSION);
    overlay.remove();
  }

  overlay.querySelector('#btn-whats-new-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

// ─── Walkthrough tour ────────────────────────────────────────────────────────

const WALKTHROUGH_KEY = 'atp_walkthrough_done';

const WALKTHROUGH_STEPS = [
  {
    tabId: null,
    icon: '🎾',
    title: 'Welcome to ATP Greenwich',
    body: 'This quick guide walks you through the app. You can skip it at any time.',
  },
  {
    tabId: null,
    icon: '📅',
    title: 'Season & League',
    body: 'The two selectors in the top bar let you switch between seasons and leagues. Make sure your league is selected.',
  },
  {
    tabId: 'feed',
    icon: '📰',
    title: 'Feed',
    body: 'The Feed shows recent match results and group activity. React with emojis on each result.',
  },
  {
    tabId: 'matches',
    icon: '🎯',
    title: 'Matches',
    body: 'Challenge other players, accept challenges, enter results, and view your full match history here.',
  },
  {
    tabId: 'standings',
    icon: '🏆',
    title: 'Standings',
    body: 'Track your position in the group stage and your ELO rating. Tap any player to see their detailed stats.',
  },
  {
    tabId: 'bracket',
    icon: '🌟',
    title: 'Bracket & Profile',
    body: 'Once the group stage ends, the knockout bracket opens here. In Profile you can change your avatar and password.',
  },
];

function _checkWalkthrough(navigateFn) {
  if (localStorage.getItem(WALKTHROUGH_KEY)) return;
  setTimeout(() => {
    if (document.querySelector('.modal-overlay')) {
      const check = setInterval(() => {
        if (!document.querySelector('.modal-overlay')) {
          clearInterval(check);
          setTimeout(() => _showWalkthroughModal(navigateFn), 400);
        }
      }, 300);
    } else {
      _showWalkthroughModal(navigateFn);
    }
  }, 900);
}

function _showWalkthroughModal(navigateFn) {
  let step = 0;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  function dismiss() {
    localStorage.setItem(WALKTHROUGH_KEY, '1');
    overlay.remove();
  }

  function render() {
    const s = WALKTHROUGH_STEPS[step];
    if (s.tabId && typeof navigateFn === 'function') navigateFn(s.tabId);
    const isLast = step === WALKTHROUGH_STEPS.length - 1;
    const dots = WALKTHROUGH_STEPS.map((_, i) =>
      `<span style="width:6px;height:6px;border-radius:50%;display:inline-block;
        background:${i === step ? 'var(--ace)' : 'var(--border)'};"></span>`
    ).join('');

    overlay.innerHTML = `
      <div class="modal-sheet" style="padding-bottom:calc(env(safe-area-inset-bottom,0px) + 16px);">
        <div class="modal-handle"></div>

        <div style="display:flex;align-items:center;justify-content:space-between;
          margin-bottom:20px;">
          <div style="display:flex;gap:5px;align-items:center;">${dots}</div>
          <button id="btn-tour-dismiss" style="background:none;border:none;cursor:pointer;
            font-size:12px;color:var(--text3);padding:4px 0;text-decoration:underline;">
            Don't show again
          </button>
        </div>

        <div style="text-align:center;padding:8px 0 28px;">
          <div style="font-size:44px;margin-bottom:14px;">${s.icon}</div>
          <div style="font-size:18px;font-weight:700;margin-bottom:10px;line-height:1.3;">${s.title}</div>
          <div style="font-size:14px;line-height:1.65;color:var(--text2);">${s.body}</div>
        </div>

        <button class="btn btn-primary" id="btn-tour-next">
          ${isLast ? 'Done' : 'Next →'}
        </button>
      </div>
    `;

    overlay.querySelector('#btn-tour-next').addEventListener('click', () => {
      if (isLast) { dismiss(); } else { step++; render(); }
    });
    overlay.querySelector('#btn-tour-dismiss').addEventListener('click', dismiss);
  }

  render();
  document.body.appendChild(overlay);
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
  return `<div style="width:${sz}px;height:${sz}px;border-radius:50%;overflow:hidden;
    display:flex;align-items:center;justify-content:center;background:#f0ebe2;flex-shrink:0;">
    <svg width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${sz}" height="${sz}" rx="${sz / 2}" fill="#f0ebe2"/>
      <circle cx="${sz / 2}" cy="${sz * 0.38}" r="${sz * 0.18}" fill="#c8bfb0"/>
      <ellipse cx="${sz / 2}" cy="${sz * 0.75}" rx="${sz * 0.27}" ry="${sz * 0.16}" fill="#c8bfb0"/>
    </svg>
  </div>`;
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
