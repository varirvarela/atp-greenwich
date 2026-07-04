// src/player/standings.js — Phase 4: League table and ELO rankings
// League standing is season-scoped; ELO ranking is global across all active players.

import { dbGet, dbRef, dbListen, pRef, sRef } from '@shared/firebase.js';
import { escHtml } from '@shared/utils.js';
import { eloTierLabel } from '@shared/elo.js';
import { buildLeagueTable } from '@shared/scoring.js';
import { avatarToSvg } from '@player/avatars.js';

const BASE = import.meta.env.BASE_URL;

// ─── Main entry point ─────────────────────────────────────────────────────────

export function renderStandingsTab(el, player, creds) {
  el.innerHTML = `<div style="padding:24px;text-align:center;">
    <div class="spinner" style="margin:0 auto 12px;"></div>
    <p class="t-small t-muted">Loading standings…</p>
  </div>`;

  const unsubscribers = [];
  let cancelled = false;

  (async () => {
    const [sid, allPlayers] = await Promise.all([
      dbGet(dbRef('config/defaultSeason')),
      dbGet(pRef()),
    ]);
    if (cancelled) return;

    if (!allPlayers) { _renderEmpty(el); return; }

    // Find player's league
    let leagueCtx = null;
    if (sid) {
      const leagues = await dbGet(sRef(sid, null, 'leagues'));
      if (cancelled) return;
      if (leagues) {
        const myLeagues = [];
        for (const [lid, league] of Object.entries(leagues)) {
          const member = await dbGet(sRef(sid, lid, 'members/' + creds.uid));
          if (cancelled) return;
          if (member !== null) myLeagues.push({ sid, lid, leagueName: league.name || 'League' });
        }
        const prefLid = localStorage.getItem('atp_active_lid');
        leagueCtx = myLeagues.find(l => l.lid === prefLid) || myLeagues[0] || null;
      }
    }

    // Render shell with placeholders
    el.innerHTML = `
      <div style="padding-bottom:24px;">
        <div class="t-label t-muted" style="margin:0 0 8px;">League Table</div>
        <div id="league-table-mount">
          <div style="padding:16px;text-align:center;">
            <div class="spinner" style="margin:0 auto;"></div>
          </div>
        </div>

        <div class="t-label t-muted" style="margin:24px 0 8px;">ELO Rankings</div>
        <div id="elo-rankings-mount"></div>
      </div>
    `;

    // ELO rankings are global and static for this render
    _renderEloRankings(el.querySelector('#elo-rankings-mount'), allPlayers, creds.uid);

    // League table uses real-time listener if player is in a league
    if (leagueCtx) {
      const { sid, lid, leagueName } = leagueCtx;
      const membersObj = await dbGet(sRef(sid, lid, 'members'));
      if (cancelled) return;
      const memberUids = Object.keys(membersObj || {});

      const unsub = dbListen(sRef(sid, lid, 'matches'), (matchesObj) => {
        const table = buildLeagueTable(matchesObj || {}, memberUids);
        _renderLeagueTable(
          el.querySelector('#league-table-mount'),
          table,
          allPlayers,
          creds.uid,
          leagueName
        );
      });
      unsubscribers.push(unsub);
    } else {
      const mount = el.querySelector('#league-table-mount');
      if (mount) {
        mount.innerHTML = `
          <div style="text-align:center;padding:24px 0;">
            <img src="${BASE}images/atp-empty-standings.png"
              style="width:140px;height:auto;opacity:.8;margin-bottom:12px;">
            <p class="t-small t-muted" style="max-width:220px;margin:0 auto;">
              You haven't been assigned to a league yet.
            </p>
          </div>
        `;
      }
    }
  })().catch(() => _renderEmpty(el));

  return () => { cancelled = true; unsubscribers.forEach(fn => fn()); };
}

// ─── League table ─────────────────────────────────────────────────────────────

