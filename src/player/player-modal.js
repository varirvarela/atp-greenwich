// src/player/player-modal.js — reusable player profile modal
// Triggered by clicking a player name/avatar anywhere in the player app.

import { escHtml } from '@shared/utils.js';
import { eloTierLabel } from '@shared/elo.js';
import { avatarToSvg } from '@player/avatars.js';

export function showPlayerModal(targetUid, allPlayers, allMatches, myUid) {
  document.querySelector('.modal-overlay.player-profile-modal')?.remove();

  const p    = allPlayers[targetUid] || {};
  const isMe = targetUid === myUid;

  const confirmed = Object.values(allMatches || {}).filter(m =>
    (m.playerA === targetUid || m.playerB === targetUid) && m.status === 'confirmed'
  ).sort((a, b) => (b.confirmedAt || 0) - (a.confirmedAt || 0));

  const wins   = confirmed.filter(m => m.result?.winner === targetUid).length;
  const losses = confirmed.filter(m => m.result?.loser  === targetUid).length;

  const historyHtml = confirmed.slice(0, 10).map(m => {
    const opUid = m.playerA === targetUid ? m.playerB : m.playerA;
    const op    = allPlayers[opUid] || {};
    const won   = m.result?.winner === targetUid;
    const sets  = m.result?.sets || [];
    const score = sets.map(s => {
      const myScore = m.playerA === targetUid ? s.a : s.b;
      const opScore = m.playerA === targetUid ? s.b : s.a;
      return `${myScore}–${opScore}`;
    }).join(', ');
    const when  = m.confirmedAt
      ? new Date(m.confirmedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
      : '';

    return `
      <div style="display:flex;align-items:center;gap:10px;padding:9px 0;
        border-bottom:1px solid var(--border);">
        <div class="badge ${won ? 'badge-teal' : 'badge-muted'}"
          style="min-width:24px;text-align:center;flex-shrink:0;">${won ? 'W' : 'L'}</div>
        ${avatarToSvg(op.avatarId || null, 26)}
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:${opUid === myUid ? '700' : '400'};
            white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${opUid === myUid ? 'You' : escHtml(op.alias || op.name || opUid)}
          </div>
          <div class="t-small t-muted">${escHtml(score) || '—'}</div>
        </div>
        ${when ? `<div style="font-size:10px;color:var(--text3);flex-shrink:0;">${when}</div>` : ''}
      </div>
    `;
  }).join('');

  const tier = eloTierLabel(p.eloRating || 1000);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay player-profile-modal';
  overlay.innerHTML = `
    <div class="modal-sheet" style="max-height:80vh;overflow-y:auto;overscroll-behavior:contain;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <h2 class="t-h2" style="margin:0;">${isMe ? 'Your Stats' : 'Player'}</h2>
        <button id="btn-close-player-modal" class="btn btn-ghost btn-sm" style="width:auto;padding:4px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div style="display:flex;align-items:center;gap:14px;margin-bottom:20px;">
        ${avatarToSvg(p.avatarId || null, 60)}
        <div>
          <div style="font-weight:700;font-size:17px;line-height:1.2;">
            ${isMe ? 'You' : escHtml(p.alias || p.name || targetUid)}
          </div>
          ${p.alias && p.name && !isMe
            ? `<div class="t-small t-muted">${escHtml(p.name)}</div>` : ''}
          <div style="display:flex;align-items:center;gap:6px;margin-top:5px;">
            <span style="font-family:var(--font-mono);font-size:18px;font-weight:700;">
              ${p.eloRating || 1000}
            </span>
            <span class="badge badge-ace" style="font-size:10px;">${escHtml(tier)}</span>
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:20px;">
        <div style="background:var(--surface2);border-radius:var(--radius);padding:12px 8px;text-align:center;">
          <div style="font-family:var(--font-mono);font-size:22px;font-weight:700;color:var(--ace2);">
            ${wins}
          </div>
          <div class="t-small t-muted">Wins</div>
        </div>
        <div style="background:var(--surface2);border-radius:var(--radius);padding:12px 8px;text-align:center;">
          <div style="font-family:var(--font-mono);font-size:22px;font-weight:700;color:var(--ace3);">
            ${losses}
          </div>
          <div class="t-small t-muted">Losses</div>
        </div>
        <div style="background:var(--surface2);border-radius:var(--radius);padding:12px 8px;text-align:center;">
          <div style="font-family:var(--font-mono);font-size:22px;font-weight:700;">
            ${wins + losses}
          </div>
          <div class="t-small t-muted">Played</div>
        </div>
      </div>

      <div class="t-label t-muted" style="margin-bottom:6px;">
        Match History${confirmed.length > 10 ? ' (last 10)' : ''}
      </div>
      ${confirmed.length === 0
        ? `<div style="text-align:center;padding:16px 0 8px;">
             <p class="t-small t-muted">No confirmed matches yet.</p>
           </div>`
        : historyHtml}
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.querySelector('#btn-close-player-modal').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}
