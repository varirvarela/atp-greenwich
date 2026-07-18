// src/player/matches.js — Phase 3: Match management
// Handles match proposals, result entry, confirmation, and photo upload.
// Match data: seasons/{sid}/leagues/{lid}/matches/{mid}
// Match status flow: scheduled → result_pending → photo_pending → confirmed

import { dbGet, dbRef, dbMultiUpdate, dbListen, dbPush, pRef, sRef, uploadMatchPhoto } from '@shared/firebase.js';
import { escHtml } from '@shared/utils.js';
import { fmtTime, tsToLocalInput, localInputToTs } from '@shared/tz.js';
import { calculateElo } from '@shared/elo.js';
import { avatarToSvg } from '@player/avatars.js';
import { showPlayerModal } from '@player/player-modal.js';
import { writeActivity } from '@shared/activity.js';

const BASE = import.meta.env.BASE_URL;

let _matchFilter = 'all'; // 'all' | 'active' | 'completed'
let _matchSearch = '';

// ─── Tennis score helpers ─────────────────────────────────────────────────────

function _isValidTennisSet(me, op) {
  if (isNaN(me) || isNaN(op) || me < 0 || op < 0) return false;
  const w = Math.max(me, op), l = Math.min(me, op);
  if (w === 6 && l <= 4) return true;
  if (w === 7 && l === 5) return true;
  if (w === 7 && l === 6) return true;
  return false;
}

function _needsTiebreak(me, op) {
  return (me === 7 && op === 6) || (me === 6 && op === 7);
}

function _isValidTiebreak(me, op) {
  if (isNaN(me) || isNaN(op) || me < 0 || op < 0) return false;
  const hi = Math.max(me, op);
  const lo = Math.min(me, op);
  return hi >= 7 && hi - lo >= 2;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export function renderMatchesTab(el, player, creds) {
  el.innerHTML = `<div style="padding:24px;text-align:center;">
    <div class="spinner" style="margin:0 auto 12px;"></div>
    <p class="t-small t-muted">Loading matches…</p>
  </div>`;

  let unsubscribe = null;
  let cancelled = false;

  (async () => {
    const ctx = await _loadLeagueContext(creds.uid);
    if (cancelled) return;
    if (!ctx) { _renderNoLeague(el); return; }

    const { sid, lid, leagueName } = ctx;
    const [membersObj, allPlayers] = await Promise.all([
      dbGet(sRef(sid, lid, 'members')),
      dbGet(pRef()),
    ]);
    if (cancelled) return;

    const memberUids = Object.keys(membersObj || {});

    unsubscribe = dbListen(sRef(sid, lid, 'matches'), (matchesObj) => {
      _renderMatchList(el, matchesObj || {}, creds.uid, allPlayers || {}, memberUids, sid, lid, leagueName);
    });
  })().catch(() => _renderError(el));

  return () => { cancelled = true; if (unsubscribe) { unsubscribe(); unsubscribe = null; } };
}

// ─── League context loader ────────────────────────────────────────────────────

async function _loadLeagueContext(uid) {
  let sid = localStorage.getItem('atp_active_season');
  if (!sid) {
    const allSeasons = await dbGet(dbRef('seasons'));
    if (!allSeasons) return null;
    const order = Object.keys(allSeasons).sort((a, b) =>
      (allSeasons[b].createdAt || 0) - (allSeasons[a].createdAt || 0)
    );
    sid = order[0];
    if (sid) localStorage.setItem('atp_active_season', sid);
  }
  if (!sid) return null;
  const leagues = await dbGet(sRef(sid, null, 'leagues'));
  if (!leagues) return null;
  const myLeagues = [];
  for (const [lid, league] of Object.entries(leagues)) {
    const member = await dbGet(sRef(sid, lid, 'members/' + uid));
    if (member !== null) myLeagues.push({ sid, lid, leagueName: league.name || 'League' });
  }
  if (!myLeagues.length) return null;
  const prefLid = localStorage.getItem('atp_active_lid');
  return myLeagues.find(l => l.lid === prefLid) || myLeagues[0];
}

// ─── Photo compression ────────────────────────────────────────────────────────

function _compressPhoto(file, maxPx = 1280, quality = 0.82) {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > maxPx || h > maxPx) {
        if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; }
        else        { w = Math.round(w * maxPx / h); h = maxPx; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => {
        resolve(blob ? new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }) : file);
      }, 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// ─── Match list render ────────────────────────────────────────────────────────

function _renderMatchList(el, matchesObj, myUid, allPlayers, memberUids, sid, lid, leagueName) {
  const matches = Object.entries(matchesObj).map(([mid, m]) => ({ mid, ...m }));
  const mine    = matches.filter(m => m.playerA === myUid || m.playerB === myUid);

  // Open challenges from others that the current player can accept
  // Note: Firebase omits null fields on read, so playerB is undefined (not null) for open challenges
  const openChallenges = matches.filter(m =>
    m.status === 'open_challenge' && m.playerA !== myUid && !m.playerB
  );

  // Apply status + search filters to own matches
  const statusFilter = m =>
    _matchFilter === 'active'    ? m.status !== 'confirmed' :
    _matchFilter === 'completed' ? m.status === 'confirmed' : true;
  const searchFilter = m => {
    if (!_matchSearch) return true;
    const opUid = m.playerA === myUid ? m.playerB : m.playerA;
    const op = allPlayers[opUid] || {};
    return ((op.alias || '') + ' ' + (op.name || '')).toLowerCase()
      .includes(_matchSearch.toLowerCase());
  };
  const filteredMine = mine.filter(m => statusFilter(m) && searchFilter(m));

  const isCanceled   = m => !!(m.forfeited) || m.status === 'cancelled' || m.status === 'canceled';

  const actionNeeded = filteredMine.filter(m => _needsMyAction(m, myUid) && !isCanceled(m));
  const inProgress   = filteredMine.filter(m => !_needsMyAction(m, myUid) && m.status !== 'confirmed' && !isCanceled(m));
  const completed    = filteredMine
    .filter(m => m.status === 'confirmed')
    .sort((a, b) => (b.confirmedAt || 0) - (a.confirmedAt || 0))
    .slice(0, 20);
  const canceled     = filteredMine.filter(m => isCanceled(m));

  const hasActiveMatches = actionNeeded.length || inProgress.length;

  el.innerHTML = `
    <div style="padding-bottom:100px;">
      <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;padding-top:4px;">
        <button class="btn btn-sm ${_matchFilter === 'all' ? 'btn-primary' : 'btn-surface'}"
          data-filter="all" style="white-space:nowrap;flex-shrink:0;">All</button>
        <button class="btn btn-sm ${_matchFilter === 'active' ? 'btn-primary' : 'btn-surface'}"
          data-filter="active" style="white-space:nowrap;flex-shrink:0;">Active</button>
        <button class="btn btn-sm ${_matchFilter === 'completed' ? 'btn-primary' : 'btn-surface'}"
          data-filter="completed" style="white-space:nowrap;flex-shrink:0;">Completed</button>
      </div>
      <input class="input" id="opponent-search" type="search" placeholder="Search opponent…"
        value="${escHtml(_matchSearch)}" style="font-size:14px;margin-bottom:12px;">

      ${openChallenges.length ? `
        <div class="t-label t-muted" style="margin:4px 0 8px;">Open challenges</div>
        ${openChallenges.map(m => _openChallengeCard(m, allPlayers)).join('')}
      ` : ''}

      ${actionNeeded.length ? `
        <div class="t-label t-muted" style="margin:12px 0 8px;">Needs your action</div>
        ${actionNeeded.map(m => _matchCard(m, myUid, allPlayers)).join('')}
      ` : ''}

      ${inProgress.length ? `
        <div class="t-label t-muted" style="margin:12px 0 8px;">In progress</div>
        ${inProgress.map(m => _matchCard(m, myUid, allPlayers)).join('')}
      ` : ''}

      ${!hasActiveMatches && !openChallenges.length && _matchFilter === 'all' && !_matchSearch ? `
        <div style="text-align:center;padding:32px 0 0;">
          <img src="${BASE}images/atp-empty-matches.png"
            style="width:160px;height:auto;opacity:.85;margin:0 auto 16px;">
          <div class="empty-state-title">No active matches</div>
          <p class="t-small t-muted" style="max-width:220px;margin:0 auto;">
            Propose a match against a league opponent to get started.
          </p>
        </div>
      ` : (!hasActiveMatches && !openChallenges.length ? `
        <p class="t-small t-muted" style="text-align:center;padding:24px 0;">No matches found.</p>
      ` : '')}

      ${completed.length ? `
        <div class="t-label t-muted" style="margin:20px 0 8px;">Recent results</div>
        ${completed.map(m => _matchCard(m, myUid, allPlayers)).join('')}
      ` : ''}

      ${canceled.length ? `
        <div class="t-label t-muted" style="margin:20px 0 8px;">Canceled</div>
        ${canceled.map(m => _canceledCard(m, myUid, allPlayers)).join('')}
      ` : ''}
    </div>

    <div style="position:fixed;bottom:calc(76px + var(--safe-b, 0px));right:20px;z-index:100;">
      <button class="btn btn-primary" id="btn-propose"
        style="width:auto;padding:12px 22px;border-radius:100px;
          box-shadow:0 4px 16px rgba(184,64,8,.35);">
        + Propose Match
      </button>
    </div>
  `;

  // Filter buttons
  el.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      _matchFilter = btn.dataset.filter;
      _renderMatchList(el, matchesObj, myUid, allPlayers, memberUids, sid, lid, leagueName);
    });
  });

  // Search input
  el.querySelector('#opponent-search')?.addEventListener('input', e => {
    _matchSearch = e.target.value;
    _renderMatchList(el, matchesObj, myUid, allPlayers, memberUids, sid, lid, leagueName);
  });

  // Action buttons (mine + open challenges)
  el.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const { action, mid } = btn.dataset;
      const match = matches.find(m => m.mid === mid);
      if (!match) return;
      if (action === 'enter-result')      _showEnterResultModal(match, myUid, allPlayers, sid, lid);
      if (action === 'confirm-result')    _showConfirmResultModal(match, myUid, allPlayers, sid, lid);
      if (action === 'upload-photo')      _showUploadPhotoModal(match, myUid, allPlayers, sid, lid);
      if (action === 'adjust-result')     _showAdjustResultModal(match, myUid, allPlayers, sid, lid);
      if (action === 'forfeit')           _showForfeitModal(match, myUid, allPlayers, sid, lid);
      if (action === 'accept-challenge')  _showAcceptChallengeModal(match, myUid, allPlayers, matchesObj, sid, lid);
      if (action === 'cancel-challenge')  _showCancelProposalModal(match, myUid, sid, lid);
      if (action === 'cancel-proposal')   _showCancelProposalModal(match, myUid, sid, lid);
      if (action === 'edit-proposal')        _showEditProposalModal(match, myUid, sid, lid);
      if (action === 'edit-open-challenge')  _showEditOpenChallengeModal(match, myUid, allPlayers, memberUids, sid, lid);
      if (action === 'decline-proposal')  _showCancelProposalModal(match, myUid, sid, lid);
    });
  });

  // Player name click → profile modal
  el.querySelectorAll('[data-view-player]').forEach(span => {
    span.addEventListener('click', e => {
      e.stopPropagation();
      showPlayerModal(span.dataset.viewPlayer, allPlayers, matchesObj, myUid);
    });
  });

  // Confirmed card body → match detail
  el.querySelectorAll('[data-view-match]').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      if (e.target.closest('[data-view-player]')) return;
      const mid   = card.dataset.viewMatch;
      const match = mine.find(m => m.mid === mid);
      if (match) _showMatchDetailModal(match, allPlayers, myUid);
    });
  });

  el.querySelector('#btn-propose')?.addEventListener('click', () => {
    _showProposeModal(myUid, allPlayers, memberUids, matchesObj, sid, lid);
  });
}