function _renderLeagueTable(el, table, allPlayers, myUid, leagueName) {
  if (!table || table.length === 0) {
    el.innerHTML = `
      <div style="text-align:center;padding:24px 0;">
        <img src="${BASE}images/atp-empty-standings.png"
          style="width:140px;height:auto;opacity:.8;margin-bottom:12px;">
        <p class="t-small t-muted">No confirmed matches in ${escHtml(leagueName)} yet.</p>
      </div>
    `;
    return;
  }

  function _diff(n) { return `${n > 0 ? '+' : ''}${n}`; }
  function _diffColor(n) {
    return n > 0 ? 'var(--ace2)' : n < 0 ? 'var(--ace3)' : 'var(--text3)';
  }

  el.innerHTML = `
    <div style="margin-bottom:8px;">
      <span class="badge badge-teal" style="font-size:11px;">${escHtml(leagueName)}</span>
    </div>
    <div class="card" style="padding:0;overflow:hidden;">
      ${table.map((row, i) => {
        const p    = allPlayers[row.uid] || { name: 'Unknown', alias: row.uid };
        const isMe = row.uid === myUid;
        const s    = row.standing;
        const isLast = i === table.length - 1;
        return `
          <div style="padding:10px 12px;
            ${isLast ? '' : 'border-bottom:1px solid var(--border);'}
            ${isMe ? 'background:rgba(184,64,8,.06);' : ''}">
            <!-- Row 1: rank + player + W-L -->
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
              <div style="font-family:var(--font-mono);font-size:12px;color:var(--text3);
                width:20px;text-align:center;flex-shrink:0;">${row.rank}</div>
              ${p.avatarId ? avatarToSvg(p.avatarId, 28) : _defaultAv(28)}
              <span style="font-size:13px;font-weight:${isMe ? '700' : '400'};
                flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${isMe ? 'You' : escHtml(p.alias || p.name)}
              </span>
              <span style="font-family:var(--font-mono);font-size:13px;font-weight:700;
                flex-shrink:0;">${s.matchesWon}W–${s.matchesLost ?? (s.matchesPlayed - s.matchesWon)}L</span>
            </div>
            <!-- Row 2: sets + games detail -->
            <div style="display:flex;gap:16px;padding-left:28px;">
              <div style="font-family:var(--font-mono);font-size:11px;color:var(--text3);">
                Sets
                <span style="color:var(--text);">${s.setsWon}–${s.setsLost}</span>
                <span style="color:${_diffColor(s.setDiff)};">(${_diff(s.setDiff)})</span>
              </div>
              <div style="font-family:var(--font-mono);font-size:11px;color:var(--text3);">
                Games
                <span style="color:var(--text);">${s.gamesWon}–${s.gamesLost}</span>
                <span style="color:${_diffColor(s.gameDiff)};">(${_diff(s.gameDiff)})</span>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// ─── ELO rankings ─────────────────────────────────────────────────────────────

function _renderEloRankings(el, allPlayers, myUid) {
  const ranked = Object.entries(allPlayers)
    .filter(([, p]) => p.status === 'active' && p.eloRating)
    .map(([uid, p]) => ({ uid, ...p }))
    .sort((a, b) => b.eloRating - a.eloRating)
    .slice(0, 20);

  if (!ranked.length) {
    el.innerHTML = `<p class="t-small t-muted" style="padding:8px 0;">
      No ranked players yet.</p>`;
    return;
  }

  // Find my position for the "you" highlight
  const myPos = ranked.findIndex(p => p.uid === myUid);

  el.innerHTML = `
    <div class="card" style="padding:0;overflow:hidden;">
      ${ranked.map((p, i) => {
        const isMe   = p.uid === myUid;
        const tier   = eloTierLabel(p.eloRating);
        const isLast = i === ranked.length - 1;
        return `
          <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;
            ${isLast ? '' : 'border-bottom:1px solid var(--border);'}
            ${isMe ? 'background:rgba(184,64,8,.06);' : ''}">
            <div style="font-family:var(--font-mono);font-size:12px;color:var(--text3);
              width:18px;flex-shrink:0;text-align:center;">${i + 1}</div>
            ${p.avatarId ? avatarToSvg(p.avatarId, 30) : _defaultAv(30)}
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:${isMe ? '700' : '400'};
                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${isMe ? 'You' : escHtml(p.alias || p.name)}
              </div>
              <div style="font-size:10px;color:var(--text3);font-family:var(--font-mono);
                text-transform:uppercase;letter-spacing:.5px;">${escHtml(tier)}</div>
            </div>
            <div style="font-family:var(--font-mono);font-size:15px;font-weight:700;
              flex-shrink:0;color:${isMe ? 'var(--ace)' : 'var(--text)'};">
              ${p.eloRating}
            </div>
          </div>
        `;
      }).join('')}
    </div>
    ${myPos === -1 && myUid ? `
      <p class="t-small t-muted" style="text-align:center;padding:8px 0;">
        Your ELO will appear here once your first match is confirmed.
      </p>
    ` : ''}
  `;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _renderEmpty(el) {
  el.innerHTML = `
    <div class="empty-state" style="padding-top:40px;">
      <div class="empty-state-title">No standings yet</div>
      <p class="t-small t-muted">Standings appear once matches are played and confirmed.</p>
    </div>
  `;
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
