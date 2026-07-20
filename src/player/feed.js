// src/player/feed.js — Phase 5: Activity feed
// Shows recent confirmed match results across the league, with ELO changes.

import { dbGet, dbRef, dbListen, dbSet, dbRemove, pRef, sRef } from '@shared/firebase.js';
import { escHtml } from '@shared/utils.js';
import { fmtTime } from '@shared/tz.js';
import { avatarToSvg } from '@player/avatars.js';
import { showNotifSettings } from '@player/notif-settings.js';

const BASE = import.meta.env.BASE_URL;

// ─── Main entry point ─────────────────────────────────────────────────────────

const REACTIONS = ['👏', '🔥', '🎾', '💪'];

export function renderFeedTab(el, player, creds) {
  el.innerHTML = `<div style="padding:24px;text-align:center;">
    <div class="spinner" style="margin:0 auto 12px;"></div>
    <p class="t-small t-muted">Loading feed…</p>
  </div>`;

  const unsubs = [];
  let cancelled = false;

  (async () => {
    const [allSeasons, allPlayers] = await Promise.all([
      dbGet(dbRef('seasons')),
      dbGet(pRef()),
    ]);
    if (cancelled) return;
    if (!allSeasons || !allPlayers) { _renderNoLeague(el); return; }

    const seasonOrder = Object.keys(allSeasons).sort((a, b) =>
      (allSeasons[b].createdAt || 0) - (allSeasons[a].createdAt || 0)
    );
    if (!seasonOrder.length) { _renderNoLeague(el); return; }

    const storedSid = localStorage.getItem('atp_active_season');
    const sid       = (storedSid && allSeasons[storedSid]) ? storedSid : seasonOrder[0];
    if (!storedSid || storedSid !== sid) localStorage.setItem('atp_active_season', sid);
    const leaguesMap = allSeasons[sid]?.leagues || {};

    // All leagues in this tournament (for feed content)
    const allTournamentLeagues = Object.entries(leaguesMap).map(([lid, l]) => ({
      lid, name: l.name || lid,
    }));

    // Player's own leagues (membership check — must be in at least one)
    const myLeagues = [];
    for (const { lid, name } of allTournamentLeagues) {
      const m = await dbGet(sRef(sid, lid, 'members/' + creds.uid));
      if (cancelled) return;
      if (m !== null) myLeagues.push({ lid, name });
    }
    if (myLeagues.length === 0) { _renderNoLeague(el); return; }

    // Feed league prefs: JSON array of included lids, or absent = all tournament leagues
    function _getIncludedLids() {
      const stored = localStorage.getItem('atp_feed_leagues');
      if (!stored) return allTournamentLeagues.map(l => l.lid);
      try {
        const parsed = JSON.parse(stored);
        const valid  = parsed.filter(lid => allTournamentLeagues.find(l => l.lid === lid));
        return valid.length ? valid : allTournamentLeagues.map(l => l.lid);
      } catch { return allTournamentLeagues.map(l => l.lid); }
    }

    const matchesByLeague = {};
    let activityObj = {};

    function renderAll() {
      if (cancelled) return;
      const included = _getIncludedLids();

      // Confirmed match items from matches node
      const matchItems = [];
      for (const [lid, matchesObj] of Object.entries(matchesByLeague)) {
        if (!included.includes(lid)) continue;
        for (const [mid, m] of Object.entries(matchesObj)) {
          if (m.status === 'confirmed' && m.result) {
            matchItems.push({ type: 'match_confirmed', ts: m.confirmedAt || 0, mid, lid, ...m });
          }
        }
      }

      // Activity items from global activity node (skip match_confirmed — already in matchItems)
      const actItems = Object.entries(activityObj)
        .filter(([, item]) =>
          item.type !== 'match_confirmed' &&
          (!item.sid || item.sid === sid)
        )
        .map(([aid, item]) => ({ ...item, aid }));

      const allItems = [...matchItems, ...actItems]
        .sort((a, b) => (b.ts || 0) - (a.ts || 0))
        .slice(0, 50);

      _renderFeed(el, allItems, creds.uid, allPlayers || {}, allTournamentLeagues, sid, () => {
        _showFeedSettings(allTournamentLeagues, renderAll, creds.uid);
      });
    }

    for (const { lid } of allTournamentLeagues) {
      unsubs.push(dbListen(sRef(sid, lid, 'matches'), (matchesObj) => {
        matchesByLeague[lid] = matchesObj || {};
        renderAll();
      }));
    }

    // Global activity listener
    unsubs.push(dbListen(dbRef('activity'), (obj) => {
      activityObj = obj || {};
      renderAll();
    }));
  })().catch(() => _renderError(el));

  return () => { cancelled = true; unsubs.forEach(u => u()); };
}

