// src/player/standings.js — League table, group stage points, and ELO rankings

import { dbGet, dbRef, dbListen, pRef, sRef } from '@shared/firebase.js';
import { escHtml } from '@shared/utils.js';
import { buildLeagueTable, calculateGroupPoints } from '@shared/scoring.js';
import { avatarToSvg } from '@player/avatars.js';

const BASE = import.meta.env.BASE_URL;

// ─── Main entry point ─────────────────────────────────────────────────────────

export function renderStandingsTab(el, player, creds) {
  el.innerHTML = `<div style="padding:24px;text-align:center;">
    <div class="spinner" style="margin:0 auto 12px;"></div>
    <p class="t-small t-muted">Loading standings…</p>
  </div>`;

  let unsub       = null;
  let cancelled   = false;
  const membersCache = {};

  (async () => {
    const [allSeasons, allPlayers] = await Promise.all([
      dbGet(dbRef('seasons')),
      dbGet(pRef()),
    ]);
    if (cancelled) return;
    if (!allSeasons || !allPlayers) { _renderEmpty(el); return; }

    const seasonOrder = Object.keys(allSeasons).sort((a, b) =>
      (allSeasons[b].createdAt || 0) - (allSeasons[a].createdAt || 0)
    );
    if (!seasonOrder.length) { _renderEmpty(el); return; }

    const storedSid  = localStorage.getItem('atp_active_season');
    const sid        = (storedSid && allSeasons[storedSid]) ? storedSid : seasonOrder[0];
    if (!storedSid || storedSid !== sid) localStorage.setItem('atp_active_season', sid);
    const leaguesMap = allSeasons[sid]?.leagues || {};
    const leagueList = Object.entries(leaguesMap).map(([lid, l]) => ({
      lid, name: l.name || lid,
      groupStageConfig: l.groupStageConfig || {},
      pointsConfig:     l.pointsConfig     || {},
    }));
    if (!leagueList.length) { _renderEmpty(el); return; }

    // Find player's home league
    let myLid = null;
    for (const { lid } of leagueList) {
      const m = await dbGet(sRef(sid, lid, 'members/' + creds.uid));
      if (cancelled) return;
      if (m !== null) { myLid = lid; break; }
    }
    const prefLid   = localStorage.getItem('atp_active_lid');
    let activeLid = (prefLid && leagueList.find(l => l.lid === prefLid))
      ? prefLid
      : (myLid || leagueList[0]?.lid);
    if (!activeLid) { _renderEmpty(el); return; }

    function listenForLeague(lid) {
      if (unsub) { unsub(); unsub = null; }
      const ctx = leagueList.find(l => l.lid === lid);
      if (!ctx) return;

      const gsStatus = ctx.groupStageConfig.status;

      function applyMatches(matchesObj) {
        if (cancelled) return;
        const allMatches = matchesObj || {};
        const memberUids = Object.keys(membersCache[lid] || {});
        const table      = buildLeagueTable(allMatches, memberUids);
        if (gsStatus === 'active' || gsStatus === 'closed') {
          for (const row of table) {
            row.groupPoints = calculateGroupPoints(allMatches, row.uid, ctx.pointsConfig);
          }
          table.sort((a, b) => {
            if (b.groupPoints !== a.groupPoints) return b.groupPoints - a.groupPoints;
            return b.standing.gameDiff - a.standing.gameDiff;
          });
          let rank = 1;
          for (let i = 0; i < table.length; i++) {
            if (i > 0 && table[i].groupPoints !== table[i - 1].groupPoints) rank = i + 1;
            table[i].rank = rank;
          }
        }
        const mount = el.querySelector('#standings-mount');
        if (!mount) return;
        _renderLeagueTable(mount, table, allPlayers, allMatches, creds.uid, ctx.name, ctx.groupStageConfig, ctx.pointsConfig);
        mount.querySelectorAll('[data-view-player]').forEach(row =>
          row.addEventListener('click', () =>
            _showStandingModal(row.dataset.viewPlayer, allPlayers, allMatches, creds.uid)
          )
        );
      }

      dbGet(sRef(sid, lid, 'members')).then(membersObj => {
        if (cancelled) return;
        membersCache[lid] = membersObj || {};
        if (gsStatus === 'closed') {
          // Group stage closed — load snapshot once, don't live-listen to avoid bracket matches affecting standings
          dbGet(sRef(sid, lid, 'matches')).then(applyMatches);
        } else {
          unsub = dbListen(sRef(sid, lid, 'matches'), applyMatches);
        }
      });
    }

    el.innerHTML = `
      <div style="padding-bottom:24px;">
        <div id="standings-mount">
          <div style="padding:16px;text-align:center;">
            <div class="spinner" style="margin:0 auto;"></div>
          </div>
        </div>
      </div>
    `;

    listenForLeague(activeLid);
  })().catch(() => _renderEmpty(el));

  return () => { cancelled = true; if (unsub) { unsub(); unsub = null; } };
}

