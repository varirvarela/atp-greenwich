// src/player/matches.js — Phase 3: Match management
// Handles match proposals, result entry, confirmation, and photo upload.
// Match data: seasons/{sid}/leagues/{lid}/matches/{mid}
// Match status flow: scheduled → result_pending → photo_pending → confirmed

import { dbGet, dbRef, dbMultiUpdate, dbListen, dbPush, pRef, sRef, uploadMatchPhoto } from '@shared/firebase.js';
import { escHtml } from '@shared/utils.js';
import { calculateElo } from '@shared/elo.js';
import { avatarToSvg } from '@player/avatars.js';

const BASE = import.meta.env.BASE_URL;

// ─── Main entry point ─────────────────────────────────────────────────────────

export function renderMatchesTab(el, player, creds) {
  el.innerHTML = `<div style="padding:24px;text-align:center;">
    <div class="spinner" style="margin:0 auto 12px;"></div>
    <p class="t-small t-muted">Loading matches…</p>
  </div>`;

  let unsubscribe = null;

  (async () => {
    const ctx = await _loadLeagueContext(creds.uid);
    if (!ctx) { _renderNoLeague(el); return; }

    const { sid, lid, leagueName } = ctx;
    const [membersObj, allPlayers] = await Promise.all([
      dbGet(sRef(sid, lid, 'members')),
      dbGet(pRef()),
    ]);

    const memberUids = Object.keys(membersObj || {});

    unsubscribe = dbListen(sRef(sid, lid, 'matches'), (matchesObj) => {
      _renderMatchList(el, matchesObj || {}, creds.uid, allPlayers || {}, memberUids, sid, lid, leagueName);
    });
  })().catch(() => _renderError(el));

  return () => { if (unsubscribe) { unsubscribe(); unsubscribe = null; } };
}

// ─── League context loader ────────────────────────────────────────────────────

async function _loadLeagueContext(uid) {
  const sid = await dbGet(dbRef('config/defaultSeason'));
  if (!sid) return null;
  const leagues = await dbGet(sRef(sid, null, 'leagues'));
  if (!leagues) return null;
  for (const [lid, league] of Object.entries(leagues)) {
    const member = await dbGet(sRef(sid, lid, 'members/' + uid));
    if (member !== null) {
      return { sid, lid, leagueName: league.name || 'League' };
    }
  }
  return null;
}

// ─── Match list render ────────────────────────────────────────────────────────