// ─── Feed renderer ────────────────────────────────────────────────────────────

function _renderFeed(el, allItems, myUid, allPlayers, myLeagues, sid, onGear) {
  const headerHtml = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:0 0 8px;">
      <span class="t-label t-muted">
        ${allItems.length > 0 ? `${allItems.length} result${allItems.length !== 1 ? 's' : ''}` : ''}
      </span>
      <button id="feed-gear-btn" title="Feed settings"
        style="background:none;border:none;cursor:pointer;padding:4px;color:var(--text3);
          display:flex;align-items:center;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06
            a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09
            A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83
            l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09
            A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83
            l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09
            a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83
            l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09
            a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
    </div>
  `;

  if (allItems.length === 0) {
    el.innerHTML = `
      <div>
        ${headerHtml}
        <div style="text-align:center;padding:40px 16px 24px;">
          <img src="${BASE}images/atp-empty-matches.png"
            style="width:160px;height:auto;opacity:.85;margin:0 auto 16px;">
          <div class="empty-state-title">No results yet</div>
          <p class="t-small t-muted" style="max-width:240px;margin:0 auto;">
            Confirmed match results will appear here.
          </p>
        </div>
      </div>
    `;
    el.querySelector('#feed-gear-btn')?.addEventListener('click', onGear);
    return;
  }

  const matchItems = allItems.filter(i => i.type === 'match_confirmed');

  el.innerHTML = `
    <div style="padding-bottom:24px;">
      ${headerHtml}
      ${allItems.map(item =>
        item.type === 'match_confirmed'
          ? _feedItem(item, myUid, allPlayers, myLeagues)
          : _activityCard(item, allPlayers, myLeagues)
      ).join('')}
    </div>
  `;

  el.querySelector('#feed-gear-btn')?.addEventListener('click', onGear);

  // Reactions (match items only)
  matchItems.forEach(m => _wireReactions(el, m.mid, myUid, sid, m.lid));

  // Player clicks
  el.querySelectorAll('[data-player-click]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      _showPlayerHistory(btn.dataset.playerClick, allPlayers, myUid, matchItems);
    });
  });

  // Photo zoom (match items only)
  el.querySelectorAll('[data-photo-click]').forEach(img => {
    img.addEventListener('click', () => _showPhotoModal(img.dataset.photoClick));
  });
}

// ─── Feed settings modal ─────────────────────────────────────────────────────

function _showFeedSettings(allLeagues, onClose, uid) {
  const included = (() => {
    const stored = localStorage.getItem('atp_feed_leagues');
    if (!stored) return allLeagues.map(l => l.lid);
    try {
      const parsed = JSON.parse(stored);
      const valid  = parsed.filter(lid => allLeagues.find(l => l.lid === lid));
      return valid.length ? valid : allLeagues.map(l => l.lid);
    } catch { return allLeagues.map(l => l.lid); }
  })();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-sheet" style="max-height:80dvh;overflow-y:auto;">
      <div class="modal-handle"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;
        padding-bottom:16px;border-bottom:1px solid var(--border);margin-bottom:16px;">
        <span style="font-size:15px;font-weight:700;">Feed settings</span>
        <button id="feed-settings-close" style="background:none;border:none;cursor:pointer;
          padding:4px;color:var(--text3);">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
          </svg>
        </button>
      </div>
      <p class="t-small t-muted" style="margin:0 0 12px;">Choose which leagues to show in your feed.</p>
      <div id="feed-league-checks" style="display:flex;flex-direction:column;gap:8px;">
        ${allLeagues.map(l => `
          <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;
            background:var(--surface2);border-radius:8px;cursor:pointer;">
            <input type="checkbox" data-lid="${escHtml(l.lid)}"
              ${included.includes(l.lid) ? 'checked' : ''}
              style="width:16px;height:16px;accent-color:var(--ace);cursor:pointer;">
            <span style="font-size:13px;">${escHtml(l.name)}</span>
          </label>
        `).join('')}
      </div>
      <button id="feed-settings-save" class="btn btn-primary"
        style="width:100%;margin-top:20px;">Save</button>

      <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border);">
        <p class="t-label t-muted" style="margin:0 0 8px;">Notifications</p>
        <button id="feed-notif-settings-btn"
          style="display:flex;align-items:center;justify-content:space-between;
            width:100%;background:var(--surface2);border:none;border-radius:8px;
            padding:10px 12px;cursor:pointer;">
          <span style="font-size:13px;font-weight:600;">Push notification preferences</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </button>
      </div>
      <div style="padding-bottom:8px;"></div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => { overlay.remove(); onClose(); };

  overlay.querySelector('#feed-settings-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  overlay.querySelector('#feed-settings-save').addEventListener('click', () => {
    const checked = [...overlay.querySelectorAll('[data-lid]:checked')].map(c => c.dataset.lid);
    const save    = checked.length ? checked : allLeagues.map(l => l.lid);
    localStorage.setItem('atp_feed_leagues', JSON.stringify(save));
    close();
  });

  overlay.querySelector('#feed-notif-settings-btn').addEventListener('click', () => {
    overlay.remove();
    showNotifSettings(uid);
  });
}

// ─── Feed item ────────────────────────────────────────────────────────────────

function _feedItem(match, myUid, allPlayers, leagueList) {
  const leagueName = leagueList ? leagueList.find(l => l.lid === match.lid)?.name : null;
  const pA    = allPlayers[match.playerA] || { name: 'Player A', alias: match.playerA };
  const pB    = allPlayers[match.playerB] || { name: 'Player B', alias: match.playerB };
  const avA   = pA.avatarId ? avatarToSvg(pA.avatarId, 32) : _defaultAv(32);
  const avB   = pB.avatarId ? avatarToSvg(pB.avatarId, 32) : _defaultAv(32);

  const isMeA    = match.playerA === myUid;
  const isMeB    = match.playerB === myUid;
  const iMePlayed = isMeA || isMeB;

  const winnerUid = match.result.winner;
  const score     = _formatSets(match.result);
  const when      = _timeAgo(match.confirmedAt);

  const deltaA = match.eloDeltas?.[match.playerA];
  const deltaB = match.eloDeltas?.[match.playerB];

  const nameA = pA.alias || pA.name;
  const nameB = pB.alias || pB.name;

  const winnerIsA = winnerUid === match.playerA;

  return `
    <div class="card" style="margin-bottom:10px;padding:14px 16px;
      ${iMePlayed ? 'border-left:3px solid var(--ace);' : ''}">
      <!-- Players and score -->
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:0;">
          <button data-player-click="${escHtml(match.playerA)}"
            style="background:none;border:none;padding:0;cursor:pointer;flex-shrink:0;
              display:inline-flex;">${avA}</button>
          <button data-player-click="${escHtml(match.playerA)}"
            style="background:none;border:none;padding:0;cursor:pointer;min-width:0;">
            <span style="font-size:13px;font-weight:${winnerIsA ? '700' : '400'};
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;">
              ${escHtml(isMeA ? 'You' : nameA)}
            </span>
          </button>
          ${winnerIsA ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="var(--ace2)" stroke-width="3" stroke-linecap="round" style="flex-shrink:0;">
            <polyline points="20 6 9 17 4 12"/></svg>` : ''}
        </div>
        <div style="font-family:var(--font-mono);font-size:11px;color:var(--text3);
          flex-shrink:0;text-align:center;min-width:52px;">
          ${score}
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:0;
          justify-content:flex-end;">
          ${!winnerIsA ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="var(--ace2)" stroke-width="3" stroke-linecap="round" style="flex-shrink:0;">
            <polyline points="20 6 9 17 4 12"/></svg>` : ''}
          <button data-player-click="${escHtml(match.playerB)}"
            style="background:none;border:none;padding:0;cursor:pointer;min-width:0;text-align:right;">
            <span style="font-size:13px;font-weight:${!winnerIsA ? '700' : '400'};
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;">
              ${escHtml(isMeB ? 'You' : nameB)}
            </span>
          </button>
          <button data-player-click="${escHtml(match.playerB)}"
            style="background:none;border:none;padding:0;cursor:pointer;flex-shrink:0;
              display:inline-flex;">${avB}</button>
        </div>
      </div>

      <!-- ELO changes + time -->
      <div style="display:flex;align-items:center;justify-content:space-between;
        gap:8px;flex-wrap:wrap;margin-bottom:10px;">
        <div style="display:flex;gap:12px;">
          ${deltaA !== undefined ? `
            <span style="font-family:var(--font-mono);font-size:10px;
              color:${deltaA >= 0 ? 'var(--ace2)' : 'var(--ace3)'};">
              ${escHtml(isMeA ? 'You' : nameA)} ${deltaA >= 0 ? '+' : ''}${deltaA}
            </span>
          ` : ''}
          ${deltaB !== undefined ? `
            <span style="font-family:var(--font-mono);font-size:10px;
              color:${deltaB >= 0 ? 'var(--ace2)' : 'var(--ace3)'};">
              ${escHtml(isMeB ? 'You' : nameB)} ${deltaB >= 0 ? '+' : ''}${deltaB}
            </span>
          ` : ''}
        </div>
        ${leagueName ? `<span class="badge badge-muted" style="font-size:9px;">${escHtml(leagueName)}</span>` : ''}
        <span class="t-label t-muted" style="font-size:10px;">${escHtml(when)}</span>
      </div>

      <!-- Match photo thumbnail -->
      ${match.photoUrl ? `
        <div style="margin-bottom:10px;">
          <img src="${escHtml(match.photoUrl)}" loading="lazy"
            data-photo-click="${escHtml(match.photoUrl)}"
            style="width:100%;max-height:200px;object-fit:cover;border-radius:8px;
              border:1px solid var(--border);cursor:pointer;display:block;">
        </div>
      ` : ''}

      <!-- Reactions -->
      <div class="feed-reactions" data-mid="${escHtml(match.mid)}"
        style="display:flex;gap:6px;flex-wrap:wrap;">
        ${REACTIONS.map(emoji => `
          <button class="reaction-btn" data-emoji="${emoji}" data-mid="${escHtml(match.mid)}"
            style="background:var(--surface2);border:1px solid var(--border);border-radius:20px;
              padding:3px 9px;font-size:14px;cursor:pointer;display:flex;align-items:center;
              gap:4px;transition:background 0.15s,border-color 0.15s;">
            <span>${emoji}</span>
            <span class="reaction-count" style="font-size:11px;font-family:var(--font-mono);
              color:var(--text3);min-width:8px;"></span>
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

// ─── Activity card (non-match events) ────────────────────────────────────────

function _activityCard(item, allPlayers, myLeagues) {
  function playerName(uid) {
    if (!uid) return 'Unknown';
    const p = allPlayers[uid] || {};
    return escHtml(p.alias || p.username || uid);
  }
  function playerAv(uid, sz = 28) {
    if (!uid) return _defaultAv(sz);
    const p = allPlayers[uid] || {};
    return p.avatarId ? avatarToSvg(p.avatarId, sz) : _defaultAv(sz);
  }
  const time = _timeAgo(item.ts);

  let icon, title, sub, avatarUid;

  switch (item.type) {
    case 'match_proposed': {
      const league = myLeagues?.find(l => l.lid === item.lid);
      const whenStr = item.scheduledAt ? fmtTime(item.scheduledAt) : null;
      icon = '⚔️';
      avatarUid = item.challengerId;
      title = `${playerName(item.challengerId)} sent a challenge`;
      const _leaguePart = league ? ' · ' + escHtml(league.name) : '';
      const _whenPart = whenStr ? ' · 📅 ' + whenStr : '';
      sub = item.opponentId
        ? `vs ${playerName(item.opponentId)}${_leaguePart}${_whenPart}`
        : `Open challenge${_leaguePart}${_whenPart}`;
      break;
    }
    case 'bracket_advance': {
      icon = '🏆';
      avatarUid = item.playerId;
      title = `${playerName(item.playerId)} advanced in the bracket`;
      sub = item.round ? `Round ${escHtml(item.round)}` : '';
      break;
    }
    case 'fixtures_released': {
      const league = myLeagues?.find(l => l.lid === item.lid);
      icon = '📅';
      avatarUid = null;
      title = 'New fixtures published';
      sub = [league ? escHtml(league.name) : '', item.fixtureCount ? `${item.fixtureCount} matches` : ''].filter(Boolean).join(' · ');
      break;
    }
    case 'joined_league': {
      const league = myLeagues?.find(l => l.lid === item.lid);
      icon = '🎾';
      avatarUid = item.uid;
      title = `${playerName(item.uid)} joined ${league ? escHtml(league.name) : 'a league'}`;
      sub = '';
      break;
    }
    case 'new_player': {
      icon = '👋';
      avatarUid = item.uid;
      title = `${playerName(item.uid)} joined the tournament`;
      sub = '';
      break;
    }
    case 'profile_change': {
      icon = '✏️';
      avatarUid = item.uid;
      const what = item.what === 'alias' ? 'alias' : 'avatar';
      title = `${playerName(item.uid)} updated their ${what}`;
      sub = item.what === 'alias' && item.newVal ? `→ "${escHtml(item.newVal)}"` : '';
      break;
    }
    case 'match_rescheduled': {
      const league = myLeagues?.find(l => l.lid === item.lid);
      const other = item.changedBy === item.playerA ? item.playerB : item.playerA;
      icon = '🔄';
      avatarUid = item.changedBy;
      title = `${playerName(item.changedBy)} rescheduled a match`;
      const parts = [];
      if (other) parts.push(`vs ${playerName(other)}`);
      if (league) parts.push(escHtml(league.name));
      if (item.newScheduledAt) parts.push('📅 ' + fmtTime(item.newScheduledAt));
      sub = parts.join(' · ');
      break;
    }
    case 'daily_schedule': {
      const league = myLeagues?.find(l => l.lid === item.lid);
      icon = '📅';
      avatarUid = null;
      title = `Today's matches${league ? ' · ' + escHtml(league.name) : ''}`;
      sub = (item.matches || []).map(m => {
        const nameA = playerName(m.playerA);
        const nameB = m.playerB ? playerName(m.playerB) : '?';
        const when  = m.scheduledAt ? fmtTime(m.scheduledAt) : '';
        return `${nameA} vs ${nameB}${when ? ' at ' + when : ''}`;
      }).join('<br>');
      break;
    }
    case 'standings_update': {
      const league = myLeagues?.find(l => l.lid === item.lid);
      icon = '📊';
      avatarUid = null;
      title = `End of day standings${league ? ' · ' + escHtml(league.name) : ''}`;
      const medals  = ['🥇', '🥈', '🥉'];
      const label   = s => `<span style="font-size:10px;font-weight:600;letter-spacing:.06em;color:var(--text3);text-transform:uppercase;">${s}</span>`;
      const parts   = [];
      const resultList = (item.results || []).filter(r => r.winner);
      if (resultList.length) {
        parts.push(label('Results'));
        for (const r of resultList) {
          const score = _formatSets(r);
          parts.push(`✅ <b>${escHtml(playerName(r.winner))}</b> def. ${escHtml(playerName(r.loser))}${score && score !== '—' ? ' &nbsp;·&nbsp; ' + escHtml(score) : ''}`);
        }
      }
      const standingList = (item.standings || []);
      if (standingList.length) {
        if (parts.length) parts.push('');
        parts.push(label('Standings'));
        standingList.forEach((s, i) => {
          const elo = s.elo != null ? ` &nbsp;·&nbsp; ${s.elo}` : '';
          parts.push(`${i + 1}. ${medals[i] || ''} <b>${escHtml(playerName(s.uid))}</b> — ${s.wins}W ${s.losses}L${elo}`);
        });
      }
      sub = parts.join('<br>');
      break;
    }
    default:
      return '';
  }

  const avHtml = avatarUid
    ? `<button data-player-click="${escHtml(avatarUid)}"
        style="background:none;border:none;padding:0;cursor:pointer;flex-shrink:0;display:inline-flex;">
        ${playerAv(avatarUid, 30)}
      </button>`
    : `<span style="font-size:22px;flex-shrink:0;">${icon}</span>`;

  return `
    <div data-feed-activity="1" style="background:var(--surface2);border:1px solid var(--border);
      border-radius:var(--radius);padding:11px 14px;margin-bottom:10px;
      display:flex;align-items:center;gap:11px;">
      ${avHtml}
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:500;color:var(--text);line-height:1.4;">${title}</div>
        ${sub ? `<div style="font-size:11px;color:var(--text3);margin-top:2px;">${sub}</div>` : ''}
        <div style="font-size:10px;color:var(--text3);margin-top:3px;
          font-family:var(--font-mono);">${escHtml(time)}</div>
      </div>
      <div style="font-size:18px;flex-shrink:0;">${icon}</div>
    </div>
  `;
}

