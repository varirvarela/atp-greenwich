// src/player/standings.js — League table, group stage points, and ELO rankings

import { dbGet, dbRef, dbListen, pRef, sRef } from '@shared/firebase.js';
import { escHtml } from '@shared/utils.js';
import { eloTierLabel } from '@shared/elo.js';
import { buildLeagueTable, calculateGroupPoints } from '@shared/scoring.js';
import { avatarToSvg } from '@player/avatars.js';
import { showPlayerModal } from '@player/player-modal.js';

const BASE = import.meta.env.BASE_URL;

// ─── Main entry point ─────────────────────────────────────────────────────────

export function renderStandingsTab(el, player, creds) {
  el.innerHTML = `<div style="padding:24px;text-align:center;">
    <div class="spinner" style="margin:0 auto 12px;"></div>
    <p class="t-small t-muted">Loading standings…</p>
  </div>`;

  let unsub    = null;
  let cancelled = false;

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

    const sid        = seasonOrder[0];
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
    let activeLid = myLid || leagueList[0].lid;

    function listenForLeague(lid) {
      if (unsub) { unsub(); unsub = null; }
      const ctx = leagueList.find(l => l.lid === lid);
      if (!ctx) return;

      dbGet(sRef(sid, lid, 'members')).then(membersObj => {
        if (cancelled) return;
        const memberUids = Object.keys(membersObj || {});
        unsub = dbListen(sRef(sid, lid, 'matches'), matchesObj => {
          const allMatches = matchesObj || {};
          const table      = buildLeagueTable(allMatches, memberUids);
          const gsStatus   = ctx.groupStageConfig.status;
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
          _renderLeagueTable(mount, table, allPlayers, creds.uid, ctx.name, ctx.groupStageConfig, ctx.pointsConfig);
          mount.querySelectorAll('[data-view-player]').forEach(row =>
            row.addEventListener('click', () =>
              showPlayerModal(row.dataset.viewPlayer, allPlayers, allMatches, creds.uid)
            )
          );
        });
      });
    }

    el.innerHTML = `
      <div style="padding-bottom:24px;">
        ${leagueList.length > 1 ? `
          <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;margin-bottom:12px;">
            ${leagueList.map(l => `
              <button class="btn btn-sm ${l.lid === activeLid ? 'btn-primary' : 'btn-surface'}"
                data-lid="${escHtml(l.lid)}"
                style="white-space:nowrap;flex-shrink:0;">
                ${escHtml(l.name)}${l.lid === myLid ? ' ★' : ''}
              </button>
            `).join('')}
          </div>
        ` : ''}
        <div id="standings-mount">
          <div style="padding:16px;text-align:center;">
            <div class="spinner" style="margin:0 auto;"></div>
          </div>
        </div>
      </div>
    `;

    el.querySelectorAll('[data-lid]').forEach(btn => {
      btn.addEventListener('click', () => {
        activeLid = btn.dataset.lid;
        el.querySelectorAll('[data-lid]').forEach(b => {
          b.className = `btn btn-sm ${b.dataset.lid === activeLid ? 'btn-primary' : 'btn-surface'}`;
          b.style.whiteSpace = 'nowrap'; b.style.flexShrink = '0';
        });
        listenForLeague(activeLid);
      });
    });

    listenForLeague(activeLid);
  })().catch(() => _renderEmpty(el));

  return () => { cancelled = true; if (unsub) { unsub(); unsub = null; } };
}

// ─── League table ─────────────────────────────────────────────────────────────

