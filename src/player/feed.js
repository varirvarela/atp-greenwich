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

  (async () => {
    const sid = await dbGet(dbRef('config/defaultSeason'));
    if (!sid) { _renderNoLeague(el); return; }

    const leagues = await dbGet(sRef(sid, null, 'leagues'));
    if (!leagues) { _renderNoLeague(el); return; }

    let leagueCtx = null;
    for (const [lid, league] of Object.entries(leagues)) {
      const member = await dbGet(sRef(sid, lid, 'members/' + creds.uid));
      if (member !== null) {
        leagueCtx = { sid, lid, leagueName: league.name || 'League' };
        break;
      }
    }

    if (!leagueCtx) { _renderNoLeague(el); return; }

    const { sid: resolvedSid, lid, leagueName } = leagueCtx;
    const allPlayers = await dbGet(pRef());

    unsubs.push(dbListen(sRef(resolvedSid, lid, 'matches'), (matchesObj) => {
      _renderFeed(el, matchesObj || {}, creds.uid, allPlayers || {}, leagueName,
                  resolvedSid, lid);
    }));
  })().catch(() => _renderError(el));

  return () => { unsubs.forEach(u => u()); };
}

// ─── Feed renderer ────────────────────────────────────────────────────────────

function _renderFeed(el, matchesObj, myUid, allPlayers, leagueName, sid, lid) {
  const confirmed = Object.entries(matchesObj)
    .map(([mid, m]) => ({ mid, ...m }))
    .filter(m => m.status === 'confirmed' && m.result)
    .sort((a, b) => (b.confirmedAt || 0) - (a.confirmedAt || 0))
    .slice(0, 30);

  if (confirmed.length === 0) {
    el.innerHTML = `
      <div style="text-align:center;padding:40px 16px 24px;">
        <img src="${BASE}images/atp-empty-matches.png"
          style="width:160px;height:auto;margin-bottom:16px;opacity:.85;">
        <div class="empty-state-title">No results yet</div>
        <p class="t-small t-muted" style="max-width:240px;margin:0 auto;">
          Confirmed match results in ${escHtml(leagueName)} will appear here.
        </p>
      </div>
    `;
    return;
  }

  el.innerHTML = `
    <div style="padding-bottom:24px;">
      <div style="display:flex;justify-content:space-between;align-items:center;
        padding:16px 0 12px;">
        <div class="badge badge-teal" style="font-size:11px;">${escHtml(leagueName)}</div>
        <span class="t-label t-muted">${confirmed.length} result${confirmed.length > 1 ? 's' : ''}</span>
      </div>
      ${confirmed.map(m => _feedItem(m, myUid, allPlayers)).join('')}
    </div>
  `;

  // Wire reaction buttons after rendering
  confirmed.forEach(m => _wireReactions(el, m.mid, myUid, sid, lid));
}

// ─── Feed item ────────────────────────────────────────────────────────────────

function _feedItem(match, myUid, allPlayers) {
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
          ${avA}
          <span style="font-size:13px;font-weight:${winnerIsA ? '700' : '400'};
            white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${escHtml(isMeA ? 'You' : nameA)}
          </span>
          ${winnerIsA ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="var(--ace2)" stroke-width="3" stroke-linecap="round">
            <polyline points="20 6 9 17 4 12"/></svg>` : ''}
        </div>
        <div style="font-family:var(--font-mono);font-size:11px;color:var(--text3);
          flex-shrink:0;text-align:center;min-width:52px;">
          ${score}
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:0;
          justify-content:flex-end;">
          ${!winnerIsA ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="var(--ace2)" stroke-width="3" stroke-linecap="round">
            <polyline points="20 6 9 17 4 12"/></svg>` : ''}
          <span style="font-size:13px;font-weight:${!winnerIsA ? '700' : '400'};
            white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right;">
            ${escHtml(isMeB ? 'You' : nameB)}
          </span>
          ${avB}
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
        <span class="t-label t-muted" style="font-size:10px;">${escHtml(when)}</span>
      </div>

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