function _renderMatchList(el, matchesObj, myUid, allPlayers, memberUids, sid, lid, leagueName) {
  const matches = Object.entries(matchesObj).map(([mid, m]) => ({ mid, ...m }));
  const mine    = matches.filter(m => m.playerA === myUid || m.playerB === myUid);

  const actionNeeded = mine.filter(m => _needsMyAction(m, myUid));
  const inProgress   = mine.filter(m => !_needsMyAction(m, myUid) && m.status !== 'confirmed');
  const completed    = mine
    .filter(m => m.status === 'confirmed')
    .sort((a, b) => (b.confirmedAt || 0) - (a.confirmedAt || 0))
    .slice(0, 10);

  const hasActiveMatches = actionNeeded.length || inProgress.length;

  el.innerHTML = `
    <div style="padding-bottom:100px;">
      <div style="display:flex;justify-content:space-between;align-items:center;
        padding:16px 0 8px;margin-bottom:4px;">
        <div class="badge badge-teal" style="font-size:11px;">${escHtml(leagueName)}</div>
      </div>

      ${actionNeeded.length ? `
        <div class="t-label t-muted" style="margin:12px 0 8px;">Needs your action</div>
        ${actionNeeded.map(m => _matchCard(m, myUid, allPlayers)).join('')}
      ` : ''}

      ${inProgress.length ? `
        <div class="t-label t-muted" style="margin:12px 0 8px;">In progress</div>
        ${inProgress.map(m => _matchCard(m, myUid, allPlayers)).join('')}
      ` : ''}

      ${!hasActiveMatches ? `
        <div style="text-align:center;padding:32px 0 0;">
          <img src="${BASE}images/atp-empty-matches.png"
            style="width:160px;height:auto;margin-bottom:16px;opacity:.85;">
          <div class="empty-state-title">No active matches</div>
          <p class="t-small t-muted" style="max-width:220px;margin:0 auto;">
            Propose a match against a league opponent to get started.
          </p>
        </div>
      ` : ''}

      ${completed.length ? `
        <div class="t-label t-muted" style="margin:20px 0 8px;">Recent results</div>
        ${completed.map(m => _matchCard(m, myUid, allPlayers)).join('')}
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

  el.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const { action, mid } = btn.dataset;
      const match = mine.find(m => m.mid === mid);
      if (!match) return;
      if (action === 'enter-result')   _showEnterResultModal(match, myUid, allPlayers, sid, lid);
      if (action === 'confirm-result') _showConfirmResultModal(match, myUid, allPlayers, sid, lid);
      if (action === 'upload-photo')   _showUploadPhotoModal(match, myUid, allPlayers, sid, lid);
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
  const opUid   = match.playerA === myUid ? match.playerB : match.playerA;
  const op      = allPlayers[opUid] || { name: 'Unknown', alias: opUid };
  const meData  = allPlayers[myUid];
  const isMeA   = match.playerA === myUid;

  const meAv = meData?.avatarId ? avatarToSvg(meData.avatarId, 36) : _defaultAv(36);
  const opAv = op.avatarId      ? avatarToSvg(op.avatarId, 36)     : _defaultAv(36);

  const score        = _formatScore(match.result, isMeA);
  const { badge, action } = _cardMeta(match, myUid);

  // ELO delta on confirmed matches
  let eloBadge = '';
  if (match.status === 'confirmed' && match.eloDeltas?.[myUid] !== undefined) {
    const d = match.eloDeltas[myUid];
    eloBadge = `<span class="t-label" style="font-family:var(--font-mono);font-size:10px;
      color:${d >= 0 ? 'var(--ace2)' : 'var(--ace3)'};">
      ${d >= 0 ? '+' : ''}${d} ELO
    </span>`;
  }

  const formatBadge = match.format === 'pro10'
    ? `<span class="badge badge-muted" style="font-size:10px;letter-spacing:.5px;">Pro 10</span>`
    : '';

  const dateBadge = (match.status === 'scheduled' && match.scheduledAt)
    ? `<span class="t-label t-muted" style="font-size:10px;">
         📅 ${new Date(match.scheduledAt).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })}
       </span>`
    : '';

  return `
    <div class="card match-card" style="margin-bottom:10px;padding:14px 16px;">
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
          <span class="t-small" style="font-weight:700;white-space:nowrap;overflow:hidden;
            text-overflow:ellipsis;text-align:right;">
            ${escHtml(op.alias || op.name)}
          </span>
          ${opAv}
        </div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          ${badge}
          ${formatBadge}
          ${eloBadge}
          ${dateBadge}
        </div>
        ${action ? `<button class="btn btn-primary btn-sm"
          data-action="${action}" data-mid="${escHtml(match.mid)}"
          style="flex-shrink:0;white-space:nowrap;">${_actionLabel(action)}</button>` : ''}
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
        action: null,
      };
    }
    default:
      return { badge: `<span class="badge badge-muted">${escHtml(match.status || '')}</span>`, action: null };
  }
}

function _actionLabel(action) {
  if (action === 'enter-result')   return 'Enter Result';
  if (action === 'confirm-result') return 'Confirm Result';
  if (action === 'upload-photo')   return 'Upload Photo';
  return 'Action';
}

function _formatScore(result, isMeA) {
  if (!result) return '';
  if (result.score) {
    const s = result.score;
    return isMeA ? `${s.a}–${s.b}` : `${s.b}–${s.a}`;
  }
  if (!result.sets?.length) return '';
  return result.sets.map(s => isMeA ? `${s.a}-${s.b}` : `${s.b}-${s.a}`).join(', ');
}

// ─── Propose match modal ──────────────────────────────────────────────────────

function _showProposeModal(myUid, allPlayers, memberUids, existingMatches, sid, lid) {
  const opponents = memberUids
    .filter(uid => uid !== myUid)
    .map(uid => allPlayers[uid] ? { ...allPlayers[uid], uid } : null)
    .filter(Boolean);

  const overlay = _createOverlay();
  overlay.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:0 0 16px;">
        <div style="font-size:16px;font-weight:700;">Propose a Match</div>
        <button class="btn-icon" id="btn-close">${_closeIcon()}</button>
      </div>
      ${opponents.length === 0 ? `
        <p class="t-small t-muted" style="text-align:center;padding:24px 0;">
          No other players in your league yet.
        </p>
      ` : `
        <p class="t-small t-muted" style="margin-bottom:16px;">Select your opponent:</p>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px;">
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
        <div style="margin-bottom:16px;">
          <div class="t-label t-muted" style="margin-bottom:8px;">Match format</div>
          <div style="display:flex;gap:8px;">
            <div class="tap-card selected" data-format="bo3"
              style="flex:1;text-align:center;padding:12px 8px;">
              <div style="font-weight:700;font-size:13px;">Best of 3</div>
              <div class="t-small t-muted">3 sets max</div>
            </div>
            <div class="tap-card" data-format="pro10"
              style="flex:1;text-align:center;padding:12px 8px;">
              <div style="font-weight:700;font-size:13px;">Pro 10</div>
              <div class="t-small t-muted">Single score 0–10</div>
            </div>
          </div>
        </div>
        <div style="margin-bottom:20px;">
          <div class="t-label t-muted" style="margin-bottom:8px;">
            Suggested date &amp; time <span style="font-weight:400;opacity:.6;">(optional)</span>
          </div>
          <input class="input" id="propose-date" type="datetime-local"
            style="font-size:14px;"
            min="${new Date(Date.now() + 60000).toISOString().slice(0,16)}">
        </div>
        <button class="btn btn-primary" id="btn-confirm-propose" disabled>
          Propose Match
        </button>
      `}
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#btn-close')?.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  let selectedUid    = null;
  let selectedFormat = 'bo3';

  overlay.querySelectorAll('.tap-card[data-format]').forEach(card => {
    card.addEventListener('click', () => {
      selectedFormat = card.dataset.format;
      overlay.querySelectorAll('.tap-card[data-format]').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
    });
  });

  overlay.querySelectorAll('.tap-card[data-uid]').forEach(card => {
    card.addEventListener('click', () => {
      selectedUid = card.dataset.uid;
      overlay.querySelectorAll('.tap-card[data-uid]').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      overlay.querySelector('#btn-confirm-propose').disabled = false;
    });
  });

  overlay.querySelector('#btn-confirm-propose')?.addEventListener('click', async () => {
    if (!selectedUid) return;
    const btn = overlay.querySelector('#btn-confirm-propose');
    btn.disabled = true;
    btn.textContent = 'Proposing…';
    try {
      const dateInput = overlay.querySelector('#propose-date');
      const scheduledAt = dateInput?.value
        ? new Date(dateInput.value).getTime()
        : null;
      await dbPush(sRef(sid, lid, 'matches'), {
        playerA:    myUid,
        playerB:    selectedUid,
        proposedBy: myUid,
        proposedAt: Date.now(),
        format:     selectedFormat,
        scheduledAt,
        status:     'scheduled',
        result:     null,
        photoUrl:   null,
        eloDeltas:  null,
        confirmedAt: null,
      });
      overlay.remove();
    } catch (err) {
      console.error('Propose error:', err);
      btn.disabled = false;
      btn.textContent = 'Propose Match';
    }
  });
}

// ─── Enter result modal ───────────────────────────────────────────────────────

function _showEnterResultModal(match, myUid, allPlayers, sid, lid) {
  const isPro10 = match.format === 'pro10';
  const opUid   = match.playerA === myUid ? match.playerB : match.playerA;
  const op      = allPlayers[opUid] || { name: 'Unknown', alias: opUid };
  const isMeA   = match.playerA === myUid;

  const overlay = _createOverlay();
  overlay.innerHTML = `
    <div class="modal-sheet" style="max-height:92dvh;overflow-y:auto;">
      <div class="modal-handle"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:0 0 16px;">
        <div style="font-size:16px;font-weight:700;">Enter Result</div>
        <button class="btn-icon" id="btn-close">${_closeIcon()}</button>
      </div>

      <div style="margin-bottom:20px;">
        <div class="t-label t-muted" style="margin-bottom:8px;">Who won?</div>
        <div style="display:flex;gap:8px;">
          <div class="tap-card" data-winner="me"
            style="flex:1;text-align:center;padding:14px 8px;">
            <div style="font-weight:700;font-size:14px;">You</div>
          </div>
          <div class="tap-card" data-winner="op"
            style="flex:1;text-align:center;padding:14px 8px;">
            <div style="font-weight:700;font-size:14px;">
              ${escHtml(op.alias || op.name)}
            </div>
          </div>
        </div>
      </div>

      ${isPro10 ? `
        <div style="margin-bottom:20px;">
          <div class="t-label t-muted" style="margin-bottom:12px;">Score (0 – 10)</div>
          <div style="display:flex;align-items:flex-end;gap:12px;justify-content:center;">
            <div style="text-align:center;">
              <div class="t-small t-muted" style="margin-bottom:6px;">You</div>
              <input type="number" class="input" id="score-me"
                min="0" max="10" inputmode="numeric" placeholder="–"
                style="width:76px;text-align:center;height:56px;font-size:24px;padding:8px 4px;">
            </div>
            <span style="font-size:24px;color:var(--text3);padding-bottom:10px;">–</span>
            <div style="text-align:center;">
              <div class="t-small t-muted" style="margin-bottom:6px;">
                ${escHtml(op.alias || op.name)}
              </div>
              <input type="number" class="input" id="score-op"
                min="0" max="10" inputmode="numeric" placeholder="–"
                style="width:76px;text-align:center;height:56px;font-size:24px;padding:8px 4px;">
            </div>
          </div>
        </div>
      ` : `
        <div style="margin-bottom:20px;">
          <div class="t-label t-muted" style="margin-bottom:8px;">Set scores</div>
          <div id="sets-container" style="display:flex;flex-direction:column;gap:10px;">
            ${_setRow(1)}
            ${_setRow(2)}
          </div>
          <button class="btn btn-ghost btn-sm" id="btn-add-set"
            style="margin-top:10px;width:auto;">+ Add 3rd set</button>
        </div>
      `}

      <div style="padding-bottom:8px;">
        <button class="btn btn-primary" id="btn-submit-result" disabled>
          Submit Result
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.querySelector('#btn-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  let winnerIsMe    = null;
  let thirdSetAdded = false;

  overlay.querySelectorAll('[data-winner]').forEach(card => {
    card.addEventListener('click', () => {
      winnerIsMe = card.dataset.winner === 'me';
      overlay.querySelectorAll('[data-winner]').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      _checkResultReady(overlay, winnerIsMe, isPro10);
    });
  });

  if (isPro10) {
    overlay.querySelector('#score-me').addEventListener('input', () =>
      _checkResultReady(overlay, winnerIsMe, true));
    overlay.querySelector('#score-op').addEventListener('input', () =>
      _checkResultReady(overlay, winnerIsMe, true));
  } else {
    overlay.querySelector('#btn-add-set').addEventListener('click', () => {
      if (thirdSetAdded) return;
      thirdSetAdded = true;
      overlay.querySelector('#sets-container').insertAdjacentHTML('beforeend', _setRow(3));
      overlay.querySelector('#btn-add-set').style.display = 'none';
      _checkResultReady(overlay, winnerIsMe, false);
    });

    overlay.querySelector('#sets-container').addEventListener('input', () => {
      _checkResultReady(overlay, winnerIsMe, false);
    });
  }

  overlay.querySelector('#btn-submit-result').addEventListener('click', async () => {
    if (winnerIsMe === null) return;

    const btn = overlay.querySelector('#btn-submit-result');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    const opUid2    = match.playerA === myUid ? match.playerB : match.playerA;
    const winnerUid = winnerIsMe ? myUid : opUid2;
    const loserUid  = winnerIsMe ? opUid2 : myUid;

    let resultData;
    if (isPro10) {
      const me  = parseInt(overlay.querySelector('#score-me').value, 10);
      const opp = parseInt(overlay.querySelector('#score-op').value, 10);
      resultData = {
        winner:      winnerUid,
        loser:       loserUid,
        score:       isMeA ? { a: me, b: opp } : { a: opp, b: me },
        enteredBy:   myUid,
        enteredAt:   Date.now(),
        confirmedBy: null,
        confirmedAt: null,
      };
    } else {
      const setCount  = thirdSetAdded ? 3 : 2;
      const sets      = _collectSets(overlay, setCount);
      if (!sets) { btn.disabled = false; btn.textContent = 'Submit Result'; return; }
      resultData = {
        winner:      winnerUid,
        loser:       loserUid,
        sets:        sets.map(s => isMeA ? { a: s.me, b: s.op } : { a: s.op, b: s.me }),
        enteredBy:   myUid,
        enteredAt:   Date.now(),
        confirmedBy: null,
        confirmedAt: null,
      };
    }

    try {
      await dbMultiUpdate({
        [`seasons/${sid}/leagues/${lid}/matches/${match.mid}/status`]: 'result_pending',
        [`seasons/${sid}/leagues/${lid}/matches/${match.mid}/result`]: resultData,
      });
      overlay.remove();
    } catch (err) {
      console.error('Enter result error:', err);
      btn.disabled = false;
      btn.textContent = 'Submit Result';
    }
  });
}

function _setRow(num) {
  return `
    <div style="display:flex;align-items:center;gap:10px;" data-set-row="${num}">
      <span class="t-label t-muted" style="width:48px;flex-shrink:0;">Set ${num}</span>
      <input type="number" class="input" data-score="me"
        min="0" max="7" placeholder="You"
        style="flex:1;text-align:center;height:44px;padding:8px 4px;">
      <span style="color:var(--text3);font-size:16px;">–</span>
      <input type="number" class="input" data-score="op"
        min="0" max="7" placeholder="Opp"
        style="flex:1;text-align:center;height:44px;padding:8px 4px;">
    </div>
  `;
}

function _checkResultReady(overlay, winnerIsMe, isPro10) {
  let ready;
  if (isPro10) {
    const me = overlay.querySelector('#score-me')?.value ?? '';
    const op = overlay.querySelector('#score-op')?.value ?? '';
    ready = winnerIsMe !== null && me !== '' && op !== '';
  } else {
    const rows = overlay.querySelectorAll('[data-set-row]');
    let allFilled = rows.length > 0;
    rows.forEach(row => {
      if (row.querySelector('[data-score="me"]').value === '' ||
          row.querySelector('[data-score="op"]').value === '') allFilled = false;
    });
    ready = winnerIsMe !== null && allFilled;
  }
  overlay.querySelector('#btn-submit-result').disabled = !ready;
}

function _collectSets(overlay, count) {
  const sets = [];
  for (let i = 1; i <= count; i++) {
    const row = overlay.querySelector(`[data-set-row="${i}"]`);
    if (!row) break;
    const me = parseInt(row.querySelector('[data-score="me"]').value, 10);
    const op = parseInt(row.querySelector('[data-score="op"]').value, 10);
    if (isNaN(me) || isNaN(op)) return null;
    sets.push({ me, op });
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
          style="width:120px;height:auto;opacity:.8;margin-bottom:12px;">
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
        <label class="btn btn-surface" style="cursor:pointer;text-align:center;">
          📷  Choose / Take Photo
          <input type="file" id="photo-input" accept="image/*" capture="environment"
            style="display:none;">
        </label>
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

  overlay.querySelector('#photo-input').addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file) return;
    selectedFile = file;
    overlay.querySelector('#photo-img').src = URL.createObjectURL(file);
    overlay.querySelector('#photo-preview').style.display = 'block';
    overlay.querySelector('#btn-upload').disabled = false;
  });

  overlay.querySelector('#btn-upload').addEventListener('click', async () => {
    if (!selectedFile) return;
    _setUploadingState(overlay, true);
    try {
      const photoUrl = await uploadMatchPhoto(match.mid, selectedFile);
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

async function _confirmMatchWithElo(match, photoUrl, sid, lid, allPlayers) {
  const uidA = match.playerA;
  const uidB = match.playerB;

  const [ratingA, ratingB] = await Promise.all([
    dbGet(pRef(uidA, 'eloRating')),
    dbGet(pRef(uidB, 'eloRating')),
  ]);

  const ra      = ratingA || 1000;
  const rb      = ratingB || 1000;
  const winner  = match.result.winner === uidA ? 'a' : 'b';
  const kFactor = 32;

  const elo = calculateElo(ra, rb, winner, kFactor);
  const now = Date.now();

  const [histA, histB] = await Promise.all([
    dbGet(pRef(uidA, 'eloHistory')),
    dbGet(pRef(uidB, 'eloHistory')),
  ]);

  await dbMultiUpdate({
    [`seasons/${sid}/leagues/${lid}/matches/${match.mid}/status`]:      'confirmed',
    [`seasons/${sid}/leagues/${lid}/matches/${match.mid}/photoUrl`]:    photoUrl,
    [`seasons/${sid}/leagues/${lid}/matches/${match.mid}/confirmedAt`]: now,
    [`seasons/${sid}/leagues/${lid}/matches/${match.mid}/confirmedBy`]: 'system',
    [`seasons/${sid}/leagues/${lid}/matches/${match.mid}/eloDeltas`]:   {
      [uidA]: elo.deltaA,
      [uidB]: elo.deltaB,
    },
    [`players/${uidA}/eloRating`]:  elo.newRatingA,
    [`players/${uidB}/eloRating`]:  elo.newRatingB,
    [`players/${uidA}/eloHistory`]: [...(histA || []), { delta: elo.deltaA, match: match.mid, ts: now }],
    [`players/${uidB}/eloHistory`]: [...(histB || []), { delta: elo.deltaB, match: match.mid, ts: now }],
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
