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
const APP_URL       = 'https://varirvarela.github.io/atp-greenwich/';

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
  const [playersSnap, seasonsSnap] = await Promise.all([
    db.ref('players').once('value'),
    db.ref('seasons').once('value'),
  ]);

  const players = playersSnap.val() || {};
  const seasons = seasonsSnap.val() || {};

  const adminUids = Object.entries(players)
    .filter(([, p]) => p.isAdmin === true)
    .map(([uid]) => uid);

  // ── Access requests: notify admins when a new player is awaiting approval ──
  for (const [uid, player] of Object.entries(players)) {
    if (player.status === 'onboarding' && !player.pushNotifiedAdmin) {
      const name = player.alias || player.name || 'A new player';
      for (const adminUid of adminUids) {
        await _sendTo(players, adminUid, {
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

        // Direct match proposed — notify the challenged player
        if (match.status === 'scheduled' && match.playerB && !notified.proposed) {
          if (_wantsPush(players, match.playerB, 'challenged')) {
            const proposerName = _playerName(players, match.playerA);
            await _sendTo(players, match.playerB, {
              title: 'New challenge',
              body:  `${proposerName} challenged you to a match.`,
              tag:   `propose-${mid}`,
              url:   APP_URL,
            });
          }
          await db.ref(`${base}/pushNotified/proposed`).set(true);
        }

        // Open challenge — notify all league members except the challenger
        if (match.status === 'open_challenge' && !notified.open_challenge) {
          const challengerName = _playerName(players, match.playerA);
          const members = Object.keys(league.members || {}).filter(uid => uid !== match.playerA);
          for (const uid of members) {
            if (_wantsPush(players, uid, 'challenged')) {
              await _sendTo(players, uid, {
                title: 'Open challenge!',
                body:  `${challengerName} posted an open challenge — be the first to accept.`,
                tag:   `open-${mid}`,
                url:   APP_URL,
              });
            }
          }
          await db.ref(`${base}/pushNotified/open_challenge`).set(true);
        }

        // Result entered — notify the player who needs to confirm
        if (match.status === 'result_pending' && !notified.result && match.result?.enteredBy) {
          const enteredBy   = match.result.enteredBy;
          const confirmUid  = match.playerA === enteredBy ? match.playerB : match.playerA;
          if (_wantsPush(players, confirmUid, 'result')) {
            const entererName = _playerName(players, enteredBy);
            await _sendTo(players, confirmUid, {
              title: 'Confirm match result',
              body:  `${entererName} entered a result — confirm or dispute.`,
              tag:   `result-${mid}`,
              url:   APP_URL,
            });
          }
          await db.ref(`${base}/pushNotified/result`).set(true);
        }

        // Match confirmed — notify both players
        if (match.status === 'confirmed' && !notified.confirmed && match.playerB) {
          const pAName = _playerName(players, match.playerA);
          const pBName = _playerName(players, match.playerB);
          if (_wantsPush(players, match.playerA, 'confirmed')) {
            await _sendTo(players, match.playerA, {
              title: 'Match confirmed',
              body:  `Your match vs ${pBName} is now confirmed.`,
              tag:   `confirmed-${mid}-a`,
              url:   APP_URL,
            });
          }
          if (_wantsPush(players, match.playerB, 'confirmed')) {
            await _sendTo(players, match.playerB, {
              title: 'Match confirmed',
              body:  `Your match vs ${pAName} is now confirmed.`,
              tag:   `confirmed-${mid}-b`,
              url:   APP_URL,
            });
          }
          await db.ref(`${base}/pushNotified/confirmed`).set(true);
        }
      }
    }
  }

  console.log('Push notification pass complete.');
}

function _playerName(players, uid) {
  const p = players[uid] || {};
  return p.alias || p.name || 'Your opponent';
}

// Returns true if player hasn't opted out of this notification type.
// Default is ON for all types except reminders.
function _wantsPush(players, uid, type) {
  const prefs = players[uid]?.pushPrefs;
  if (!prefs) return type !== 'reminders';
  return prefs[type] !== false;
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
      await admin.database().ref(`players/${uid}/pushSubscription`).remove();
      // Null out in-memory so subsequent sends this run don't retry the dead subscription
      delete players[uid].pushSubscription;
      console.log(`Removed expired subscription for ${uid}`);
    } else {
      console.error(`Push failed for ${uid}:`, err.message);
    }
  }
}

run().then(() => process.exit(0)).catch(err => { console.error('send-push error:', err); process.exit(1); });