// ─── League table ─────────────────────────────────────────────────────────────

function _renderLeagueTable(el, table, allPlayers, allMatches, myUid, leagueName, gs, pointsCfg) {
  if (!table || table.length === 0) {
    el.innerHTML = `
      <div style="text-align:center;padding:24px 0;">
        <img src="${BASE}images/atp-empty-standings.png"
          style="width:140px;height:auto;opacity:.8;margin:0 auto 12px;">
        <p class="t-small t-muted">No confirmed matches in ${escHtml(leagueName)} yet.</p>
      </div>
    `;
    return;
  }

  gs       = gs       || {};
  pointsCfg = pointsCfg || {};
  const gsStatus    = gs.status || 'pending';
  const showGsPts   = gsStatus === 'active' || gsStatus === 'closed';
  const qualifyPts  = gs.qualifyPoints ?? 6;
  const deadline    = gs.deadline;
  const pts         = pointsCfg;

  const deadlineStr = deadline
    ? new Date(deadline).toLocaleDateString('en-GB', { day:'numeric', month:'short' })
    : null;

  el.innerHTML = `
    <div style="margin-bottom:8px;display:flex;align-items:center;gap:8px;">
      ${gsStatus === 'active'  ? `<span class="badge" style="font-size:10px;background:rgba(0,160,80,.12);color:#007a3d;">Group Stage</span>` : ''}
      ${gsStatus === 'closed'  ? `<span class="badge badge-muted" style="font-size:10px;">Stage Closed</span>` : ''}
      ${deadlineStr && gsStatus === 'active' ? `<span style="font-size:10px;color:var(--text3);font-family:var(--font-mono);">Deadline ${deadlineStr}</span>` : ''}
    </div>

    ${showGsPts ? _rulesAccordion(pts, qualifyPts, deadlineStr) : ''}

    ${table.map(row => {
      const p         = allPlayers[row.uid] || { name: 'Unknown', alias: row.uid };
      const isMe      = row.uid === myUid;
      const s         = row.standing;
      const gp        = row.groupPoints ?? null;
      const qualifies = gp !== null && gp >= qualifyPts;
      const elo       = allPlayers[row.uid]?.eloRating;
      const wl        = `${s.matchesWon}W–${s.matchesLost ?? (s.matchesPlayed - s.matchesWon)}L`;
      const stats     = _computePlayerStats(allMatches, row.uid);
      return `
        <div data-view-player="${row.uid}" style="display:flex;align-items:center;gap:8px;
          padding:10px 12px;cursor:pointer;
          background:${isMe ? 'rgba(184,64,8,.06)' : 'var(--surface)'};
          border:1px solid ${isMe ? 'var(--ace)' : 'var(--border)'};
          border-radius:var(--radius);margin-bottom:6px;">
          <div style="font-family:var(--font-mono);font-size:12px;color:var(--text3);
            width:20px;text-align:center;flex-shrink:0;">${row.rank}</div>
          ${p.avatarId ? avatarToSvg(p.avatarId, 28) : _defaultAv(28)}
          <span style="font-size:13px;font-weight:${isMe ? '700' : '400'};
            flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
            color:${isMe ? 'var(--ace)' : 'var(--text)'};">
            ${isMe ? 'You' : escHtml(p.alias || p.name)}
          </span>
          <span style="font-family:var(--font-mono);font-size:11px;font-weight:600;
            color:var(--text3);flex-shrink:0;">${wl}</span>
          ${(stats.missed + stats.forfeited) > 0 ? `
            <span style="font-family:var(--font-mono);font-size:10px;color:var(--ace3);
              flex-shrink:0;" title="Missed + forfeited matches">${stats.missed + stats.forfeited}M</span>
          ` : ''}
          ${elo ? `
            <span style="font-family:var(--font-mono);font-size:13px;font-weight:700;
              color:${isMe ? 'var(--ace)' : 'var(--text)'};flex-shrink:0;">${elo}</span>
          ` : `<div style="width:30px;flex-shrink:0;"></div>`}
          ${showGsPts ? `
            <span style="font-family:var(--font-mono);font-size:14px;font-weight:800;
              color:${qualifies ? 'var(--ace2)' : 'var(--text)'};flex-shrink:0;
              min-width:36px;text-align:right;">${gp ?? 0} pts</span>
          ` : ''}
        </div>
      `;
    }).join('')}
  `;
}