// ─── Match card ───────────────────────────────────────────────────────────────

function _needsMyAction(match, myUid) {
  if (match.status === 'result_pending' && match.result?.enteredBy !== myUid) return true;
  if (match.status === 'photo_pending') return true;
  return false;
}

function _matchCard(match, myUid, allPlayers) {
  const opUid  = match.playerA === myUid ? match.playerB : match.playerA;
  const op     = opUid ? (allPlayers[opUid] || { name: 'Unknown', alias: opUid })
                       : { name: 'Open', alias: 'Any challenger' };
  const meData = allPlayers[myUid];
  const isMeA  = match.playerA === myUid;

  const meAv = meData?.avatarId ? avatarToSvg(meData.avatarId, 36) : _defaultAv(36);
  const opAv = opUid && op.avatarId ? avatarToSvg(op.avatarId, 36) : _defaultAv(36);

  const score             = _formatScore(match.result, isMeA);
  const { badge, action } = _cardMeta(match, myUid);
  const isConfirmed       = match.status === 'confirmed';

  let eloBadge = '';
  if (isConfirmed && match.eloDeltas?.[myUid] !== undefined) {
    const d = match.eloDeltas[myUid];
    eloBadge = `<span class="t-label" style="font-family:var(--font-mono);font-size:10px;
      color:${d >= 0 ? 'var(--ace2)' : 'var(--ace3)'};">
      ${d >= 0 ? '+' : ''}${d} ELO
    </span>`;
  }

  const formatBadge = match.format === 'pro10'
    ? `<span class="badge badge-muted" style="font-size:10px;letter-spacing:.5px;">Pro 10</span>`
    : '';
  const groupBadge  = match.groupMatch
    ? `<span class="badge" style="font-size:10px;background:rgba(0,100,220,.10);color:#0054c4;">Group</span>`
    : '';
  const dateBadge   = (match.scheduledAt && (match.status === 'scheduled' || match.status === 'open_challenge'))
    ? `<span class="t-label t-muted" style="font-size:10px;">
         📅 ${fmtTime(match.scheduledAt)}
       </span>`
    : '';
  const deadlineBadge = (match.groupMatch && match.deadline && match.status !== 'confirmed')
    ? `<span class="t-label" style="font-size:10px;color:var(--ace3);">
         Play by ${new Date(match.deadline).toLocaleDateString('en-GB', { day:'numeric', month:'short' })}
       </span>`
    : '';

  const canForfeit = match.groupMatch && !match.forfeited && match.status !== 'confirmed';

  // Management buttons for non-group matches
  const isMyOpenChallenge = match.status === 'open_challenge' && match.playerA === myUid;
  const isMyProposal      = !match.groupMatch && match.proposedBy === myUid && match.status === 'scheduled';
  const isTheirProposal   = !match.groupMatch && match.playerB === myUid && match.proposedBy !== myUid && match.status === 'scheduled';
  const canReschedule     = (match.playerA === myUid || match.playerB === myUid) && match.status === 'scheduled';

  const _rescheduleBtn = `<button class="btn btn-ghost btn-sm" data-action="edit-proposal" data-mid="${escHtml(match.mid)}"
        style="width:auto;">Reschedule</button>`;

  const mgmtBtns = isMyOpenChallenge
    ? `<button class="btn btn-ghost btn-sm" data-action="edit-open-challenge" data-mid="${escHtml(match.mid)}"
        style="width:auto;">Edit</button>
       <button class="btn btn-ghost btn-sm" data-action="cancel-challenge" data-mid="${escHtml(match.mid)}"
        style="color:var(--ace3);border-color:rgba(190,30,30,.25);width:auto;">Cancel</button>`
    : isMyProposal
    ? `${_rescheduleBtn}
       <button class="btn btn-ghost btn-sm" data-action="cancel-proposal" data-mid="${escHtml(match.mid)}"
        style="color:var(--ace3);border-color:rgba(190,30,30,.25);width:auto;">Cancel</button>`
    : isTheirProposal
    ? `${_rescheduleBtn}
       <button class="btn btn-ghost btn-sm" data-action="decline-proposal" data-mid="${escHtml(match.mid)}"
        style="color:var(--ace3);border-color:rgba(190,30,30,.25);width:auto;">Decline</button>`
    : canReschedule
    ? _rescheduleBtn
    : '';

  const hasAnyAction = action || canForfeit || mgmtBtns;

  const opDisplay = opUid
    ? `<span class="t-small" style="font-weight:700;white-space:nowrap;overflow:hidden;
        text-overflow:ellipsis;text-align:right;cursor:pointer;"
        data-view-player="${escHtml(opUid)}">
        ${escHtml(op.alias || op.name)}
      </span>`
    : `<span class="t-small t-muted" style="font-style:italic;">Any challenger</span>`;

  return `
    <div class="card match-card" style="margin-bottom:10px;padding:14px 16px;
      ${isConfirmed ? 'cursor:pointer;' : ''}"
      ${isConfirmed ? `data-view-match="${escHtml(match.mid)}"` : ''}>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:0;">
          <span data-view-player="${escHtml(myUid)}" style="cursor:pointer;flex-shrink:0;display:inline-flex;">${meAv}</span>
          <span class="t-small" style="font-weight:700;white-space:nowrap;overflow:hidden;
            text-overflow:ellipsis;cursor:pointer;" data-view-player="${escHtml(myUid)}">You</span>
        </div>
        <div style="font-family:var(--font-mono);font-size:11px;color:var(--text3);
          flex-shrink:0;text-align:center;min-width:48px;">
          ${score || 'vs'}
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:0;
          justify-content:flex-end;">
          ${opDisplay}
          ${opUid ? `<span data-view-player="${escHtml(opUid)}" style="cursor:pointer;flex-shrink:0;display:inline-flex;">${opAv}</span>` : opAv}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        ${badge}
        ${groupBadge}
        ${formatBadge}
        ${eloBadge}
        ${dateBadge}
        ${deadlineBadge}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:${hasAnyAction ? '8px' : '0'};">
        ${action ? `<button class="${action === 'adjust-result' ? 'btn btn-ghost btn-sm' : 'btn btn-primary btn-sm'}"
          data-action="${action}" data-mid="${escHtml(match.mid)}"
          style="${action === 'adjust-result' ? 'width:auto;' : 'flex:1;'}">${_actionLabel(action)}</button>` : ''}
        ${canForfeit ? `<button class="btn btn-ghost btn-sm" data-action="forfeit"
          data-mid="${escHtml(match.mid)}"
          style="color:var(--ace3);border-color:rgba(190,30,30,.25);width:auto;">Forfeit</button>` : ''}
        ${mgmtBtns}
      </div>
    </div>
  `;
}

function _canceledCard(match, myUid, allPlayers) {
  const opUid  = match.playerA === myUid ? match.playerB : match.playerA;
  const op     = opUid ? (allPlayers[opUid] || { name: 'Unknown', alias: opUid })
                       : { name: 'Open', alias: 'Any challenger' };
  const meData = allPlayers[myUid];
  const isMeA  = match.playerA === myUid;

  const meAv = meData?.avatarId ? avatarToSvg(meData.avatarId, 36) : _defaultAv(36);
  const opAv = opUid && op.avatarId ? avatarToSvg(op.avatarId, 36) : _defaultAv(36);

  const score = _formatScore(match.result, isMeA);

  let statusBadge;
  if (match.forfeited) {
    const forfeitedByMe = match.forfeited === myUid;
    const forfeitedByName = forfeitedByMe ? 'You' : escHtml(op.alias || op.name);
    statusBadge = `<span class="badge badge-muted">${forfeitedByName} forfeited</span>`;
  } else {
    statusBadge = `<span class="badge badge-muted">Canceled</span>`;
  }

  const opDisplay = opUid
    ? `<span class="t-small" style="font-weight:700;white-space:nowrap;overflow:hidden;
        text-overflow:ellipsis;text-align:right;">${escHtml(op.alias || op.name)}</span>`
    : `<span class="t-small t-muted" style="font-style:italic;">Any challenger</span>`;

  return `
    <div class="card match-card" style="margin-bottom:10px;padding:14px 16px;opacity:.65;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:0;">
          ${meAv}
          <span class="t-small" style="font-weight:700;white-space:nowrap;overflow:hidden;
            text-overflow:ellipsis;">You</span>
        </div>
        <div style="font-family:var(--font-mono);font-size:11px;color:var(--text3);
          flex-shrink:0;text-align:center;min-width:48px;">
          ${score || 'vs'}
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:0;
          justify-content:flex-end;">
          ${opDisplay}
          ${opAv}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        ${statusBadge}
      </div>
    </div>
  `;
}