// ─── Reactions ───────────────────────────────────────────────────────────────

function _wireReactions(feedEl, mid, myUid, sid, lid) {
  const reactionRef = sRef(sid, lid, 'reactions/' + mid);

  // Load current reaction counts + highlight mine
  dbGet(reactionRef).then(reactionsObj => {
    _applyReactionState(feedEl, mid, reactionsObj || {}, myUid);
  }).catch(() => {});

  // Wire button clicks
  feedEl.querySelectorAll(`.reaction-btn[data-mid="${mid}"]`).forEach(btn => {
    btn.addEventListener('click', async () => {
      const emoji = btn.dataset.emoji;
      const myReactionRef = sRef(sid, lid, `reactions/${mid}/${myUid}`);
      try {
        const current = await dbGet(myReactionRef);
        if (current === emoji) {
          // Toggle off
          await dbRemove(myReactionRef);
        } else {
          // Set or change reaction
          await dbSet(myReactionRef, emoji);
        }
        // Refresh display
        const updated = await dbGet(reactionRef);
        _applyReactionState(feedEl, mid, updated || {}, myUid);
      } catch { /* silent fail — reactions are non-critical */ }
    });
  });
}

function _applyReactionState(feedEl, mid, reactionsObj, myUid) {
  // Count each emoji
  const counts = {};
  let myEmoji = null;
  for (const [uid, emoji] of Object.entries(reactionsObj)) {
    counts[emoji] = (counts[emoji] || 0) + 1;
    if (uid === myUid) myEmoji = emoji;
  }

  feedEl.querySelectorAll(`.reaction-btn[data-mid="${mid}"]`).forEach(btn => {
    const emoji = btn.dataset.emoji;
    const count = counts[emoji] || 0;
    const isMe  = myEmoji === emoji;

    btn.querySelector('.reaction-count').textContent = count > 0 ? String(count) : '';
    btn.style.background     = isMe ? 'var(--ace-bg)'  : 'var(--surface2)';
    btn.style.borderColor    = isMe ? 'var(--ace)'     : 'var(--border)';
    btn.style.color          = isMe ? 'var(--ace)'     : 'inherit';
  });
}