function _rulesAccordion(pts, qualifyPts, deadlineStr) {
  const played       = pts.played        ?? 1;
  const wonBonus     = pts.wonBonus      ?? 2;
  const missed       = pts.missed        ?? -1;
  const forfeitLoser = pts.forfeitLoser  ?? -1;
  const forfeitWinner = pts.forfeitWinner ?? 2;

  function row(label, val) {
    const color = val > 0 ? 'var(--ace2)' : val < 0 ? 'var(--ace3)' : 'var(--text3)';
    return `<div style="display:flex;justify-content:space-between;padding:3px 0;">
      <span style="color:var(--text2);">${label}</span>
      <span style="font-family:var(--font-mono);font-weight:700;color:${color};">
        ${val > 0 ? '+' : ''}${val}
      </span>
    </div>`;
  }

  return `
    <details style="margin-bottom:10px;border-radius:8px;overflow:hidden;">
      <summary style="background:var(--surface2);padding:10px 12px;font-size:12px;
        font-weight:700;cursor:pointer;list-style:none;display:flex;
        justify-content:space-between;align-items:center;">
        <span>ℹ How scoring works</span>
        <span style="color:var(--text3);font-size:10px;">tap to expand</span>
      </summary>
      <div style="background:var(--surface2);padding:10px 12px 12px;
        border-top:1px solid var(--border);font-size:12px;">
        ${row('Played a match', played)}
        ${row('Won a match', played + wonBonus)}
        ${row('Lost a match', played)}
        ${row('Missed a pre-arranged match', missed)}
        ${row('Forfeit (you)', forfeitLoser)}
        ${row('Opponent forfeits', forfeitWinner)}
        <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);
          font-size:11px;color:var(--text3);">
          Top players with <strong style="color:var(--text);">≥ ${qualifyPts} pts</strong>
          advance to the bracket.
          ${deadlineStr ? `&nbsp;·&nbsp;Deadline: <strong style="color:var(--text);">${deadlineStr}</strong>.` : ''}
        </div>
      </div>
    </details>
  `;
}

// ─── Player stats modal ───────────────────────────────────────────────────────

function _computePlayerStats(allMatches, uid) {
  let missed = 0, forfeited = 0, opponentForfeited = 0, won = 0, played = 0;
  for (const m of Object.values(allMatches || {})) {
    if (m.playerA !== uid && m.playerB !== uid) continue;
    if (m.forfeited) {
      if (m.forfeited === uid) forfeited++;
      else opponentForfeited++;
    } else if (m.deadlinePenaltyApplied) {
      missed++;
    }
    if (m.status === 'confirmed') {
      played++;
      if (m.result?.winner === uid) won++;
    }
  }
  return { missed, forfeited, opponentForfeited, won, played };
}