function _cardMeta(match, myUid) {
  const iEnteredResult = match.result?.enteredBy === myUid;
  switch (match.status) {
    case 'scheduled':
      return {
        badge:  `<span class="badge badge-muted">Scheduled</span>`,
        action: 'enter-result',
      };
    case 'result_pending':
      return iEnteredResult
        ? { badge: `<span class="badge badge-muted">Awaiting confirmation</span>`, action: null }
        : { badge: `<span class="badge badge-teal">Confirm result?</span>`, action: 'confirm-result' };
    case 'photo_pending':
      return {
        badge:  `<span class="badge badge-gold">Result agreed</span>`,
        action: 'upload-photo',
      };
    case 'confirmed': {
      const iWon = match.result?.winner === myUid;
      return {
        badge: `<span class="badge ${iWon ? 'badge-teal' : 'badge-muted'}">${iWon ? 'Won ✓' : 'Lost'}</span>`,
        action: 'adjust-result',
      };
    }
    case 'open_challenge':
      return {
        badge:  `<span class="badge" style="background:rgba(184,64,8,.1);color:var(--ace);">Open Challenge</span>`,
        action: null,
      };
    default:
      return { badge: `<span class="badge badge-muted">${escHtml(match.status || '')}</span>`, action: null };
  }
}

function _openChallengeCard(match, allPlayers) {
  const op   = allPlayers[match.playerA] || { name: 'Unknown', alias: match.playerA };
  const when = match.scheduledAt ? fmtTime(match.scheduledAt) : null;
  return `
    <div class="card" style="margin-bottom:10px;padding:14px 16px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        ${op.avatarId ? avatarToSvg(op.avatarId, 36) : _defaultAv(36)}
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:14px;">${escHtml(op.alias || op.name)}</div>
          ${when ? `<div class="t-small t-muted" style="font-size:11px;">📅 ${when}</div>` : ''}
        </div>
        <span class="badge" style="background:rgba(184,64,8,.1);color:var(--ace);flex-shrink:0;">Open</span>
      </div>
      <button class="btn btn-primary btn-sm"
        data-action="accept-challenge" data-mid="${escHtml(match.mid)}">
        Accept Challenge
      </button>
    </div>
  `;
}

function _actionLabel(action) {
  if (action === 'enter-result')   return 'Enter Result';
  if (action === 'confirm-result') return 'Confirm Result';
  if (action === 'upload-photo')   return 'Upload Photo';
  if (action === 'adjust-result')  return 'Adjust';
  return 'Action';
}

function _formatScore(result, isMeA) {
  if (!result) return '';
  if (result.score) {
    const s = result.score;
    return isMeA ? `${s.a}–${s.b}` : `${s.b}–${s.a}`;
  }
  if (!result.sets?.length) return '';
  return result.sets.map(s => {
    const base = isMeA ? `${s.a}-${s.b}` : `${s.b}-${s.a}`;
    if (s.tb) return `${base} (${s.tb.a}-${s.tb.b})`;
    return base;
  }).join(', ');
}

// ─── Propose match modal ──────────────────────────────────────────────────────