function _renderLeagueTable(el, table, allPlayers, myUid, leagueName, gs, pointsCfg) {
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

  gs       = gs       || {};
  pointsCfg = pointsCfg || {};
  const gsStatus    = gs.status || 'pending';
  const showGsPts   = gsStatus === 'active' || gsStatus === 'closed';
  const qualifyPts  = gs.qualifyPoints ?? 6;
  const deadline    = gs.deadline;
  const pts         = pointsCfg;

  function _diff(n) { return `${n > 0 ? '+' : ''}${n}`; }
  function _diffColor(n) {
    return n > 0 ? 'var(--ace2)' : n < 0 ? 'var(--ace3)' : 'var(--text3)';
  }

  const deadlineStr = deadline
    ? new Date(deadline).toLocaleDateString('en-GB', { day:'numeric', month:'short' })
    : null;

  el.innerHTML = `
    <div style="margin-bottom:8px;display:flex;align-items:center;gap:8px;">
      <span class="badge badge-teal" style="font-size:11px;">${escHtml(leagueName)}</span>
      ${gsStatus === 'active'  ? `<span class="badge" style="font-size:10px;background:rgba(0,160,80,.12);color:#007a3d;">Group Stage</span>` : ''}
      ${gsStatus === 'closed'  ? `<span class="badge badge-muted" style="font-size:10px;">Stage Closed</span>` : ''}
      ${deadlineStr && gsStatus === 'active' ? `<span style="font-size:10px;color:var(--text3);font-family:var(--font-mono);">Deadline ${deadlineStr}</span>` : ''}
    </div>

    ${showGsPts ? _rulesAccordion(pts, qualifyPts, deadlineStr) : ''}

    <div class="card" style="padding:0;overflow:hidden;">
      ${table.map((row, i) => {
        const p      = allPlayers[row.uid] || { name: 'Unknown', alias: row.uid };
        const isMe   = row.uid === myUid;
        const s      = row.standing;
        const gp     = row.groupPoints ?? null;
        const qualifies = gp !== null && gp >= qualifyPts;
        const isLast = i === table.length - 1;
        const elo = allPlayers[row.uid]?.eloRating;
        const tier = elo ? eloTierLabel(elo) : null;
        return `
          <div data-view-player="${row.uid}" style="padding:10px 12px;cursor:pointer;
            ${isLast ? '' : 'border-bottom:1px solid var(--border);'}
            ${isMe ? 'background:rgba(184,64,8,.06);' : ''}">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
              <div style="font-family:var(--font-mono);font-size:12px;color:var(--text3);
                width:20px;text-align:center;flex-shrink:0;">${row.rank}</div>
              ${p.avatarId ? avatarToSvg(p.avatarId, 28) : _defaultAv(28)}
              <span style="font-size:13px;font-weight:${isMe ? '700' : '400'};
                flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${isMe ? 'You' : escHtml(p.alias || p.name)}
              </span>
              ${showGsPts ? `
                <span style="font-family:var(--font-mono);font-size:15px;font-weight:800;
                  color:${qualifies ? 'var(--ace2)' : 'var(--text)'};flex-shrink:0;">
                  ${gp ?? 0} pts
                </span>
              ` : `
                <span style="font-family:var(--font-mono);font-size:12px;font-weight:700;
                  flex-shrink:0;">${s.matchesWon}W–${s.matchesLost ?? (s.matchesPlayed - s.matchesWon)}L</span>
              `}
              ${elo ? `
                <div style="text-align:right;flex-shrink:0;min-width:52px;">
                  <div style="font-family:var(--font-mono);font-size:13px;font-weight:700;
                    color:${isMe ? 'var(--ace)' : 'var(--text)'};">${elo}</div>
                  ${tier ? `<div style="font-size:9px;color:var(--text3);text-transform:uppercase;
                    letter-spacing:.4px;">${escHtml(tier)}</div>` : ''}
                </div>
              ` : `<div style="width:52px;flex-shrink:0;"></div>`}
            </div>
            <div style="display:flex;gap:12px;padding-left:28px;">
              ${showGsPts ? `
                <span style="font-family:var(--font-mono);font-size:11px;color:var(--text3);">
                  ${s.matchesWon}W–${s.matchesLost ?? (s.matchesPlayed - s.matchesWon)}L
                </span>
              ` : ''}
              <div style="font-family:var(--font-mono);font-size:11px;color:var(--text3);">
                Sets <span style="color:var(--text);">${s.setsWon}–${s.setsLost}</span>
                <span style="color:${_diffColor(s.setDiff)};">(${_diff(s.setDiff)})</span>
              </div>
              <div style="font-family:var(--font-mono);font-size:11px;color:var(--text3);">
                Games <span style="color:var(--text);">${s.gamesWon}–${s.gamesLost}</span>
                <span style="color:${_diffColor(s.gameDiff)};">(${_diff(s.gameDiff)})</span>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
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
