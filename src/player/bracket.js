// src/player/bracket.js — Phase 6: Playoff Bracket tab
// Shows a live qualification tracker while the league is in progress, then
// the single-elimination draw once the admin activates the bracket.

import { dbGet, dbRef, dbListen, sRef } from '@shared/firebase.js';
import { escHtml } from '@shared/utils.js';
import { buildLeagueTable, isQualified } from '@shared/scoring.js';
import { avatarToSvg } from '@player/avatars.js';

export function renderBracketTab(el, player, creds) {
  el.innerHTML = `<div style="padding:24px;text-align:center;">
    <div class="spinner" style="margin:0 auto 12px;"></div>
    <p class="t-small t-muted">Loading bracket…</p>
  </div>`;

  const unsubs = [];
  let cancelled = false;

  (async () => {
    const sid = await dbGet(dbRef('config/defaultSeason'));
    if (cancelled) return;
    if (!sid) { _noSeason(el); return; }

    const leagues = await dbGet(sRef(sid, null, 'leagues'));
    if (cancelled) return;
    if (!leagues) { _noSeason(el); return; }

    // Find which league the current player is in
    const myLeagues = [];
    for (const [lid, league] of Object.entries(leagues)) {
      const m = await dbGet(sRef(sid, lid, 'members/' + creds.uid));
      if (cancelled) return;
      if (m !== null) myLeagues.push({ sid, lid, league });
    }
    const prefLid = localStorage.getItem('atp_active_lid');
    const ctx = myLeagues.find(l => l.lid === prefLid) || myLeagues[0] || null;
    if (!ctx) { _noSeason(el); return; }

    const { lid, league } = ctx;
    const [bracketData, allPlayers] = await Promise.all([
      dbGet(sRef(sid, lid, 'bracket')),
      dbGet(dbRef('players')),
    ]);
    if (cancelled) return;

    if (bracketData && (bracketData.status === 'active' || bracketData.status === 'complete')) {
      _renderBracket(el, bracketData, allPlayers || {}, creds.uid, league);
    } else {
      // Season still in progress — live qualification tracker
      const [membersObj, scoringConfig] = await Promise.all([
        dbGet(sRef(sid, lid, 'members')),
        dbGet(sRef(sid, lid, 'scoringConfig')),
      ]);
      if (cancelled) return;
      const memberUids = Object.keys(membersObj || {});
      const cfg = scoringConfig || { minMatches: 6, minWins: 4, bracketSize: 4 };

      const unsub = dbListen(sRef(sid, lid, 'matches'), (matchesObj) => {
        const table = buildLeagueTable(matchesObj || {}, memberUids);
        _renderTracker(el, table, allPlayers || {}, creds.uid, league, cfg);
      });
      unsubs.push(unsub);
    }
  })().catch(err => {
    console.error('Bracket tab error:', err);
    _noSeason(el);
  });

  return () => { cancelled = true; unsubs.forEach(u => u()); };
}

// ─── Qualification tracker ────────────────────────────────────────────────────

function _renderTracker(el, table, allPlayers, myUid, league, cfg) {
  const bracketSize = cfg.bracketSize || 4;
  const minMatches  = cfg.minMatches  || 6;
  const minWins     = cfg.minWins     || 4;
  const qualCount   = table.filter(r => isQualified(r.standing, cfg)).length;

  el.innerHTML = `
    <div style="padding-bottom:80px;">
      <div style="display:flex;align-items:center;padding:16px 0 12px;">
        <div class="badge badge-teal">${escHtml(league.name || 'League')}</div>
      </div>

      <div class="card" style="text-align:center;margin-bottom:20px;">
        <div style="font-family:var(--font-serif);font-size:18px;font-weight:700;
          color:var(--text);margin-bottom:6px;">Playoff Qualifier</div>
        <p class="t-small t-muted">
          Top ${bracketSize} spots &middot; min ${minWins}W from ${minMatches} matches
        </p>
        <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:10px;">
          <div style="font-family:var(--font-mono);font-size:22px;font-weight:500;
            color:${qualCount >= bracketSize ? 'var(--ace2)' : 'var(--text)'};">
            ${qualCount}/${bracketSize}
          </div>
          <span class="t-small t-muted">qualified</span>
        </div>
      </div>

      <div class="t-label t-muted" style="margin-bottom:8px;">Current Standings</div>

      ${table.map((row, i) => {
        const p      = allPlayers[row.uid] || {};
        const isMe   = row.uid === myUid;
        const qual   = isQualified(row.standing, cfg);
        const inZone = i < bracketSize;
        const w  = row.standing.matchesWon;
        const pl = row.standing.matchesPlayed;
        const gd = row.standing.gameDiff;
        const wLeft = Math.max(0, minWins - w);
        const pLeft = Math.max(0, minMatches - pl);

        let badgeClass, badgeText;
        if (qual && inZone) {
          badgeClass = 'badge-teal'; badgeText = 'Qualified';
        } else if (inZone && (wLeft > 0 || pLeft > 0)) {
          const tip = wLeft > 0 ? `${wLeft}W to go` : `${pLeft}P to go`;
          badgeClass = 'badge-gold'; badgeText = tip;
        } else if (!inZone) {
          badgeClass = 'badge-muted'; badgeText = `Outside top ${bracketSize}`;
        } else {
          badgeClass = 'badge-gold'; badgeText = 'On track';
        }

        return `
          <div style="display:flex;align-items:center;gap:10px;padding:10px;
            background:${isMe ? 'var(--ace-bg)' : 'var(--surface)'};
            border:1px solid ${isMe ? 'var(--ace)' : 'var(--border)'};
            border-radius:var(--radius);margin-bottom:6px;">
            <div style="width:22px;text-align:center;font-family:var(--font-mono);font-size:11px;
              font-weight:700;color:${qual && inZone ? 'var(--ace2)' : 'var(--text3)'};flex-shrink:0;">
              ${i + 1}
            </div>
            ${avatarToSvg(p.avatarId || null, 30)}
            <div style="flex:1;min-width:0;">
              <div style="font-weight:700;font-size:14px;
                color:${isMe ? 'var(--ace)' : 'var(--text)'};
                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${isMe ? 'You' : escHtml(p.alias || p.name || row.uid)}
              </div>
              <div class="t-small t-muted">
                ${w}W &middot; ${pl}P &middot; GD ${gd >= 0 ? '+' : ''}${gd}
              </div>
            </div>
            <div class="badge ${badgeClass}" style="white-space:nowrap;flex-shrink:0;">
              ${escHtml(badgeText)}
            </div>
          </div>
        `;
      }).join('')}

      ${table.length === 0 ? `
        <div class="empty-state" style="padding:32px 16px;">
          <p class="t-small t-muted">No matches played yet.</p>
        </div>
      ` : ''}
    </div>
  `;
}