// ─── Player history modal ─────────────────────────────────────────────────────

function _showPlayerHistory(uid, allPlayers, myUid, confirmedMatches) {
  const p    = allPlayers[uid] || { name: 'Player', alias: uid };
  const name = p.alias || p.name;
  const av   = p.avatarId ? avatarToSvg(p.avatarId, 48) : _defaultAv(48);
  const elo  = p.eloRating || 1000;

  const matches = confirmedMatches
    .filter(m => m.playerA === uid || m.playerB === uid)
    .slice(0, 30);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-sheet" style="max-height:90dvh;overflow-y:auto;">
      <div class="modal-handle"></div>
      <div style="display:flex;align-items:center;gap:12px;padding-bottom:16px;
        border-bottom:1px solid var(--border);margin-bottom:16px;">
        ${av}
        <div>
          <div style="font-weight:700;font-size:15px;">${escHtml(uid === myUid ? 'You' : name)}</div>
          <div style="font-family:var(--font-mono);font-size:12px;color:var(--text3);">
            ELO ${elo}
          </div>
        </div>
        <button style="margin-left:auto;background:none;border:none;cursor:pointer;
          padding:4px;" id="btn-close-hist">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
          </svg>
        </button>
      </div>
      ${matches.length === 0 ? `
        <p class="t-small t-muted" style="text-align:center;padding:16px 0;">
          No confirmed matches yet.
        </p>
      ` : matches.map(m => {
        const isMeA   = m.playerA === myUid;
        const opUid2  = m.playerA === uid ? m.playerB : m.playerA;
        const op2     = allPlayers[opUid2] || { name: 'Player', alias: opUid2 };
        const pIsA    = m.playerA === uid;
        const score   = _formatSets(m.result);
        const when    = _timeAgo(m.confirmedAt);
        const winnerIsPlayer = m.result?.winner === uid;
        return `
          <div class="card" style="margin-bottom:8px;padding:12px 14px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
              <span style="font-size:12px;font-weight:700;">${escHtml(pIsA ? (uid === myUid ? 'You' : name) : (op2.alias || op2.name))}</span>
              <span style="font-family:var(--font-mono);font-size:12px;color:var(--text3);margin:0 4px;">${score}</span>
              <span style="font-size:12px;">${escHtml(pIsA ? (op2.alias || op2.name) : (uid === myUid ? 'You' : name))}</span>
              <span class="badge ${winnerIsPlayer ? 'badge-teal' : 'badge-muted'}"
                style="margin-left:auto;font-size:10px;">${winnerIsPlayer ? 'Win' : 'Loss'}</span>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
              <span class="t-label t-muted" style="font-size:10px;">${escHtml(when)}</span>
              ${m.photoUrl
                ? `<img src="${escHtml(m.photoUrl)}" loading="lazy"
                    data-photo-click="${escHtml(m.photoUrl)}"
                    style="width:80px;height:52px;object-fit:cover;border-radius:6px;
                      border:1px solid var(--border);cursor:pointer;">`
                : ''}
            </div>
          </div>
        `;
      }).join('')}
      <div style="padding-bottom:8px;"></div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.querySelector('#btn-close-hist').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelectorAll('[data-photo-click]').forEach(img => {
    img.addEventListener('click', () => _showPhotoModal(img.dataset.photoClick));
  });
}

function _showPhotoModal(url) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.92);
    display:flex;align-items:center;justify-content:center;cursor:zoom-out;`;
  overlay.innerHTML = `<img src="${escHtml(url)}"
    style="max-width:100%;max-height:100%;object-fit:contain;border-radius:4px;">`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', () => overlay.remove());
}

// ─── Empty states ─────────────────────────────────────────────────────────────

function _renderNoLeague(el) {
  el.innerHTML = `
    <div class="empty-state" style="padding-top:40px;">
      <div class="empty-state-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
      </div>
      <div class="empty-state-title">Activity Feed</div>
      <p class="t-small t-muted" style="max-width:240px;">
        Match results and league news will appear here once you're assigned to a league.
      </p>
    </div>
  `;
}

function _renderError(el) {
  el.innerHTML = `
    <div class="empty-state" style="padding-top:40px;">
      <div class="empty-state-title">Could not load feed</div>
      <p class="t-small t-muted">Check your connection and refresh.</p>
    </div>
  `;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _formatSets(result) {
  if (!result) return '—';
  if (result.score) return `${result.score.a}–${result.score.b}`;
  if (!result.sets?.length) return '—';
  return result.sets.map(s => `${s.a}-${s.b}`).join(', ');
}

function _timeAgo(ts) {
  if (!ts) return '';
  const diff  = Date.now() - ts;
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7)   return `${days}d ago`;
  const d = new Date(ts);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function _defaultAv(sz) {
  return `<div style="width:${sz}px;height:${sz}px;border-radius:50%;background:#f0ebe2;
    flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;">
    <svg width="${Math.round(sz * .6)}" height="${Math.round(sz * .6)}" viewBox="0 0 24 24"
      fill="none" stroke="#c8bfb0" stroke-width="1.5" stroke-linecap="round">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  </div>`;
}