function _showProposeModal(myUid, allPlayers, memberUids, existingMatches, sid, lid) {
  const opponents = memberUids
    .filter(uid => uid !== myUid)
    .map(uid => allPlayers[uid] ? { ...allPlayers[uid], uid } : null)
    .filter(Boolean);

  const minDate = tsToLocalInput(Date.now() + 60000);

  const overlay = _createOverlay();
  overlay.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:0 0 16px;">
        <div style="font-size:16px;font-weight:700;">Propose a Match</div>
        <button class="btn-icon" id="btn-close">${_closeIcon()}</button>
      </div>

      <div style="display:flex;gap:4px;margin-bottom:16px;background:var(--surface2);
        border-radius:var(--radius);padding:4px;">
        <button id="mode-btn-direct"
          style="flex:1;padding:8px;border:none;border-radius:calc(var(--radius) - 2px);
            font-size:13px;font-weight:700;cursor:pointer;
            background:var(--surface);color:var(--text);">
          Vs Opponent
        </button>
        <button id="mode-btn-open"
          style="flex:1;padding:8px;border:none;border-radius:calc(var(--radius) - 2px);
            font-size:13px;font-weight:400;cursor:pointer;
            background:transparent;color:var(--text3);">
          Open Challenge
        </button>
      </div>

      <div id="section-direct">
        ${opponents.length === 0 ? `
          <p class="t-small t-muted" style="text-align:center;padding:24px 0;">
            No other players in your league yet.
          </p>
        ` : `
          <p class="t-small t-muted" style="margin-bottom:12px;">Select your opponent:</p>
          <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">
            ${opponents.map(op => {
              const matchCount = Object.values(existingMatches || {}).filter(m => {
                const involves = (m.playerA === myUid && m.playerB === op.uid)
                              || (m.playerA === op.uid && m.playerB === myUid);
                return involves && ['scheduled','result_pending','photo_pending','confirmed']
                  .includes(m.status);
              }).length;
              const atCap = matchCount >= 2;
              return `
                <div class="tap-card" data-uid="${escHtml(op.uid)}"
                  style="${atCap ? 'opacity:.4;pointer-events:none;' : ''}">
                  <div style="display:flex;align-items:center;gap:10px;">
                    ${op.avatarId ? avatarToSvg(op.avatarId, 36) : _defaultAv(36)}
                    <div style="flex:1;min-width:0;">
                      <div style="font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;
                        text-overflow:ellipsis;">${escHtml(op.name || op.alias)}</div>
                      <div class="t-small t-muted">@${escHtml(op.alias || op.username || '')}</div>
                    </div>
                    ${atCap
                      ? `<span class="badge badge-muted" style="flex-shrink:0;">2/2</span>`
                      : matchCount === 1
                        ? `<span class="badge badge-muted" style="flex-shrink:0;">1/2</span>`
                        : ''}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
          <div style="margin-bottom:20px;">
            <div class="t-label t-muted" style="margin-bottom:8px;">
              Suggested date &amp; time <span style="font-weight:400;opacity:.6;">(optional)</span>
            </div>
            <input class="input" id="propose-date-direct" type="datetime-local"
              style="font-size:14px;" min="${minDate}">
          </div>
          <button class="btn btn-primary" id="btn-confirm-direct" disabled>
            Propose Match
          </button>
        `}
      </div>

      <div id="section-open" style="display:none;">
        <div class="card" style="margin-bottom:16px;background:rgba(184,64,8,.06);
          border-color:rgba(184,64,8,.2);">
          <p class="t-small" style="color:var(--ace);line-height:1.5;">
            Any available league player can accept this challenge.
          </p>
        </div>
        <div style="margin-bottom:20px;">
          <div class="t-label t-muted" style="margin-bottom:8px;">
            Suggested date &amp; time <span style="font-weight:400;opacity:.6;">(optional)</span>
          </div>
          <input class="input" id="propose-date-open" type="datetime-local"
            style="font-size:14px;" min="${minDate}">
        </div>
        <button class="btn btn-primary" id="btn-confirm-open">
          Post Open Challenge
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.querySelector('#btn-close')?.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // Mode switcher
  const modeDirect = overlay.querySelector('#mode-btn-direct');
  const modeOpen   = overlay.querySelector('#mode-btn-open');
  const secDirect  = overlay.querySelector('#section-direct');
  const secOpen    = overlay.querySelector('#section-open');

  function setMode(m) {
    const isDirect = m === 'direct';
    modeDirect.style.background = isDirect ? 'var(--surface)' : 'transparent';
    modeDirect.style.color      = isDirect ? 'var(--text)' : 'var(--text3)';
    modeDirect.style.fontWeight = isDirect ? '700' : '400';
    modeOpen.style.background   = !isDirect ? 'var(--surface)' : 'transparent';
    modeOpen.style.color        = !isDirect ? 'var(--text)' : 'var(--text3)';
    modeOpen.style.fontWeight   = !isDirect ? '700' : '400';
    secDirect.style.display     = isDirect ? '' : 'none';
    secOpen.style.display       = !isDirect ? '' : 'none';
  }
  modeDirect.addEventListener('click', () => setMode('direct'));
  modeOpen.addEventListener('click',   () => setMode('open'));

  // Opponent selection
  let selectedUid = null;
  overlay.querySelectorAll('.tap-card[data-uid]').forEach(card => {
    card.addEventListener('click', () => {
      selectedUid = card.dataset.uid;
      overlay.querySelectorAll('.tap-card[data-uid]').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      const btn = overlay.querySelector('#btn-confirm-direct');
      if (btn) btn.disabled = false;
    });
  });

  // Direct confirm
  overlay.querySelector('#btn-confirm-direct')?.addEventListener('click', async () => {
    if (!selectedUid) return;
    const btn = overlay.querySelector('#btn-confirm-direct');
    btn.disabled = true; btn.textContent = 'Proposing…';
    try {
      const val = overlay.querySelector('#propose-date-direct')?.value;
      const scheduledAt = localInputToTs(val);
      const _newMatchRef = await dbPush(sRef(sid, lid, 'matches'), {
        playerA: myUid, playerB: selectedUid, proposedBy: myUid,
        proposedAt: Date.now(), scheduledAt, status: 'scheduled',
        result: null, photoUrl: null, eloDeltas: null, confirmedAt: null,
      });
      writeActivity('match_proposed', { sid, lid, mid: _newMatchRef.key, challengerId: myUid, opponentId: selectedUid || null, scheduledAt });
      overlay.remove();
    } catch (err) {
      console.error('Propose error:', err);
      btn.disabled = false; btn.textContent = 'Propose Match';
    }
  });

  // Open challenge confirm
  overlay.querySelector('#btn-confirm-open')?.addEventListener('click', async () => {
    const btn = overlay.querySelector('#btn-confirm-open');
    btn.disabled = true; btn.textContent = 'Posting…';
    try {
      const val = overlay.querySelector('#propose-date-open')?.value;
      const scheduledAt = localInputToTs(val);
      const _newMatchRef = await dbPush(sRef(sid, lid, 'matches'), {
        playerA: myUid, playerB: null, proposedBy: myUid,
        proposedAt: Date.now(), scheduledAt, status: 'open_challenge',
        result: null, photoUrl: null, eloDeltas: null, confirmedAt: null,
      });
      writeActivity('match_proposed', { sid, lid, mid: _newMatchRef.key, challengerId: myUid, opponentId: null, scheduledAt });
      overlay.remove();
    } catch (err) {
      console.error('Open challenge error:', err);
      btn.disabled = false; btn.textContent = 'Post Open Challenge';
    }
  });
}

// ─── Enter result modal ───────────────────────────────────────────────────────

function _showEnterResultModal(match, myUid, allPlayers, sid, lid) {
  _showResultEntryModal(match, myUid, allPlayers, sid, lid, false);
}

function _showAdjustResultModal(match, myUid, allPlayers, sid, lid) {
  _showResultEntryModal(match, myUid, allPlayers, sid, lid, true);
}

function _showResultEntryModal(match, myUid, allPlayers, sid, lid, isAdjust) {
  let isPro10 = match.format === 'pro10';
  const opUid  = match.playerA === myUid ? match.playerB : match.playerA;
  const op     = allPlayers[opUid] || { name: 'Unknown', alias: opUid };
  const opName = op.alias || op.name;
  const isMeA  = match.playerA === myUid;
  const prev   = isAdjust ? match.result : null;

  // When adjusting and format was already set, restore pro10 choice from prev score shape
  if (isAdjust && !match.format) {
    isPro10 = !!(prev?.score);
  }

  const overlay = _createOverlay();
  overlay.innerHTML = `
    <div class="modal-sheet" style="max-height:92dvh;overflow-y:auto;">
      <div class="modal-handle"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:0 0 16px;">
        <div style="font-size:16px;font-weight:700;">${isAdjust ? 'Adjust Result' : 'Enter Result'}</div>
        <button class="btn-icon" id="btn-close">${_closeIcon()}</button>
      </div>

      ${isAdjust ? `
        <div class="card" style="margin-bottom:16px;border-left:3px solid var(--ace4);background:var(--ace4-bg);">
          <p class="t-small" style="color:var(--ace4);">
            Adjusting this result will recalculate ELO ratings for both players.
          </p>
        </div>
      ` : ''}

      ${!match.format ? `
        <div style="margin-bottom:16px;">
          <div class="t-label t-muted" style="margin-bottom:8px;">Match format</div>
          <div style="display:flex;gap:8px;">
            <div class="tap-card ${!isPro10 ? 'selected' : ''}" data-format="bo3"
              style="flex:1;text-align:center;padding:10px 8px;">
              <div style="font-weight:700;font-size:13px;">Best of 3</div>
              <div class="t-small t-muted">Sets</div>
            </div>
            <div class="tap-card ${isPro10 ? 'selected' : ''}" data-format="pro10"
              style="flex:1;text-align:center;padding:10px 8px;">
              <div style="font-weight:700;font-size:13px;">Pro 10</div>
              <div class="t-small t-muted">0–10 games</div>
            </div>
          </div>
        </div>
      ` : ''}

      <div id="section-pro10" style="display:${isPro10 ? '' : 'none'};">
        <div style="margin-bottom:20px;">
          <div class="t-label t-muted" style="margin-bottom:12px;">Score (0 – 10)</div>
          <div style="display:flex;align-items:flex-end;gap:12px;justify-content:center;">
            <div style="text-align:center;">
              <div class="t-small t-muted" style="margin-bottom:6px;">You</div>
              <input type="number" class="input" id="score-me"
                min="0" max="10" inputmode="numeric" placeholder="–"
                value="${prev?.score ? (isMeA ? prev.score.a : prev.score.b) : ''}"
                style="width:76px;text-align:center;height:56px;font-size:24px;padding:8px 4px;">
            </div>
            <span style="font-size:24px;color:var(--text3);padding-bottom:10px;">–</span>
            <div style="text-align:center;">
              <div class="t-small t-muted" style="margin-bottom:6px;">${escHtml(opName)}</div>
              <input type="number" class="input" id="score-op"
                min="0" max="10" inputmode="numeric" placeholder="–"
                value="${prev?.score ? (isMeA ? prev.score.b : prev.score.a) : ''}"
                style="width:76px;text-align:center;height:56px;font-size:24px;padding:8px 4px;">
            </div>
          </div>
        </div>
      </div>

      <div id="section-bo3" style="display:${!isPro10 ? '' : 'none'};">
        <div style="margin-bottom:20px;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;padding-bottom:2px;
            border-bottom:1px solid var(--border);">
            <span style="width:48px;flex-shrink:0;"></span>
            <span style="flex:1;text-align:center;font-size:11px;font-weight:700;color:var(--text3);">You</span>
            <span style="width:16px;flex-shrink:0;"></span>
            <span style="flex:1;text-align:center;font-size:11px;font-weight:700;color:var(--text3);">${escHtml(opName)}</span>
            <div style="width:24px;flex-shrink:0;"></div>
          </div>
          <div id="sets-container" style="display:flex;flex-direction:column;">
            ${_setRowWithPrefill(1, false, prev, isMeA)}
            ${_setRowWithPrefill(2, false, prev, isMeA)}
            ${prev?.sets?.length >= 3 ? _setRowWithPrefill(3, true, prev, isMeA) : ''}
          </div>
          <button class="btn btn-ghost btn-sm" id="btn-add-set"
            style="margin-top:8px;width:auto;${prev?.sets?.length >= 3 ? 'display:none;' : ''}">
            + Add 3rd set
          </button>
        </div>
      </div>

      <div id="winner-display" data-op-name="${escHtml(opName)}"
        style="display:none;text-align:center;margin-bottom:16px;padding:8px 12px;
          border-radius:8px;font-weight:700;font-size:13px;">
      </div>

      <!-- Incomplete finish option -->
      <div id="section-incomplete" style="margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--text2);">
            <input type="checkbox" id="chk-incomplete" style="width:16px;height:16px;cursor:pointer;">
            Incomplete result (walkover / injury / retirement)
          </label>
        </div>
        <div id="incomplete-winner-row" style="display:none;margin-top:10px;">
          <div class="t-label t-muted" style="margin-bottom:8px;">Who wins the match?</div>
          <div style="display:flex;gap:8px;">
            <div class="tap-card" data-incomplete-winner="me"
              style="flex:1;text-align:center;padding:10px 8px;">
              <div style="font-weight:700;font-size:13px;">Me</div>
            </div>
            <div class="tap-card" data-incomplete-winner="op"
              style="flex:1;text-align:center;padding:10px 8px;">
              <div style="font-weight:700;font-size:13px;" data-op-label="true"></div>
            </div>
          </div>
        </div>
      </div>

      <div style="margin-bottom:20px;">
        <div class="t-label t-muted" style="margin-bottom:8px;">
          Match photo
          ${isAdjust
            ? `<span style="color:var(--text3);font-size:10px;font-weight:400;">(optional — keep existing if not changed)</span>`
            : `<span style="color:var(--ace3);font-size:10px;">required</span>`}
        </div>
        <div id="photo-preview" style="display:none;margin-bottom:10px;text-align:center;">
          <img id="photo-img" style="max-width:100%;max-height:150px;border-radius:10px;
            object-fit:cover;border:2px solid var(--border);">
          <button type="button" id="btn-remove-photo"
            style="display:block;margin:6px auto 0;background:none;border:none;
              cursor:pointer;font-size:11px;color:var(--text3);">Remove photo</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <label class="btn btn-surface"
            style="cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
            📷 Camera
            <input type="file" id="photo-camera" accept="image/*" capture="environment"
              style="display:none;">
          </label>
          <label class="btn btn-surface"
            style="cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
            🖼 Gallery
            <input type="file" id="photo-gallery" accept="image/*"
              style="display:none;">
          </label>
        </div>
      </div>

      <div style="padding-bottom:8px;">
        <button class="btn btn-primary" id="btn-submit-result" disabled>
          ${isAdjust ? 'Save Adjustment' : 'Submit Result'}
        </button>
      </div>

      <div id="submit-status" style="display:none;text-align:center;padding:12px 0;">
        <div class="spinner" style="margin:0 auto 8px;"></div>
        <p class="t-small t-muted">Saving and updating ratings…</p>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.querySelector('#btn-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // Incomplete / walkover
  const chkIncomplete = overlay.querySelector('#chk-incomplete');
  const incompleteRow = overlay.querySelector('#incomplete-winner-row');
  const opLabelEl = overlay.querySelector('[data-op-label="true"]');
  if (opLabelEl) opLabelEl.textContent = opName;

  let incompleteWinner = null;

  chkIncomplete?.addEventListener('change', () => {
    const checked = chkIncomplete.checked;
    incompleteRow.style.display = checked ? 'block' : 'none';
    if (!checked) {
      incompleteWinner = null;
      overlay.dataset.incompleteWinner = '';
      overlay.querySelectorAll('[data-incomplete-winner]').forEach(c => c.classList.remove('selected'));
    }
    _checkResultReady(overlay, isPro10, isAdjust);
  });

  overlay.querySelectorAll('[data-incomplete-winner]').forEach(card => {
    card.addEventListener('click', () => {
      incompleteWinner = card.dataset.incompleteWinner;
      overlay.dataset.incompleteWinner = incompleteWinner;
      overlay.querySelectorAll('[data-incomplete-winner]').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      _checkResultReady(overlay, isPro10, isAdjust);
    });
  });

  let thirdSetAdded = !!(prev?.sets?.length >= 3);
  let selectedFile  = null;

  // Format picker (only when format not pre-set)
  if (!match.format) {
    overlay.querySelectorAll('[data-format]').forEach(card => {
      card.addEventListener('click', () => {
        const fmt = card.dataset.format;
        isPro10 = fmt === 'pro10';
        overlay.querySelectorAll('[data-format]').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        overlay.querySelector('#section-pro10').style.display = isPro10 ? '' : 'none';
        overlay.querySelector('#section-bo3').style.display   = !isPro10 ? '' : 'none';
        _checkResultReady(overlay, isPro10, isAdjust);
      });
    });
  }

  overlay.addEventListener('third-set-removed', () => {
    thirdSetAdded = false;
    _checkResultReady(overlay, isPro10, isAdjust);
  });

  // Wire all score inputs — use current isPro10 from closure at call time
  overlay.querySelector('#score-me')?.addEventListener('input', () =>
    _checkResultReady(overlay, isPro10, isAdjust));
  overlay.querySelector('#score-op')?.addEventListener('input', () =>
    _checkResultReady(overlay, isPro10, isAdjust));
  overlay.querySelector('#sets-container')?.addEventListener('input', () =>
    _checkResultReady(overlay, isPro10, isAdjust));

  overlay.querySelector('#btn-add-set')?.addEventListener('click', () => {
    if (thirdSetAdded) return;
    thirdSetAdded = true;
    overlay.querySelector('#sets-container').insertAdjacentHTML('beforeend', _setRow(3, true));
    overlay.querySelector('#btn-add-set').style.display = 'none';
    _wireSetRowEvents(overlay, 3);
    _checkResultReady(overlay, isPro10, isAdjust);
  });

  [1, 2].forEach(n => _wireSetRowEvents(overlay, n));
  if (thirdSetAdded) _wireSetRowEvents(overlay, 3);

  // Photo — shared handler for both camera and gallery inputs
  function _onPhotoChosen(file) {
    if (!file) return;
    selectedFile = file;
    overlay.dataset.hasPhoto = '1';
    overlay.querySelector('#photo-img').src = URL.createObjectURL(file);
    overlay.querySelector('#photo-preview').style.display = 'block';
    _checkResultReady(overlay, isPro10, isAdjust);
  }
  overlay.querySelector('#photo-camera').addEventListener('change', e => _onPhotoChosen(e.target.files?.[0]));
  overlay.querySelector('#photo-gallery').addEventListener('change', e => _onPhotoChosen(e.target.files?.[0]));

  overlay.querySelector('#btn-remove-photo').addEventListener('click', () => {
    selectedFile = null;
    delete overlay.dataset.hasPhoto;
    overlay.querySelector('#photo-camera').value = '';
    overlay.querySelector('#photo-gallery').value = '';
    overlay.querySelector('#photo-preview').style.display = 'none';
    _checkResultReady(overlay, isPro10, isAdjust);
  });

  _checkResultReady(overlay, isPro10, isAdjust);

  // Submit
  overlay.querySelector('#btn-submit-result').addEventListener('click', async () => {
    const incompleteWinner = overlay.dataset.incompleteWinner;
    const derivedWinner = incompleteWinner || _deriveWinner(overlay, isPro10);
    if (!derivedWinner) return;
    if (!isAdjust && !selectedFile && !incompleteWinner) return;

    const btn = overlay.querySelector('#btn-submit-result');
    btn.disabled = true;
    overlay.querySelector('#submit-status').style.display = 'block';

    const winnerIsMe = derivedWinner === 'me';
    const winnerUid  = winnerIsMe ? myUid : opUid;
    const loserUid   = winnerIsMe ? opUid : myUid;

    let resultData;
    if (isPro10) {
      const me  = parseInt(overlay.querySelector('#score-me').value, 10);
      const opp = parseInt(overlay.querySelector('#score-op').value, 10);
      resultData = {
        winner: winnerUid, loser: loserUid,
        score: isMeA ? { a: me, b: opp } : { a: opp, b: me },
        enteredBy: myUid, enteredAt: Date.now(),
      };
    } else {
      const setCount = thirdSetAdded ? 3 : 2;
      const sets = incompleteWinner ? (_collectSets(overlay, setCount) || []) : _collectSets(overlay, setCount);
      if (!incompleteWinner && !sets) {
        btn.disabled = false;
        overlay.querySelector('#submit-status').style.display = 'none';
        return;
      }
      resultData = {
        winner: winnerUid, loser: loserUid,
        sets: (sets || []).map(s => {
          const base = isMeA ? { a: s.me, b: s.op } : { a: s.op, b: s.me };
          if (s.tbMe !== null && s.tbOp !== null) {
            base.tb = isMeA ? { a: s.tbMe, b: s.tbOp } : { a: s.tbOp, b: s.tbMe };
          }
          return base;
        }),
        enteredBy: myUid, enteredAt: Date.now(),
        ...(incompleteWinner ? { incomplete: true } : {}),
      };
    }

    try {
      const photoFile = selectedFile ? await _compressPhoto(selectedFile) : null;
      const photoUrl  = photoFile
        ? await uploadMatchPhoto(match.mid, photoFile)
        : (match.photoUrl || null);
      const prevEloDeltas = isAdjust ? (match.eloDeltas || null) : null;
      const resultFormat  = isPro10 ? 'pro10' : 'bo3';
      await _finalizeResult(match, resultData, photoUrl, resultFormat, sid, lid, allPlayers, prevEloDeltas);
      overlay.remove();
    } catch (err) {
      console.error('Submit result error:', err);
      btn.disabled = false;
      overlay.querySelector('#submit-status').style.display = 'none';
    }
  });
}

function _wireSetRowEvents(overlay, num) {
  const container = overlay.querySelector('#sets-container') || overlay.querySelector(`[data-set-row="${num}"]`)?.parentElement;
  if (!container) return;

  // Auto-show/hide tiebreak based on score inputs
  const row = container.querySelector(`[data-set-row="${num}"]`);
  if (row) {
    // Ensure hint element exists
    let hintEl = overlay.querySelector(`[data-hint-set="${num}"]`);
    if (!hintEl) {
      hintEl = document.createElement('div');
      hintEl.id = `hint-set-${num}`;
      hintEl.setAttribute('data-hint-set', String(num));
      hintEl.style.cssText = 'font-size:11px;color:var(--ace3);margin:2px 0 6px 58px;display:none;';
      hintEl.textContent = 'Invalid score · valid sets: 6-x, 7-5, 7-6';
      row.insertAdjacentElement('afterend', hintEl);
    }

    const updateTb = () => {
      const me    = parseInt(row.querySelector('[data-score="me"]')?.value ?? '', 10);
      const op    = parseInt(row.querySelector('[data-score="op"]')?.value ?? '', 10);
      const tbRow = row.querySelector(`[data-tb-row="${num}"]`);
      if (tbRow) {
        const needs = _needsTiebreak(me, op);
        if (needs && tbRow.style.display === 'none') {
          tbRow.style.display = 'flex';
        } else if (!needs && tbRow.style.display !== 'none') {
          tbRow.style.display = 'none';
          tbRow.querySelectorAll('input').forEach(i => { i.value = ''; });
        }
      }
      // Invalid score hint
      const meVal = row.querySelector('[data-score="me"]')?.value ?? '';
      const opVal = row.querySelector('[data-score="op"]')?.value ?? '';
      const bothFilled = meVal !== '' && opVal !== '';
      if (bothFilled && !_isValidTennisSet(me, op)) {
        hintEl.style.display = '';
      } else {
        hintEl.style.display = 'none';
      }
      // Auto 3rd set (only for set rows 1 and 2)
      if (num === 1 || num === 2) {
        _checkAutoThirdSet(overlay);
      }
    };
    row.querySelectorAll('[data-score]').forEach(input => input.addEventListener('input', updateTb));

    // Wire tiebreak hint
    const tbRow = row.querySelector(`[data-tb-row="${num}"]`);
    if (tbRow) {
      let tbHintEl = overlay.querySelector(`[data-hint-tb="${num}"]`);
      if (!tbHintEl) {
        tbHintEl = document.createElement('div');
        tbHintEl.setAttribute('data-hint-tb', String(num));
        tbHintEl.style.cssText = 'font-size:11px;color:var(--ace3);margin:2px 0 6px 58px;display:none;';
        tbHintEl.textContent = 'Invalid tiebreak · must reach 7, win by 2 (e.g. 7-5, 10-8)';
        tbRow.insertAdjacentElement('afterend', tbHintEl);
      }
      const updateTbHint = () => {
        const meVal = tbRow.querySelector('[data-tb="me"]')?.value ?? '';
        const opVal = tbRow.querySelector('[data-tb="op"]')?.value ?? '';
        const tbMe  = parseInt(meVal, 10);
        const tbOp  = parseInt(opVal, 10);
        if (meVal !== '' && opVal !== '' && !_isValidTiebreak(tbMe, tbOp)) {
          tbHintEl.style.display = '';
        } else {
          tbHintEl.style.display = 'none';
        }
      };
      tbRow.querySelectorAll('[data-tb]').forEach(input => input.addEventListener('input', updateTbHint));
    }
  }

  // Remove set button (3rd set only)
  const removeBtn = container.querySelector(`[data-remove-set="${num}"]`);
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      const setRow = container.querySelector(`[data-set-row="${num}"]`);
      if (setRow) setRow.remove();
      const addBtn = overlay.querySelector('#btn-add-set');
      if (addBtn) addBtn.style.display = '';
      // thirdSetAdded is in outer closure — reset via event
      const event = new CustomEvent('third-set-removed');
      overlay.dispatchEvent(event);
    });
  }
}

