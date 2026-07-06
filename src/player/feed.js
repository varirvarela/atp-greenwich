// src/player/feed.js — Phase 5: Activity feed
// Shows recent confirmed match results across the league, with ELO changes.

import { dbGet, dbRef, dbListen, dbSet, dbRemove, pRef, sRef } from '@shared/firebase.js';
import { escHtml } from '@shared/utils.js';
import { eloTierLabel } from '@shared/elo.js';
import { avatarToSvg } from '@player/avatars.js';

const BASE = import.meta.env.BASE_URL;

// ─── Main entry point ─────────────────────────────────────────────────────────

const REACTIONS = ['👏', '🔥', '🎾', '💪'];

export function renderFeedTab(el, player, creds) {
  el.innerHTML = `<div style="padding:24px;text-align:center;">
    <div class="spinner" style="margin:0 auto 12px;"></div>
    <p class="t-small t-muted">Loading feed…</p>
  </div>`;

  const unsubs = [];
  let cancelled  = false;
  let activeLeague = 'all'; // local filter state

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

    const sid        = seasonOrder[0];
    const leaguesMap = allSeasons[sid]?.leagues || {};
    const leagueList = Object.entries(leaguesMap).map(([lid, l]) => ({
      lid, name: l.name || lid,
    }));
    if (!leagueList.length) { _renderNoLeague(el); return; }

    const matchesByLeague = {};

    function renderAll() {
      if (cancelled) return;
      const allConfirmed = [];
      for (const [lid, matchesObj] of Object.entries(matchesByLeague)) {
        if (activeLeague !== 'all' && activeLeague !== lid) continue;
        for (const [mid, m] of Object.entries(matchesObj)) {
          if (m.status === 'confirmed' && m.result) {
            allConfirmed.push({ mid, lid, ...m });
          }
        }
      }
      allConfirmed.sort((a, b) => (b.confirmedAt || 0) - (a.confirmedAt || 0));
      _renderFeed(el, allConfirmed, creds.uid, allPlayers || {}, leagueList, sid,
        activeLeague, (newLeague) => { activeLeague = newLeague; renderAll(); });
    }

    for (const { lid } of leagueList) {
      unsubs.push(dbListen(sRef(sid, lid, 'matches'), (matchesObj) => {
        matchesByLeague[lid] = matchesObj || {};
        renderAll();
      }));
    }
  })().catch(() => _renderError(el));

  return () => { cancelled = true; unsubs.forEach(u => u()); };
}

// ─── Feed renderer ────────────────────────────────────────────────────────────

function _renderFeed(el, confirmed, myUid, allPlayers, leagueList, sid, activeLeague, onFilterChange) {
  confirmed = confirmed.slice(0, 50);
  const showLeagueFilter = leagueList.length > 1;

  if (confirmed.length === 0) {
    el.innerHTML = `
      <div>
        ${showLeagueFilter ? `
          <div style="display:flex;gap:6px;overflow-x:auto;padding:8px 0 4px;">
            <button class="btn btn-sm ${activeLeague === 'all' ? 'btn-primary' : 'btn-surface'}"
              data-feed-league="all" style="white-space:nowrap;flex-shrink:0;">All Leagues</button>
            ${leagueList.map(l => `
              <button class="btn btn-sm ${activeLeague === l.lid ? 'btn-primary' : 'btn-surface'}"
                data-feed-league="${escHtml(l.lid)}"
                style="white-space:nowrap;flex-shrink:0;">${escHtml(l.name)}</button>
            `).join('')}
          </div>
        ` : ''}
        <div style="text-align:center;padding:40px 16px 24px;">
          <img src="${BASE}images/atp-empty-matches.png"
            style="width:160px;height:auto;margin-bottom:16px;opacity:.85;margin:0 auto 16px;">
          <div class="empty-state-title">No results yet</div>
          <p class="t-small t-muted" style="max-width:240px;margin:0 auto;">
            Confirmed match results will appear here.
          </p>
        </div>
      </div>
    `;
    // Wire filter even on empty state
    if (showLeagueFilter) {
      el.querySelectorAll('[data-feed-league]').forEach(btn => {
        btn.addEventListener('click', () => onFilterChange(btn.dataset.feedLeague));
      });
    }
    return;
  }

  el.innerHTML = `
    <div style="padding-bottom:24px;">
      ${showLeagueFilter ? `
        <div style="display:flex;gap:6px;overflow-x:auto;padding:8px 0 4px;margin-bottom:4px;">
          <button class="btn btn-sm ${activeLeague === 'all' ? 'btn-primary' : 'btn-surface'}"
            data-feed-league="all" style="white-space:nowrap;flex-shrink:0;">All Leagues</button>
          ${leagueList.map(l => `
            <button class="btn btn-sm ${activeLeague === l.lid ? 'btn-primary' : 'btn-surface'}"
              data-feed-league="${escHtml(l.lid)}"
              style="white-space:nowrap;flex-shrink:0;">${escHtml(l.name)}</button>
          `).join('')}
        </div>
      ` : ''}
      <div style="display:flex;justify-content:flex-end;padding:4px 0 8px;">
        <span class="t-label t-muted">${confirmed.length} result${confirmed.length !== 1 ? 's' : ''}</span>
      </div>
      ${confirmed.map(m => _feedItem(m, myUid, allPlayers, leagueList)).join('')}
    </div>
  `;

  // League filter
  if (showLeagueFilter) {
    el.querySelectorAll('[data-feed-league]').forEach(btn => {
      btn.addEventListener('click', () => onFilterChange(btn.dataset.feedLeague));
    });
  }

  // Reactions
  confirmed.forEach(m => _wireReactions(el, m.mid, myUid, sid, m.lid));

  // Player clicks
  el.querySelectorAll('[data-player-click]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      _showPlayerHistory(btn.dataset.playerClick, allPlayers, myUid, confirmed);
    });
  });

  // Photo zoom
  el.querySelectorAll('[data-photo-click]').forEach(img => {
    img.addEventListener('click', () => _showPhotoModal(img.dataset.photoClick));
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
