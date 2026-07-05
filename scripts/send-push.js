// scripts/send-push.js — Send push notifications for pending match events
// Triggered by GitHub Actions on a 5-minute cron.
//
// Required secrets: FIREBASE_SERVICE_ACCOUNT, FIREBASE_DATABASE_URL,
//                   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY

'use strict';

const admin   = require('firebase-admin');
const webpush = require('web-push');

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const DB_URL        = process.env.FIREBASE_DATABASE_URL;

if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
  console.log('VAPID keys not configured — skipping push notifications.');
  process.exit(0);
}

const svcAccount = (() => {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) { console.error('FIREBASE_SERVICE_ACCOUNT not set'); process.exit(1); }
  try { return JSON.parse(raw); } catch { console.error('Invalid FIREBASE_SERVICE_ACCOUNT JSON'); process.exit(1); }
})();

admin.initializeApp({ credential: admin.credential.cert(svcAccount), databaseURL: DB_URL });
const db = admin.database();

webpush.setVapidDetails('mailto:atp.greenwich.league@gmail.com', VAPID_PUBLIC, VAPID_PRIVATE);

async function run() {
  const [configSnap, playersSnap] = await Promise.all([
    db.ref('config').once('value'),
    db.ref('players').once('value'),
  ]);

  const config  = configSnap.val();
  const players = playersSnap.val() || {};
  const sid     = config && config.defaultSeason;
  if (!sid) { console.log('No active season.'); return; }

  const leaguesSnap = await db.ref(`seasons/${sid}/leagues`).once('value');
  const leagues = leaguesSnap.val() || {};

  const sends = [];

  for (const [lid, league] of Object.entries(leagues)) {
    const matchesSnap = await db.ref(`seasons/${sid}/leagues/${lid}/matches`).once('value');
    const matches = matchesSnap.val() || {};

    for (const [mid, match] of Object.entries(matches)) {
      const base = `seasons/${sid}/leagues/${lid}/matches/${mid}`;
      const notified = match.pushNotified || {};

      // New match proposed — notify playerB
      if (match.status === 'scheduled' && !notified.proposed) {
        const proposerName = _playerName(players, match.playerA);
        await _sendTo(players, match.playerB, {
          title: 'New match proposed',
          body:  `${proposerName} challenged you to a match.`,
          tag:   `propose-${mid}`,
          url:   'https://varirvarela.github.io/atp-greenwich/',
        });
        await db.ref(`${base}/pushNotified/proposed`).set(true);
      }

      // Result entered — notify the player who needs to confirm
      if (match.status === 'result_pending' && !notified.result && match.result?.enteredBy) {
        const enteredBy  = match.result.enteredBy;
        const confirmUid = match.playerA === enteredBy ? match.playerB : match.playerA;
        const entererName = _playerName(players, enteredBy);
        await _sendTo(players, confirmUid, {
          title: 'Match result to confirm',
          body:  `${entererName} entered a result — confirm or dispute.`,
          tag:   `result-${mid}`,
          url:   'https://varirvarela.github.io/atp-greenwich/',
        });
        await db.ref(`${base}/pushNotified/result`).set(true);
      }
    }
  }

  console.log('Push notification pass complete.');
}

function _playerName(players, uid) {
  const p = players[uid] || {};
  return p.alias || p.name || 'Your opponent';
}

async function _sendTo(players, uid, payload) {
  const p = players[uid];
  if (!p || !p.pushSubscription) return;

  const sub = p.pushSubscription;
  if (!sub.endpoint || !sub.keys) return;

  try {
    await webpush.sendNotification(sub, JSON.stringify(payload));
    console.log(`Push sent to ${uid}: ${payload.title}`);
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      // Subscription expired — remove it
      await admin.database().ref(`players/${uid}/pushSubscription`).remove();
      console.log(`Removed expired subscription for ${uid}`);
    } else {
      console.error(`Push failed for ${uid}:`, err.message);
    }
  }
}

run().then(() => process.exit(0)).catch(err => { console.error('send-push error:', err); process.exit(1); });