function _checkAutoThirdSet(overlay) {
  const c = overlay.querySelector('#sets-container') || overlay;
  const row1 = c.querySelector('[data-set-row="1"]');
  const row2 = c.querySelector('[data-set-row="2"]');
  if (!row1 || !row2) return;
  const me1 = parseInt(row1.querySelector('[data-score="me"]')?.value ?? '', 10);
  const op1 = parseInt(row1.querySelector('[data-score="op"]')?.value ?? '', 10);
  const me2 = parseInt(row2.querySelector('[data-score="me"]')?.value ?? '', 10);
  const op2 = parseInt(row2.querySelector('[data-score="op"]')?.value ?? '', 10);
  if (!_isValidTennisSet(me1, op1) || !_isValidTennisSet(me2, op2)) return;
  const iWonSet1 = me1 > op1;
  const iWonSet2 = me2 > op2;
  if (iWonSet1 === iWonSet2) return; // both sets same winner — no split, no 3rd set needed
  const addBtn = overlay.querySelector('#btn-add-set');
  if (addBtn && addBtn.style.display !== 'none') {
    addBtn.click();
  }
}

function _setRowWithPrefill(num, removable, prev, isMeA) {
  if (!prev?.sets) return _setRow(num, removable);
  const s = prev.sets[num - 1];
  if (!s) return _setRow(num, removable);
  const me = isMeA ? s.a : s.b;
  const op = isMeA ? s.b : s.a;
  const tb = s.tb ? { me: isMeA ? s.tb.a : s.tb.b, op: isMeA ? s.tb.b : s.tb.a } : null;
  return _setRow(num, removable, { me, op, tbMe: tb?.me ?? null, tbOp: tb?.op ?? null });
}

