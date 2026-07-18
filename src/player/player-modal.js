// src/player/player-modal.js — reusable player profile modal
// Triggered by clicking a player name/avatar anywhere in the player app.

import { escHtml } from '@shared/utils.js';
import { eloTierLabel } from '@shared/elo.js';
import { avatarToSvg } from '@player/avatars.js';

export function showPlayerModal(targetUid, allPlayers, allMatches, myUid) {
  document.querySelector('.modal-overlay.player-profile-modal')?.remove();

  const p    = allPlayers[targetUid] || {};
  const isMe = targetUid === myUid;
  const elo  = p.eloRating || 1000;
  const tier = eloTierLabel(elo);

  const stats = _computeStats(allMatches, targetUid);

  const confirmed = Object.entries(allMatches || {})
    .filter(([, m]) => (m.playerA === targetUid || m.playerB === targetUid) && m.status === 'confirmed')
    .sort(([, a], [, b]) => (b.confirmedAt || 0) - (a.confirmedAt || 0))
    .slice(0, 20);

  const historyHtml = confirmed.length === 0
    ? `<p class="t-small t-muted" style="text-align:center;padding:16px 0;">No confirmed matches yet.</p>`
    : confirmed.map(([, m]) => {
        const opUid    = m.playerA === targetUid ? m.playerB : m.playerA;
        const op       = allPlayers[opUid] || {};
        const won      = m.result?.winner === targetUid;
        const score    = _formatScore(m.result);
        const when     = _timeAgo(m.confirmedAt);
        const eloDelta = m.eloDeltas?.[targetUid];
        return `
          <div style="display:flex;align-items:center;gap:8px;padding:10px 0;
            border-bottom:1px solid var(--border);">
            <span class="badge ${won ? 'badge-teal' : 'badge-muted'}"
              style="font-size:10px;min-width:32px;text-align:center;">
              ${won ? 'Win' : 'Loss'}
            </span>
            <span style="flex:1;font-size:12px;min-width:0;overflow:hidden;
              text-overflow:ellipsis;white-space:nowrap;">
              ${escHtml(targetUid === myUid ? 'You' : (p.alias || p.name || targetUid))}
              <span style="color:var(--text3);"> vs </span>
              ${escHtml(opUid === myUid ? 'You' : (op.alias || op.name || opUid))}
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
      }).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay player-profile-modal';
  overlay.innerHTML = `
    <div class="modal-sheet" style="max-height:90dvh;overflow-y:auto;overscroll-behavior:contain;">
      <div class="modal-handle"></div>
      <div style="display:flex;align-items:center;gap:14px;padding-bottom:16px;
        border-bottom:1px solid var(--border);margin-bottom:16px;">
        ${avatarToSvg(p.avatarId || null, 52)}
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:16px;line-height:1.2;">
            ${isMe ? 'You' : escHtml(p.alias || p.name || targetUid)}
          </div>
          ${p.alias && p.name && !isMe
            ? `<div class="t-small t-muted">${escHtml(p.name)}</div>` : ''}
          <div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
            <span style="font-family:var(--font-mono);font-size:16px;font-weight:700;">${elo}</span>
            <span class="badge badge-ace" style="font-size:10px;">${escHtml(tier)}</span>
          </div>
        </div>
        <button id="btn-close-player-modal" style="background:none;border:none;cursor:pointer;padding:4px;flex-shrink:0;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
          </svg>
        </button>
      </div>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px;">
        ${_statCell('Played', stats.played, 'var(--text2)')}
        ${_statCell('Won',    stats.won,    stats.won > 0 ? 'var(--ace2)' : 'var(--text3)')}
        ${_statCell('Lost',   stats.played - stats.won, 'var(--text3)')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;">
        ${_statCell('Missed',    stats.missed,           stats.missed           > 0 ? 'var(--ace3)' : 'var(--text3)')}
        ${_statCell('Forfeit',   stats.forfeited,        stats.forfeited        > 0 ? 'var(--ace3)' : 'var(--text3)')}
        ${_statCell('Opp.Forf', stats.opponentForfeited, stats.opponentForfeited > 0 ? 'var(--ace2)' : 'var(--text3)')}
      </div>

      <div class="t-label t-muted" style="margin-bottom:6px;">
        Match History${confirmed.length === 20 ? ' (last 20)' : ''}
      </div>
      ${historyHtml}
      <div style="padding-bottom:8px;"></div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.querySelector('#btn-close-player-modal').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

function _computeStats(allMatches, uid) {
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

function _formatScore(result) {
  if (!result) return '—';
  if (result.score) return `${result.score.a}–${result.score.b}`;
  if (!result.sets?.length) return '—';
  return result.sets.map(s => `${s.a}-${s.b}`).join(', ');
}

function _timeAgo(ts) {
  if (!ts) return '';
  const diff  = Date.now() - ts;
  const days  = Math.floor(diff / 86400000);
  const hours = Math.floor(diff / 3600000);
  const mins  = Math.floor(diff / 60000);
  if (mins  < 1)  return 'now';
  if (mins  < 60) return `${mins}m`;
  if (hours < 24) return `${hours}h`;
  if (days  < 7)  return `${days}d`;
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
