// scripts/send-push.js — Push + WhatsApp notifications for match events
// Triggered by GitHub Actions on a 5-minute cron.
//
// Required secrets: FIREBASE_SERVICE_ACCOUNT, FIREBASE_DATABASE_URL
// Optional secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  (push)
//                   GREENAPI_INSTANCE_ID, GREENAPI_TOKEN, WHATSAPP_GROUP_ID  (WhatsApp)

'use strict';

const admin   = require('firebase-admin');
const webpush = require('web-push');
const { sendWA, sendWAPhoto, waEnabled } = require('./whatsapp.js');

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const DB_URL        = process.env.FIREBASE_DATABASE_URL;
const APP_URL       = 'https://varirvarela.github.io/atp-greenwich/';

const pushEnabled = !!(VAPID_PUBLIC && VAPID_PRIVATE);

if (!pushEnabled && !waEnabled) {
  console.log('Neither push nor WhatsApp configured — exiting.');
  process.exit(0);
}

const svcAccount = (() => {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) { console.error('FIREBASE_SERVICE_ACCOUNT not set'); process.exit(1); }
  try { return JSON.parse(raw); } catch { console.error('Invalid FIREBASE_SERVICE_ACCOUNT JSON'); process.exit(1); }
})();

admin.initializeApp({ credential: admin.credential.cert(svcAccount), databaseURL: DB_URL });
const db = admin.database();

if (pushEnabled) {
  webpush.setVapidDetails('mailto:atp.greenwich.league@gmail.com', VAPID_PUBLIC, VAPID_PRIVATE);
}

async function run() {
  const [playersSnap, seasonsSnap, waPrefsSnap] = await Promise.all([
    db.ref('players').once('value'),
    db.ref('seasons').once('value'),
    db.ref('config/whatsappPrefs').once('value'),
  ]);

  const players  = playersSnap.val() || {};
  const seasons  = seasonsSnap.val() || {};
  const waPrefs  = waPrefsSnap.val() || {};

  const adminUids = Object.entries(players)
    .filter(([, p]) => p.isAdmin === true)
    .map(([uid]) => uid);

  // ── Access requests: notify admins when a new player is awaiting approval ──
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
      await db.ref(`players/${uid}/pushNotifiedAdmin`).set(true);
    }
  }

  // ── Match events: scan every season → every league → every match ──
  for (const [sid, season] of Object.entries(seasons)) {
    const leagues = season.leagues || {};

    for (const [lid, league] of Object.entries(leagues)) {
      const matches = league.matches || {};

      for (const [mid, match] of Object.entries(matches)) {
        const base     = `seasons/${sid}/leagues/${lid}/matches/${mid}`;
        const notified = match.pushNotified || {};

        // ── Direct challenge ──────────────────────────────────────────────────
        if (match.status === 'scheduled' && match.playerB && !notified.proposed) {
          const proposerName    = _playerName(players, match.playerA);
          const challengedName  = _playerName(players, match.playerB);
          if (_wantsPush(players, match.playerB, 'challenged')) {
            await _sendPush(players, match.playerB, {
              title: 'New challenge',
              body:  `${proposerName} challenged you to a match.`,
              tag:   `propose-${mid}`,
              url:   APP_URL,
            });
          }
          if (_wantsWA(waPrefs, 'challenged'))
            await sendWA(`🎾 *New challenge!*\n${proposerName} challenged ${challengedName} to a match.`);
          await db.ref(`${base}/pushNotified/proposed`).set(true);
        }

        // ── Open challenge ────────────────────────────────────────────────────
        if (match.status === 'open_challenge' && !notified.open_challenge) {
          const challengerName = _playerName(players, match.playerA);
          const members = Object.keys(league.members || {}).filter(uid => uid !== match.playerA);
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
            await sendWA(`🎾 *Open challenge from ${challengerName}!*\nFirst to accept in the app wins the spot.`);
          await db.ref(`${base}/pushNotified/open_challenge`).set(true);
        }

        // ── Result pending confirmation ───────────────────────────────────────
        if (match.status === 'result_pending' && !notified.result && match.result?.enteredBy) {
          const enteredBy  = match.result.enteredBy;
          const confirmUid = match.playerA === enteredBy ? match.playerB : match.playerA;
          if (_wantsPush(players, confirmUid, 'result')) {
            const entererName = _playerName(players, enteredBy);
            await _sendPush(players, confirmUid, {
              title: 'Confirm match result',
              body:  `${entererName} entered a result — confirm or dispute.`,
              tag:   `result-${mid}`,
              url:   APP_URL,
            });
          }
          await db.ref(`${base}/pushNotified/result`).set(true);
        }

        // ── Match confirmed ───────────────────────────────────────────────────
        if (match.status === 'confirmed' && !notified.confirmed && match.playerB) {
          const pAName = _playerName(players, match.playerA);
          const pBName = _playerName(players, match.playerB);
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
          // WhatsApp group: show who won with ELO delta
          const winnerUid  = match.result?.winner;
          const loserUid   = match.result?.loser;
          if (winnerUid && loserUid && _wantsWA(waPrefs, 'confirmed')) {
            const wName  = _playerName(players, winnerUid);
            const lName  = _playerName(players, loserUid);
            const deltas = match.eloDeltas || {};
            const dW     = deltas[winnerUid];
            const dL     = deltas[loserUid];
            let caption  = `✅ *${wName}* def. *${lName}*`;
            if (dW != null && dL != null) {
              caption += `\nELO: ${wName} ${dW > 0 ? '+' : ''}${Math.round(dW)} · ${lName} ${Math.round(dL)}`;
            }
            await sendWAPhoto(match.photoUrl || null, caption);
          }
          await db.ref(`${base}/pushNotified/confirmed`).set(true);
        }
      }
    }
  }

  // ── Pending WhatsApp broadcast ─────────────────────────────────────────────
  if (waEnabled) {
    const bcSnap = await db.ref('config/whatsappBroadcast').once('value');
    const bc     = bcSnap.val();
    if (bc?.message && !bc.sentAt) {
      await sendWA(bc.message);
      await db.ref('config/whatsappBroadcast/sentAt').set(Date.now());
      console.log('Broadcast sent.');
    }
  }

  console.log('Notification pass complete.');
}

function _playerName(players, uid) {
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

async function _sendPush(players, uid, payload) {
  if (!pushEnabled) return;
  const p = players[uid];
  if (!p || !p.pushSubscription) return;
  const sub = p.pushSubscription;
  if (!sub.endpoint || !sub.keys) return;
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload));
    console.log(`Push sent to ${uid}: ${payload.title}`);
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      await admin.database().ref(`players/${uid}/pushSubscription`).remove();
      delete players[uid].pushSubscription;
      console.log(`Removed expired subscription for ${uid}`);
    } else {
      console.error(`Push failed for ${uid}:`, err.message);
    }
  }
}

run().then(() => process.exit(0)).catch(err => { console.error('send-push error:', err); process.exit(1); });