function _setRow(num, removable = false, prefill = null) {
  const me   = prefill?.me ?? '';
  const op   = prefill?.op ?? '';
  const tbMe = prefill?.tbMe ?? '';
  const tbOp = prefill?.tbOp ?? '';
  const showTb = prefill?.tbMe !== undefined && prefill?.tbMe !== null;
  return `
    <div data-set-row="${num}">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:2px;">
        <span class="t-label t-muted" style="width:48px;flex-shrink:0;">Set ${num}</span>
        <input type="number" class="input" data-score="me"
          min="0" max="7" inputmode="numeric" placeholder="You" value="${escHtml(String(me))}"
          style="flex:1;text-align:center;height:44px;padding:8px 4px;">
        <span style="color:var(--text3);font-size:16px;">–</span>
        <input type="number" class="input" data-score="op"
          min="0" max="7" inputmode="numeric" placeholder="Opp" value="${escHtml(String(op))}"
          style="flex:1;text-align:center;height:44px;padding:8px 4px;">
        ${removable
          ? `<button type="button" data-remove-set="${num}" aria-label="Remove set 3"
               style="background:none;border:none;cursor:pointer;padding:4px;color:var(--text3);
                      display:flex;align-items:center;flex-shrink:0;">
               <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" stroke-linecap="round">
                 <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
               </svg>
             </button>`
          : '<div style="width:24px;flex-shrink:0;"></div>'}
      </div>
      <div data-tb-row="${num}" style="display:${showTb ? 'flex' : 'none'};
        align-items:center;gap:10px;padding:4px 0 8px;margin-left:58px;">
        <span class="t-label t-muted" style="width:24px;flex-shrink:0;font-size:10px;">TB</span>
        <input type="number" class="input" data-tb="me"
          min="0" inputmode="numeric" placeholder="You" value="${escHtml(String(tbMe))}"
          style="flex:1;text-align:center;height:38px;padding:6px 4px;font-size:15px;">
        <span style="color:var(--text3);font-size:14px;">–</span>
        <input type="number" class="input" data-tb="op"
          min="0" inputmode="numeric" placeholder="Opp" value="${escHtml(String(tbOp))}"
          style="flex:1;text-align:center;height:38px;padding:6px 4px;font-size:15px;">
        <div style="width:24px;flex-shrink:0;"></div>
      </div>
    </div>
  `;
}

function _deriveWinner(overlay, isPro10) {
  if (isPro10) {
    const c  = overlay.querySelector('#section-pro10') || overlay;
    const me = parseInt(c.querySelector('#score-me')?.value ?? '', 10);
    const op = parseInt(c.querySelector('#score-op')?.value ?? '', 10);
    if (isNaN(me) || isNaN(op) || me === op) return null;
    if (me < 0 || me > 10 || op < 0 || op > 10) return null;
    return me > op ? 'me' : 'op';
  }
  const c    = overlay.querySelector('#section-bo3') || overlay;
  const rows = c.querySelectorAll('[data-set-row]');
  if (!rows.length) return null;
  let meWins = 0, opWins = 0;
  for (const row of rows) {
    const me = parseInt(row.querySelector('[data-score="me"]')?.value ?? '', 10);
    const op = parseInt(row.querySelector('[data-score="op"]')?.value ?? '', 10);
    if (isNaN(me) || isNaN(op)) return null;
    if (!_isValidTennisSet(me, op)) return null;
    if (me > op) meWins++;
    else if (op > me) opWins++;
    else return null;
  }
  if (meWins === opWins) return null;
  return meWins > opWins ? 'me' : 'op';
}

function _checkResultReady(overlay, isPro10, isAdjust) {
  const hasPhoto = isAdjust || !!overlay.dataset.hasPhoto;
  const winner   = _deriveWinner(overlay, isPro10);
  const incompleteWinner = overlay.dataset.incompleteWinner;
  const effectiveWinner = winner || (incompleteWinner ? incompleteWinner : null);

  // Tiebreak inputs must be filled when visible (bo3 mode)
  let tbReady = true;
  if (!isPro10) {
    const c = overlay.querySelector('#section-bo3') || overlay;
    c.querySelectorAll('[data-tb-row]').forEach(tbRow => {
      if (tbRow.style.display !== 'none') {
        const v1 = parseInt(tbRow.querySelector('[data-tb="me"]')?.value ?? '', 10);
        const v2 = parseInt(tbRow.querySelector('[data-tb="op"]')?.value ?? '', 10);
        if (isNaN(v1) || isNaN(v2) || !_isValidTiebreak(v1, v2)) tbReady = false;
      }
    });
  }

  const display = overlay.querySelector('#winner-display');
  if (display) {
    if (effectiveWinner === 'me') {
      display.textContent       = 'You win';
      display.style.color       = 'var(--ace2)';
      display.style.background  = 'rgba(34,197,94,.1)';
      display.style.display     = 'block';
    } else if (effectiveWinner === 'op') {
      const opName = display.dataset.opName || 'Opponent';
      display.textContent       = `${opName} wins`;
      display.style.color       = 'var(--text)';
      display.style.background  = 'var(--surface2)';
      display.style.display     = 'block';
    } else {
      display.style.display = 'none';
    }
  }

  overlay.querySelector('#btn-submit-result').disabled =
    !(effectiveWinner !== null && (hasPhoto || !!incompleteWinner) && tbReady);
}

function _collectSets(overlay, count) {
  const c    = overlay.querySelector('#section-bo3') || overlay;
  const sets = [];
  for (let i = 1; i <= count; i++) {
    const row = c.querySelector(`[data-set-row="${i}"]`);
    if (!row) break;
    const me = parseInt(row.querySelector('[data-score="me"]').value, 10);
    const op = parseInt(row.querySelector('[data-score="op"]').value, 10);
    if (isNaN(me) || isNaN(op) || !_isValidTennisSet(me, op)) return null;
    const entry = { me, op, tbMe: null, tbOp: null };
    const tbRow = row.querySelector(`[data-tb-row="${i}"]`);
    if (tbRow && tbRow.style.display !== 'none') {
      const tbMe = parseInt(tbRow.querySelector('[data-tb="me"]')?.value ?? '', 10);
      const tbOp = parseInt(tbRow.querySelector('[data-tb="op"]')?.value ?? '', 10);
      if (!isNaN(tbMe) && !isNaN(tbOp)) { entry.tbMe = tbMe; entry.tbOp = tbOp; }
      else return null; // tiebreak shown but incomplete
    }
    sets.push(entry);
  }
  return sets.length ? sets : null;
}

// ─── Confirm result modal ─────────────────────────────────────────────────────

function _showConfirmResultModal(match, myUid, allPlayers, sid, lid) {
  const opUid   = match.playerA === myUid ? match.playerB : match.playerA;
  const op      = allPlayers[opUid] || { name: 'Unknown' };
  const isMeA   = match.playerA === myUid;
  const score   = _formatScore(match.result, isMeA);
  const theyWon = match.result?.winner === opUid;

  const overlay = _createOverlay();
  overlay.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:0 0 16px;">
        <div style="font-size:16px;font-weight:700;">Confirm Result</div>
        <button class="btn-icon" id="btn-close">${_closeIcon()}</button>
      </div>

      <div class="card" style="text-align:center;margin-bottom:20px;">
        <p class="t-small t-muted" style="margin-bottom:10px;">
          ${escHtml(op.alias || op.name)} entered this result:
        </p>
        <div style="font-family:var(--font-mono);font-size:24px;font-weight:700;
          margin-bottom:10px;letter-spacing:1px;">
          ${escHtml(score || '—')}
        </div>
        <div class="badge ${theyWon ? 'badge-muted' : 'badge-teal'}" style="font-size:13px;">
          ${theyWon ? escHtml(op.alias || op.name) + ' won' : 'You won'}
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:10px;padding-bottom:8px;">
        <button class="btn btn-primary" id="btn-agree">
          Yes, this is correct ✓
        </button>
        <button class="btn btn-surface" id="btn-dispute"
          style="color:var(--ace3);border-color:var(--ace3);">
          Dispute result
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.querySelector('#btn-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#btn-agree').addEventListener('click', async () => {
    const btn = overlay.querySelector('#btn-agree');
    btn.disabled = true;
    btn.textContent = 'Confirming…';
    try {
      await dbMultiUpdate({
        [`seasons/${sid}/leagues/${lid}/matches/${match.mid}/status`]:              'photo_pending',
        [`seasons/${sid}/leagues/${lid}/matches/${match.mid}/result/confirmedBy`]:  myUid,
        [`seasons/${sid}/leagues/${lid}/matches/${match.mid}/result/confirmedAt`]:  Date.now(),
      });
      overlay.remove();
    } catch (err) {
      console.error('Confirm error:', err);
      btn.disabled = false;
      btn.textContent = 'Yes, this is correct ✓';
    }
  });

  overlay.querySelector('#btn-dispute').addEventListener('click', () => {
    overlay.remove();
    _showDisputeModal(match, myUid, allPlayers, sid, lid);
  });
}

// ─── Dispute modal ────────────────────────────────────────────────────────────

function _showDisputeModal(match, myUid, allPlayers, sid, lid) {
  const opUid = match.playerA === myUid ? match.playerB : match.playerA;
  const op    = allPlayers[opUid] || { alias: 'them' };

  const overlay = _createOverlay();
  overlay.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:0 0 16px;">
        <div style="font-size:16px;font-weight:700;">Dispute Result</div>
        <button class="btn-icon" id="btn-close">${_closeIcon()}</button>
      </div>
      <div class="card" style="margin-bottom:20px;border-left:3px solid var(--ace3);">
        <p class="t-small" style="line-height:1.6;">
          This will reset the match back to <strong>Scheduled</strong> so either player can
          re-enter the correct scores.
          ${escHtml(op.alias || 'Your opponent')} will see the result was cleared.
        </p>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;padding-bottom:8px;">
        <button class="btn btn-primary" id="btn-confirm-dispute"
          style="background:var(--ace3);">
          Yes, reset this match
        </button>
        <button class="btn btn-ghost" id="btn-cancel">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.querySelector('#btn-close').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#btn-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#btn-confirm-dispute').addEventListener('click', async () => {
    const btn = overlay.querySelector('#btn-confirm-dispute');
    btn.disabled = true;
    btn.textContent = 'Resetting…';
    try {
      await dbMultiUpdate({
        [`seasons/${sid}/leagues/${lid}/matches/${match.mid}/status`]: 'scheduled',
        [`seasons/${sid}/leagues/${lid}/matches/${match.mid}/result`]: null,
      });
      overlay.remove();
    } catch (err) {
      console.error('Dispute error:', err);
      btn.disabled = false;
      btn.textContent = 'Yes, reset this match';
    }
  });
}

// ─── Upload photo modal + ELO update ─────────────────────────────────────────