// ─── Active bracket ───────────────────────────────────────────────────────────

function _renderBracket(el, bracket, allPlayers, myUid, league) {
  const rounds    = bracket.rounds || {};
  const roundKeys = Object.keys(rounds).sort();
  const isComplete = bracket.status === 'complete';
  const champion  = bracket.champion ? allPlayers[bracket.champion] : null;

  el.innerHTML = `
    <div style="padding-bottom:80px;">
      <div style="display:flex;align-items:center;justify-content:space-between;
        padding:16px 0 12px;">
        <div class="badge badge-teal">${escHtml(league.name || 'League')}</div>
        <div class="badge badge-ace">Knockout Stage</div>
      </div>

      ${isComplete && champion ? `
        <div class="card" style="text-align:center;margin-bottom:20px;
          background:var(--ace-bg);border-color:var(--ace);">
          <div style="font-size:28px;margin-bottom:4px;">🏆</div>
          <div style="font-family:var(--font-serif);font-size:18px;font-weight:700;
            color:var(--ace);">Champion</div>
          <div style="font-weight:700;font-size:15px;margin-top:6px;">
            ${bracket.champion === myUid ? 'You!' : escHtml(champion.alias || champion.name || '')}
          </div>
        </div>
      ` : ''}

      ${roundKeys.map(rk => {
        const round     = rounds[rk];
        const matchKeys = Object.keys(round.matches || {}).sort();
        return `
          <div class="t-label t-muted" style="margin:16px 0 8px;">
            ${escHtml(round.name || 'Round ' + (parseInt(rk.replace('r', ''), 10) + 1))}
          </div>
          ${matchKeys.map(mk => {
            const m  = round.matches[mk];
            const pA = allPlayers[m.playerA] || {};
            const pB = m.playerB ? (allPlayers[m.playerB] || {}) : null;
            const aWon = m.winner === m.playerA;
            const bWon = m.winner === m.playerB;
            const played = !!m.winner;
            return `
              <div class="card" style="margin-bottom:8px;padding:12px;">
                ${_matchRow(m.playerA, pA, aWon, played, myUid)}
                <div style="display:flex;align-items:center;gap:8px;padding:3px 0;">
                  <div style="flex:1;height:1px;background:var(--border);"></div>
                  <span style="font-family:var(--font-mono);font-size:11px;color:var(--text3);">
                    ${m.score ? escHtml(m.score) : 'vs'}
                  </span>
                  <div style="flex:1;height:1px;background:var(--border);"></div>
                </div>
                ${pB
                  ? _matchRow(m.playerB, pB, bWon, played, myUid)
                  : `<div style="padding:6px 0;font-size:13px;color:var(--text3);font-style:italic;">
                       TBD — awaiting previous round
                     </div>`
                }
                ${!played && pB ? `
                  <div style="text-align:center;padding-top:6px;">
                    <span class="badge badge-gold">Scheduled</span>
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        `;
      }).join('')}

      ${roundKeys.length === 0 ? `
        <div class="empty-state" style="padding:32px 16px;">
          <p class="t-small t-muted">Draw coming soon.</p>
        </div>
      ` : ''}
    </div>
  `;
}

function _matchRow(uid, p, won, played, myUid) {
  const isMe = uid === myUid;
  return `
    <div style="display:flex;align-items:center;gap:10px;padding:6px 0;
      opacity:${played && !won ? '0.4' : '1'};">
      ${avatarToSvg(p.avatarId || null, 28)}
      <div style="flex:1;font-weight:${won ? '700' : '400'};font-size:14px;
        color:${isMe ? 'var(--ace)' : 'var(--text)'};">
        ${isMe ? 'You' : escHtml(p.alias || p.name || uid)}
      </div>
      ${won ? `<div class="badge badge-teal">Won</div>` : ''}
    </div>
  `;
}

// ─── No-season fallback ───────────────────────────────────────────────────────

function _noSeason(el) {
  el.innerHTML = `
    <div class="empty-state" style="padding-top:48px;">
      <div class="empty-state-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/>
          <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
          <path d="M4 22h16"/>
          <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>
          <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
          <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
        </svg>
      </div>
      <div class="empty-state-title">Playoff Bracket</div>
      <p class="t-small" style="max-width:240px;">
        The bracket activates when the admin ends the league phase and generates the draw.
      </p>
    </div>
  `;
}
