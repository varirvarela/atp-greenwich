// Push notifications + WhatsApp for match events — runs every 5 minutes
// Port of scripts/send-push.js for Cloudflare Workers

import { createFirebase }                   from './firebase.js';
import { sendWebPush }                      from './vapid.js';
import { waEnabled, sendWA, sendWAPhoto }   from './whatsapp.js';

const APP_URL = 'https://varirvarela.github.io/atp-greenwich/';

export async function runSendPush(env) {
  const pushEnabled = !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

  if (!pushEnabled && !waEnabled(env)) {
    console.log('Neither push nor WhatsApp configured — skipping.');
    return;
  }

  const db        = createFirebase(env);
  const _sendPush = makeSendPush(db, env);

  const [players, seasons, waPrefs] = await Promise.all([
    db.get('players').then(v => v || {}),
    db.get('seasons').then(v => v || {}),
    db.get('config/whatsappPrefs').then(v => v || {}),
  ]);

  const adminUids = Object.entries(players)
    .filter(([, p]) => p.isAdmin === true)
    .map(([uid]) => uid);

  // ── Access requests ───────────────────────────────────────────────────────
  for (const [uid, player] of Object.entries(players)) {
    if (player.status === 'onboarding' && !player.pushNotifiedAdmin) {
      const name = player.alias || player.name || 'A new player';
      for (const adminUid of adminUids) {
        await _sendPush(players, adminUid, {
          title: 'Access request',
          body:  `${name} is requesting access to the league.`,
          tag:   `onboarding-${uid}`,
          url:   APP_URL,
        });
      }
      await db.set(`players/${uid}/pushNotifiedAdmin`, true);
    }
  }

  // ── Match events ──────────────────────────────────────────────────────────
  for (const [sid, season] of Object.entries(seasons)) {
    const leagues = season.leagues || {};
    for (const [lid, league] of Object.entries(leagues)) {
      const matches = league.matches || {};
      for (const [mid, match] of Object.entries(matches)) {
        const base     = `seasons/${sid}/leagues/${lid}/matches/${mid}`;
        const notified = match.pushNotified || {};

        // Direct challenge
        if (match.status === 'scheduled' && match.playerB && !notified.proposed) {
          const proposerName   = _name(players, match.playerA);
          const challengedName = _name(players, match.playerB);
          if (_wantsPush(players, match.playerB, 'challenged')) {
            await _sendPush(players, match.playerB, {
              title: 'New challenge',
              body:  `${proposerName} challenged you to a match.`,
              tag:   `propose-${mid}`,
              url:   APP_URL,
            });
          }
          if (_wantsWA(waPrefs, 'challenged'))
            await sendWA(`🎾 *New challenge!*\n${proposerName} challenged ${challengedName} to a match.`, env);
          await db.set(`${base}/pushNotified/proposed`, true);
        }

        // Open challenge
        if (match.status === 'open_challenge' && !notified.open_challenge) {
          const challengerName = _name(players, match.playerA);
          const members = Object.keys(league.members || {}).filter(u => u !== match.playerA);
          for (const uid of members) {
            if (_wantsPush(players, uid, 'challenged')) {
              await _sendPush(players, uid, {
                title: 'Open challenge!',
                body:  `${challengerName} posted an open challenge — be the first to accept.`,
                tag:   `open-${mid}`,
                url:   APP_URL,
              });
            }
          }
          if (_wantsWA(waPrefs, 'openChallenge'))
            await sendWA(`🎾 *Open challenge from ${challengerName}!*\nFirst to accept in the app wins the spot.`, env);
          await db.set(`${base}/pushNotified/open_challenge`, true);
        }

        // Result pending confirmation
        if (match.status === 'result_pending' && !notified.result && match.result?.enteredBy) {
          const enteredBy  = match.result.enteredBy;
          const confirmUid = match.playerA === enteredBy ? match.playerB : match.playerA;
          if (_wantsPush(players, confirmUid, 'result')) {
            await _sendPush(players, confirmUid, {
              title: 'Confirm match result',
              body:  `${_name(players, enteredBy)} entered a result — confirm or dispute.`,
              tag:   `result-${mid}`,
              url:   APP_URL,
            });
          }
          await db.set(`${base}/pushNotified/result`, true);
        }

        // Match confirmed
        if (match.status === 'confirmed' && !notified.confirmed && match.playerB) {
          const pAName = _name(players, match.playerA);
          const pBName = _name(players, match.playerB);
          if (_wantsPush(players, match.playerA, 'confirmed')) {
            await _sendPush(players, match.playerA, {
              title: 'Match confirmed',
              body:  `Your match vs ${pBName} is now confirmed.`,
              tag:   `confirmed-${mid}-a`,
              url:   APP_URL,
            });
          }
          if (_wantsPush(players, match.playerB, 'confirmed')) {
            await _sendPush(players, match.playerB, {
              title: 'Match confirmed',
              body:  `Your match vs ${pAName} is now confirmed.`,
              tag:   `confirmed-${mid}-b`,
              url:   APP_URL,
            });
          }
          const winnerUid = match.result?.winner;
          const loserUid  = match.result?.loser;
          if (winnerUid && loserUid && _wantsWA(waPrefs, 'confirmed')) {
            const wName  = _name(players, winnerUid);
            const lName  = _name(players, loserUid);
            const deltas = match.eloDeltas || {};
            const dW     = deltas[winnerUid];
            const dL     = deltas[loserUid];
            let caption  = `✅ *${wName}* def. *${lName}*`;
            if (dW != null && dL != null) {
              caption += `\nELO: ${wName} ${dW > 0 ? '+' : ''}${Math.round(dW)} · ${lName} ${Math.round(dL)}`;
            }
            await sendWAPhoto(match.photoUrl || null, caption, env);
          }
          await db.set(`${base}/pushNotified/confirmed`, true);
        }
      }
    }
  }

  // ── Pending WhatsApp broadcast ─────────────────────────────────────────────
  if (waEnabled(env)) {
    const bc = await db.get('config/whatsappBroadcast');
    if (bc?.message && !bc.sentAt) {
      await sendWA(bc.message, env);
      await db.set('config/whatsappBroadcast/sentAt', Date.now());
      console.log('Broadcast sent.');
    }
  }

  console.log('Notification pass complete.');
}

function _name(players, uid) {
  const p = players[uid] || {};
  return p.alias || p.name || 'Your opponent';
}

function _wantsWA(prefs, key) {
  return prefs[key] !== false;
}

function _wantsPush(players, uid, type) {
  const prefs = players[uid]?.pushPrefs;
  if (!prefs) return type !== 'reminders';
  return prefs[type] !== false;
}

function makeSendPush(db, env) {
  return async function _sendPush(players, uid, payload) {
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;
    const p = players[uid];
    if (!p?.pushSubscription?.endpoint || !p.pushSubscription?.keys) return;
    try {
      await sendWebPush(p.pushSubscription, payload, env);
      console.log(`Push sent to ${uid}: ${payload.title}`);
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await db.set(`players/${uid}/pushSubscription`, null);
        delete players[uid].pushSubscription;
        console.log(`Removed expired subscription for ${uid}`);
      } else {
        console.error(`Push failed for ${uid}:`, err.message);
      }
    }
  };
}