function _showUploadPhotoModal(match, myUid, allPlayers, sid, lid) {
  const overlay = _createOverlay();
  overlay.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:0 0 16px;">
        <div style="font-size:16px;font-weight:700;">Upload Match Photo</div>
        <button class="btn-icon" id="btn-close">${_closeIcon()}</button>
      </div>

      <div style="text-align:center;padding:8px 0 16px;">
        <img src="${BASE}images/atp-match-confirmed.png"
          style="width:120px;height:auto;opacity:.8;margin:0 auto 12px;">
        <p class="t-small t-muted" style="line-height:1.5;max-width:260px;margin:0 auto;">
          Upload a photo of the score sheet or court.
          ELO ratings update immediately after confirmation.
        </p>
      </div>

      <div id="photo-preview" style="display:none;margin-bottom:16px;text-align:center;">
        <img id="photo-img" style="max-width:100%;max-height:180px;border-radius:10px;
          object-fit:cover;border:2px solid var(--border);">
      </div>

      <div style="display:flex;flex-direction:column;gap:10px;padding-bottom:8px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <label class="btn btn-surface"
            style="cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
            📷 Camera
            <input type="file" id="photo-camera" accept="image/*" capture="environment"
              style="display:none;">
          </label>
          <label class="btn btn-surface"
            style="cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
            🖼 Gallery
            <input type="file" id="photo-gallery" accept="image/*"
              style="display:none;">
          </label>
        </div>
        <button class="btn btn-primary" id="btn-upload" disabled>
          Confirm &amp; Update ELO
        </button>
        <button class="btn btn-ghost btn-sm" id="btn-skip"
          style="color:var(--text3);">
          Skip — admin will confirm
        </button>
      </div>

      <div id="upload-status" style="display:none;text-align:center;padding:12px 0;">
        <div class="spinner" style="margin:0 auto 8px;"></div>
        <p class="t-small t-muted">Uploading and updating ratings…</p>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.querySelector('#btn-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  let selectedFile = null;

  function _onAdjustPhotoChosen(file) {
    if (!file) return;
    selectedFile = file;
    overlay.querySelector('#photo-img').src = URL.createObjectURL(file);
    overlay.querySelector('#photo-preview').style.display = 'block';
    overlay.querySelector('#btn-upload').disabled = false;
  }
  overlay.querySelector('#photo-camera').addEventListener('change', e => _onAdjustPhotoChosen(e.target.files?.[0]));
  overlay.querySelector('#photo-gallery').addEventListener('change', e => _onAdjustPhotoChosen(e.target.files?.[0]));

  overlay.querySelector('#btn-upload').addEventListener('click', async () => {
    if (!selectedFile) return;
    _setUploadingState(overlay, true);
    try {
      const compressed = await _compressPhoto(selectedFile);
      const photoUrl = await uploadMatchPhoto(match.mid, compressed);
      await _confirmMatchWithElo(match, photoUrl, sid, lid, allPlayers);
      overlay.remove();
    } catch (err) {
      console.error('Upload error:', err);
      _setUploadingState(overlay, false);
    }
  });

  overlay.querySelector('#btn-skip').addEventListener('click', async () => {
    _setUploadingState(overlay, true);
    try {
      await _confirmMatchWithElo(match, null, sid, lid, allPlayers);
      overlay.remove();
    } catch (err) {
      console.error('Confirm error:', err);
      _setUploadingState(overlay, false);
    }
  });
}

function _setUploadingState(overlay, loading) {
  overlay.querySelector('#upload-status').style.display = loading ? 'block' : 'none';
  ['#btn-upload', '#btn-skip'].forEach(sel => {
    const el = overlay.querySelector(sel);
    if (el) el.disabled = loading;
  });
}

async function _finalizeResult(match, resultData, photoUrl, format, sid, lid, allPlayers, prevEloDeltas) {
  const uidA = match.playerA;
  const uidB = match.playerB;

  const [ratingA, ratingB, histA, histB] = await Promise.all([
    dbGet(pRef(uidA, 'eloRating')),
    dbGet(pRef(uidB, 'eloRating')),
    dbGet(pRef(uidA, 'eloHistory')),
    dbGet(pRef(uidB, 'eloHistory')),
  ]);

  // Start from current ratings, reverting old deltas if this is an adjustment
  let ra = ratingA || 1000;
  let rb = ratingB || 1000;
  if (prevEloDeltas) {
    ra -= (prevEloDeltas[uidA] || 0);
    rb -= (prevEloDeltas[uidB] || 0);
  }

  const winner  = resultData.winner === uidA ? 'a' : 'b';
  const elo     = calculateElo(ra, rb, winner, 32);
  const now     = Date.now();

  // ELO history: remove old entry for this match (if adjusting), append new
  const newHistA = [...(histA || []).filter(h => h.match !== match.mid),
    { delta: elo.deltaA, match: match.mid, ts: now }];
  const newHistB = [...(histB || []).filter(h => h.match !== match.mid),
    { delta: elo.deltaB, match: match.mid, ts: now }];

  await dbMultiUpdate({
    [`seasons/${sid}/leagues/${lid}/matches/${match.mid}/status`]:      'confirmed',
    [`seasons/${sid}/leagues/${lid}/matches/${match.mid}/result`]:      resultData,
    [`seasons/${sid}/leagues/${lid}/matches/${match.mid}/photoUrl`]:    photoUrl,
    [`seasons/${sid}/leagues/${lid}/matches/${match.mid}/format`]:      format || match.format || null,
    [`seasons/${sid}/leagues/${lid}/matches/${match.mid}/confirmedAt`]: now,
    [`seasons/${sid}/leagues/${lid}/matches/${match.mid}/confirmedBy`]: 'player',
    [`seasons/${sid}/leagues/${lid}/matches/${match.mid}/eloDeltas`]:   {
      [uidA]: elo.deltaA,
      [uidB]: elo.deltaB,
    },
    [`players/${uidA}/eloRating`]:  elo.newRatingA,
    [`players/${uidB}/eloRating`]:  elo.newRatingB,
    [`players/${uidA}/eloHistory`]: newHistA,
    [`players/${uidB}/eloHistory`]: newHistB,
  });
  writeActivity('match_confirmed', { sid, lid, mid: match.mid, playerA: uidA, playerB: uidB, winnerId: resultData.winner });
}

async function _confirmMatchWithElo(match, photoUrl, sid, lid, allPlayers) {
  return _finalizeResult(match, match.result, photoUrl, match.format || null, sid, lid, allPlayers, null);
}

// ─── Match detail modal ───────────────────────────────────────────────────────

function _showMatchDetailModal(match, allPlayers, myUid) {
  document.querySelector('.modal-overlay.match-detail-modal')?.remove();

  const aUid = match.playerA;
  const bUid = match.playerB;
  const pA   = allPlayers[aUid] || {};
  const pB   = allPlayers[bUid] || {};
  const sets = match.result?.sets || [];
  const winner = match.result?.winner;
  const loser  = match.result?.loser;

  const when = match.confirmedAt
    ? new Date(match.confirmedAt).toLocaleString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '';

  function playerBlock(uid, p) {
    const isMe  = uid === myUid;
    const won   = uid === winner;
    return `
      <div style="flex:1;text-align:center;">
        ${avatarToSvg(p.avatarId || null, 48)}
        <div style="font-weight:${won ? '700' : '400'};font-size:14px;margin-top:6px;
          color:${isMe ? 'var(--ace)' : won ? 'var(--ace2)' : 'var(--text)'};">
          ${isMe ? 'You' : escHtml(p.alias || p.name || uid)}
        </div>
        ${won ? `<span class="badge badge-teal" style="font-size:10px;margin-top:3px;">Winner</span>` : ''}
      </div>
    `;
  }

  const setRows = sets.map((s, i) => {
    const aScore = s.a ?? 0;
    const bScore = s.b ?? 0;
    const aWon   = aScore > bScore;
    const isTb   = s.tb !== undefined;
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 0;
        border-bottom:1px solid var(--border);font-family:var(--font-mono);">
        <div style="flex:1;text-align:center;font-size:20px;font-weight:${aWon ? '800' : '400'};
          color:${aWon ? 'var(--text)' : 'var(--text3)'};">${aScore}</div>
        <div style="font-size:10px;color:var(--text3);min-width:36px;text-align:center;">
          Set ${i + 1}${isTb ? ' TB' : ''}
        </div>
        <div style="flex:1;text-align:center;font-size:20px;font-weight:${!aWon ? '800' : '400'};
          color:${!aWon ? 'var(--text)' : 'var(--text3)'};">${bScore}</div>
      </div>
    `;
  }).join('');

  const eloA = match.eloDeltas?.[aUid];
  const eloB = match.eloDeltas?.[bUid];

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay match-detail-modal';
  overlay.innerHTML = `
    <div class="modal-sheet">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <h2 class="t-h2" style="margin:0;">Match Details</h2>
        <button id="btn-close-match-detail" class="btn btn-ghost btn-sm" style="width:auto;padding:4px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:16px;">
        ${playerBlock(aUid, pA)}
        <div style="padding-top:14px;color:var(--text3);font-size:12px;">vs</div>
        ${playerBlock(bUid, pB)}
      </div>

      ${sets.length > 0 ? `
        <div class="t-label t-muted" style="margin-bottom:4px;">Score</div>
        <div style="margin-bottom:14px;">${setRows}</div>
      ` : ''}

      ${(eloA !== undefined || eloB !== undefined) ? `
        <div class="t-label t-muted" style="margin-bottom:6px;">ELO Changes</div>
        <div style="display:flex;gap:12px;margin-bottom:14px;">
          ${eloA !== undefined ? `
            <div style="flex:1;background:var(--surface2);border-radius:var(--radius);padding:10px;text-align:center;">
              <div style="font-family:var(--font-mono);font-size:18px;font-weight:700;
                color:${eloA >= 0 ? 'var(--ace2)' : 'var(--ace3)'};">
                ${eloA >= 0 ? '+' : ''}${eloA}
              </div>
              <div class="t-small t-muted">${aUid === myUid ? 'You' : escHtml(pA.alias || pA.name || '')}</div>
            </div>` : ''}
          ${eloB !== undefined ? `
            <div style="flex:1;background:var(--surface2);border-radius:var(--radius);padding:10px;text-align:center;">
              <div style="font-family:var(--font-mono);font-size:18px;font-weight:700;
                color:${eloB >= 0 ? 'var(--ace2)' : 'var(--ace3)'};">
                ${eloB >= 0 ? '+' : ''}${eloB}
              </div>
              <div class="t-small t-muted">${bUid === myUid ? 'You' : escHtml(pB.alias || pB.name || '')}</div>
            </div>` : ''}
        </div>
      ` : ''}

      ${match.photoUrl ? `
        <div class="t-label t-muted" style="margin-bottom:6px;">Photo</div>
        <img src="${escHtml(match.photoUrl)}" alt="Match photo"
          style="width:100%;border-radius:var(--radius);object-fit:cover;max-height:220px;
            margin-bottom:14px;" loading="lazy">
      ` : ''}

      ${when ? `<div class="t-small t-muted" style="text-align:center;">${when}</div>` : ''}
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.querySelector('#btn-close-match-detail').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

// ─── Forfeit modal ────────────────────────────────────────────────────────────

function _showForfeitModal(match, myUid, allPlayers, sid, lid) {
  const opUid = match.playerA === myUid ? match.playerB : match.playerA;
  const op    = allPlayers[opUid] || { name: 'Unknown', alias: opUid };
  const overlay = _createOverlay();

  overlay.innerHTML = `
    <div class="modal-sheet" style="max-width:360px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h2 class="t-h2" style="margin:0;">Forfeit match?</h2>
        <button id="btn-close-forfeit" class="btn btn-ghost btn-sm" style="width:auto;padding:4px;">
          ${_closeIcon()}
        </button>
      </div>
      <p class="t-small" style="color:var(--text2);margin-bottom:8px;">
        You are about to forfeit your group match against
        <strong>${escHtml(op.alias || op.name)}</strong>.
      </p>
      <p class="t-small" style="color:var(--ace3);margin-bottom:20px;">
        You will lose 1 group point and your opponent will gain 2.
        This cannot be undone.
      </p>
      <button class="btn btn-primary" id="btn-confirm-forfeit"
        style="background:var(--ace3);border-color:var(--ace3);width:100%;">
        Confirm Forfeit
      </button>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#btn-close-forfeit').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#btn-confirm-forfeit').addEventListener('click', async () => {
    const btn = overlay.querySelector('#btn-confirm-forfeit');
    btn.disabled = true;
    btn.textContent = 'Forfeiting…';
    try {
      await dbMultiUpdate({
        [`seasons/${sid}/leagues/${lid}/matches/${match.mid}/forfeited`]: myUid,
      });
      overlay.remove();
    } catch {
      btn.disabled = false;
      btn.textContent = 'Confirm Forfeit';
    }
  });
}

// ─── Empty / error states ─────────────────────────────────────────────────────

function _renderNoLeague(el) {
  el.innerHTML = `
    <div class="empty-state" style="padding-top:40px;">
      <div class="empty-state-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="2" x2="22" y1="12" y2="12"/>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10
            15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        </svg>
      </div>
      <div class="empty-state-title">Not in a league yet</div>
      <p class="t-small t-muted" style="max-width:240px;">
        The commissioner will assign you to a league once the season is configured.
      </p>
    </div>
  `;
}

function _renderError(el) {
  el.innerHTML = `
    <div class="empty-state" style="padding-top:40px;">
      <div class="empty-state-title">Could not load matches</div>
      <p class="t-small t-muted">Check your connection and refresh.</p>
    </div>
  `;
}

// ─── Shared UI helpers ────────────────────────────────────────────────────────

function _createOverlay() {
  const el = document.createElement('div');
  el.className = 'modal-overlay';
  return el;
}

function _closeIcon() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
  </svg>`;
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

// ─── Accept / Cancel / Edit proposal modals ────────────────────────────────────

function _showAcceptChallengeModal(match, myUid, allPlayers, existingMatches, sid, lid) {
  const op = allPlayers[match.playerA] || { name: 'Unknown', alias: match.playerA };
  const matchCount = Object.values(existingMatches || {}).filter(m => {
    const inv = (m.playerA === myUid && m.playerB === match.playerA)
             || (m.playerA === match.playerA && m.playerB === myUid);
    return inv && ['scheduled','result_pending','photo_pending','confirmed'].includes(m.status);
  }).length;
  const atCap = matchCount >= 2;

  const overlay = _createOverlay();
  overlay.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:0 0 16px;">
        <div style="font-size:16px;font-weight:700;">Accept Challenge</div>
        <button class="btn-icon" id="btn-close">${_closeIcon()}</button>
      </div>
      ${atCap ? `
        <div class="card" style="border-left:3px solid var(--ace3);background:rgba(190,30,30,.05);">
          <p class="t-small" style="color:var(--ace3);">
            You already have 2 matches against ${escHtml(op.alias || op.name)}.
            You cannot accept another.
          </p>
        </div>
      ` : `
        <p class="t-small t-muted" style="margin-bottom:20px;">
          Accept the open challenge from <strong>${escHtml(op.alias || op.name)}</strong>?
          You will be matched up for a ranked game.
        </p>
        <button class="btn btn-primary" id="btn-confirm-accept">Accept Challenge</button>
      `}
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.querySelector('#btn-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  if (atCap) return;

  overlay.querySelector('#btn-confirm-accept').addEventListener('click', async () => {
    const btn = overlay.querySelector('#btn-confirm-accept');
    btn.disabled = true; btn.textContent = 'Accepting…';
    try {
      await dbMultiUpdate({
        [`seasons/${sid}/leagues/${lid}/matches/${match.mid}/playerB`]:    myUid,
        [`seasons/${sid}/leagues/${lid}/matches/${match.mid}/status`]:     'scheduled',
        [`seasons/${sid}/leagues/${lid}/matches/${match.mid}/acceptedBy`]: myUid,
        [`seasons/${sid}/leagues/${lid}/matches/${match.mid}/acceptedAt`]: Date.now(),
      });
      overlay.remove();
    } catch (err) {
      console.error('Accept error:', err);
      btn.disabled = false; btn.textContent = 'Accept Challenge';
    }
  });
}

function _showCancelProposalModal(match, myUid, sid, lid) {
  const isOpen = match.status === 'open_challenge';
  const overlay = _createOverlay();
  overlay.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:0 0 16px;">
        <div style="font-size:16px;font-weight:700;">${isOpen ? 'Cancel Challenge' : 'Cancel Match'}</div>
        <button class="btn-icon" id="btn-close">${_closeIcon()}</button>
      </div>
      <p class="t-small t-muted" style="margin-bottom:20px;">
        ${isOpen
          ? 'This will remove your open challenge. Other players will no longer be able to accept it.'
          : 'This will cancel the proposed match.'}
      </p>
      <div style="display:flex;flex-direction:column;gap:10px;padding-bottom:8px;">
        <button class="btn btn-primary" id="btn-confirm-cancel"
          style="background:var(--ace3);border-color:var(--ace3);">Yes, cancel</button>
        <button class="btn btn-ghost" id="btn-keep">Keep it</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.querySelector('#btn-close').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#btn-keep').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#btn-confirm-cancel').addEventListener('click', async () => {
    const btn = overlay.querySelector('#btn-confirm-cancel');
    btn.disabled = true; btn.textContent = 'Cancelling…';
    try {
      await dbMultiUpdate({ [`seasons/${sid}/leagues/${lid}/matches/${match.mid}`]: null });
      overlay.remove();
    } catch (err) {
      console.error('Cancel error:', err);
      btn.disabled = false; btn.textContent = 'Yes, cancel';
    }
  });
}

function _showEditProposalModal(match, myUid, sid, lid) {
  const current = match.scheduledAt ? tsToLocalInput(match.scheduledAt) : '';
  const overlay = _createOverlay();
  overlay.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:0 0 16px;">
        <div style="font-size:16px;font-weight:700;">Reschedule Match</div>
        <button class="btn-icon" id="btn-close">${_closeIcon()}</button>
      </div>
      <div style="margin-bottom:20px;">
        <div class="t-label t-muted" style="margin-bottom:8px;">Suggested date &amp; time</div>
        <input class="input" id="edit-date" type="datetime-local"
          value="${current}"
          min="${tsToLocalInput(Date.now() + 60000)}"
          style="font-size:14px;">
      </div>
      <button class="btn btn-primary" id="btn-save-time">Save</button>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.querySelector('#btn-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#btn-save-time').addEventListener('click', async () => {
    const btn = overlay.querySelector('#btn-save-time');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const val = overlay.querySelector('#edit-date').value;
      const scheduledAt = localInputToTs(val);
      await dbMultiUpdate({
        [`seasons/${sid}/leagues/${lid}/matches/${match.mid}/scheduledAt`]: scheduledAt,
      });
      writeActivity('match_rescheduled', {
        sid, lid, mid: match.mid,
        changedBy: myUid,
        playerA: match.playerA,
        playerB: match.playerB,
        oldScheduledAt: match.scheduledAt || null,
        newScheduledAt: scheduledAt,
      });
      overlay.remove();
    } catch (err) {
      console.error('Edit proposal error:', err);
      btn.disabled = false; btn.textContent = 'Save';
    }
  });
}

function _showEditOpenChallengeModal(match, myUid, allPlayers, memberUids, sid, lid) {
  const current = match.scheduledAt ? tsToLocalInput(match.scheduledAt) : '';
  const opponentOptions = memberUids
    .filter(uid => uid !== myUid)
    .map(uid => {
      const p = allPlayers[uid] || {};
      return `<option value="${escHtml(uid)}">${escHtml(p.alias || p.name || uid)}</option>`;
    })
    .join('');

  const overlay = _createOverlay();
  overlay.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:0 0 16px;">
        <div style="font-size:16px;font-weight:700;">Edit Open Challenge</div>
        <button class="btn-icon" id="btn-close">${_closeIcon()}</button>
      </div>
      <div style="margin-bottom:16px;">
        <div class="t-label t-muted" style="margin-bottom:8px;">Suggested date &amp; time</div>
        <input class="input" id="oc-date" type="datetime-local"
          value="${current}"
          min="${tsToLocalInput(Date.now() + 60000)}"
          style="font-size:14px;">
      </div>
      <div style="margin-bottom:20px;">
        <div class="t-label t-muted" style="margin-bottom:8px;">Opponent</div>
        <select class="input" id="oc-opponent" style="font-size:14px;">
          <option value="">Keep open (no specific opponent)</option>
          ${opponentOptions}
        </select>
        <p class="t-small t-muted" style="margin:6px 0 0;">
          Selecting an opponent converts this into a direct challenge.
        </p>
      </div>
      <button class="btn btn-primary" id="btn-save-oc">Save</button>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.querySelector('#btn-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#btn-save-oc').addEventListener('click', async () => {
    const btn = overlay.querySelector('#btn-save-oc');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const val = overlay.querySelector('#oc-date').value;
      const scheduledAt = localInputToTs(val);
      const opponentUid = overlay.querySelector('#oc-opponent').value || null;
      const base = `seasons/${sid}/leagues/${lid}/matches/${match.mid}`;
      const updates = { [base + '/scheduledAt']: scheduledAt };
      if (opponentUid) {
        updates[base + '/playerB']  = opponentUid;
        updates[base + '/status']   = 'scheduled';
      }
      await dbMultiUpdate(updates);
      overlay.remove();
    } catch (err) {
      console.error('Edit open challenge error:', err);
      btn.disabled = false; btn.textContent = 'Save';
    }
  });
}