function _showStandingModal(uid, allPlayers, allMatches, myUid) {
  const p     = allPlayers[uid] || { name: 'Player', alias: uid };
  const name  = p.alias || p.name;
  const av    = p.avatarId ? avatarToSvg(p.avatarId, 48) : _defaultAv(48);
  const elo   = p.eloRating || 1000;
  const stats = _computePlayerStats(allMatches, uid);

  const matches = Object.entries(allMatches || {})
    .filter(([, m]) => (m.playerA === uid || m.playerB === uid) && m.status === 'confirmed')
    .sort(([, a], [, b]) => (b.confirmedAt || 0) - (a.confirmedAt || 0))
    .slice(0, 20);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-sheet" style="max-height:90dvh;overflow-y:auto;">
      <div class="modal-handle"></div>
      <div style="display:flex;align-items:center;gap:12px;padding-bottom:16px;
        border-bottom:1px solid var(--border);margin-bottom:16px;">
        ${av}
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:15px;">${escHtml(uid === myUid ? 'You' : name)}</div>
          ${elo ? `<div style="font-family:var(--font-mono);font-size:12px;color:var(--text3);">ELO ${elo}</div>` : ''}
        </div>
        <button id="btn-close-sm" style="background:none;border:none;cursor:pointer;padding:4px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
          </svg>
        </button>
      </div>

      <!-- Stats row -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px;">
        ${_statCell('Played', stats.played, 'var(--text2)')}
        ${_statCell('Won', stats.won, stats.won > 0 ? 'var(--ace2)' : 'var(--text3)')}
        ${_statCell('Lost', stats.played - stats.won, 'var(--text3)')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;">
        ${_statCell('Missed', stats.missed, stats.missed > 0 ? 'var(--ace3)' : 'var(--text3)')}
        ${_statCell('Forfeit', stats.forfeited, stats.forfeited > 0 ? 'var(--ace3)' : 'var(--text3)')}
        ${_statCell('Opp.Forf', stats.opponentForfeited, stats.opponentForfeited > 0 ? 'var(--ace2)' : 'var(--text3)')}
      </div>

      <!-- Recent confirmed matches -->
      ${matches.length === 0
        ? `<p class="t-small t-muted" style="text-align:center;padding:16px 0;">No confirmed matches yet.</p>`
        : matches.map(([, m]) => {
            const opUid    = m.playerA === uid ? m.playerB : m.playerA;
            const op       = allPlayers[opUid] || { name: 'Player', alias: opUid };
            const matchWon = m.result?.winner === uid;
            const score    = _formatSetsSimple(m.result);
            const when     = _timeAgoSimple(m.confirmedAt);
            const eloDelta = m.eloDeltas?.[uid];
            return `
              <div style="display:flex;align-items:center;gap:8px;padding:10px 0;
                border-bottom:1px solid var(--border);">
                <span class="badge ${matchWon ? 'badge-teal' : 'badge-muted'}"
                  style="font-size:10px;min-width:32px;text-align:center;">
                  ${matchWon ? 'Win' : 'Loss'}
                </span>
                <span style="flex:1;font-size:12px;min-width:0;overflow:hidden;
                  text-overflow:ellipsis;white-space:nowrap;">
                  ${escHtml(uid === myUid ? 'You' : name)}
                  <span style="color:var(--text3);"> vs </span>
                  ${escHtml(opUid === myUid ? 'You' : (op.alias || op.name))}
                </span>
                <span style="font-family:var(--font-mono);font-size:11px;color:var(--text3);">${score}</span>
                ${eloDelta !== undefined ? `
                  <span style="font-family:var(--font-mono);font-size:10px;font-weight:700;
                    color:${eloDelta >= 0 ? 'var(--ace2)' : 'var(--ace3)'};">
                    ${eloDelta >= 0 ? '+' : ''}${eloDelta}
                  </span>
                ` : ''}
                <span style="font-size:10px;color:var(--text3);flex-shrink:0;">${when}</span>
              </div>
            `;
          }).join('')}
      <div style="padding-bottom:8px;"></div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.querySelector('#btn-close-sm').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

function _statCell(label, value, color) {
  return `
    <div style="background:var(--surface2);border-radius:8px;padding:10px;text-align:center;">
      <div style="font-family:var(--font-mono);font-size:20px;font-weight:800;color:${color};">
        ${value}
      </div>
      <div style="font-size:10px;color:var(--text3);margin-top:2px;">${label}</div>
    </div>
  `;
}

function _formatSetsSimple(result) {
  if (!result) return '—';
  if (result.score) return `${result.score.a}–${result.score.b}`;
  if (!result.sets?.length) return '—';
  return result.sets.map(s => `${s.a}-${s.b}`).join(', ');
}

function _timeAgoSimple(ts) {
  if (!ts) return '';
  const diff  = Date.now() - ts;
  const days  = Math.floor(diff / 86400000);
  const hours = Math.floor(diff / 3600000);
  const mins  = Math.floor(diff / 60000);
  if (mins < 1)   return 'now';
  if (mins < 60)  return `${mins}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7)   return `${days}d`;
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
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
