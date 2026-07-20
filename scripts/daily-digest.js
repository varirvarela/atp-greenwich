// scripts/daily-digest.js — Daily feed digests
// Morning run (12pm UTC / 7am EST): post today's match schedule per league
// Evening run (2am UTC / 9pm EST): post end-of-day standings per league with play
//
// Required secrets: FIREBASE_SERVICE_ACCOUNT, FIREBASE_DATABASE_URL
// Optional secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  (push reminders)
//                   GREENAPI_INSTANCE_ID, GREENAPI_TOKEN, WHATSAPP_GROUP_ID  (WhatsApp)

'use strict';

const admin   = require('firebase-admin');
const webpush = require('web-push');
const { sendWA, waEnabled } = require('./whatsapp.js');

const DB_URL        = process.env.FIREBASE_DATABASE_URL;
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;

const pushEnabled = !!(VAPID_PUBLIC && VAPID_PRIVATE);
if (pushEnabled) {
  webpush.setVapidDetails('mailto:atp.greenwich.league@gmail.com', VAPID_PUBLIC, VAPID_PRIVATE);
}

const svcAccount = (() => {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) { console.error('FIREBASE_SERVICE_ACCOUNT not set'); process.exit(1); }
  try { return JSON.parse(raw); }
  catch { console.error('Invalid FIREBASE_SERVICE_ACCOUNT JSON'); process.exit(1); }
})();

admin.initializeApp({ credential: admin.credential.cert(svcAccount), databaseURL: DB_URL });
const db = admin.database();

function etDateStr(tsMs) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(tsMs));
}

async function run() {
  const now = Date.now();
  const todayET = etDateStr(now);
  const utcHour = new Date(now).getUTCHours();

  // Morning window: 10–14 UTC (7am EST ± buffer)
  // Evening window: 23–05 UTC (9pm EST ± buffer)
  const isMorning = utcHour >= 10 && utcHour <= 14;
  const isEvening = utcHour >= 23 || utcHour <= 5;

  if (!isMorning && !isEvening) {
    console.log(`UTC hour ${utcHour} — not a digest window; exiting.`);
    process.exit(0);
  }

  const mode = isMorning ? 'morning schedule' : 'evening standings';
  console.log(`Daily digest — mode: ${mode}, ET date: ${todayET}`);

  const [seasonsSnap, playersSnap, waPrefsSnap] = await Promise.all([
    db.ref('seasons').once('value'),
    (isMorning && pushEnabled) || waEnabled ? db.ref('players').once('value') : Promise.resolve(null),
    waEnabled ? db.ref('config/whatsappPrefs').once('value') : Promise.resolve(null),
  ]);
  const waPrefs = waPrefsSnap ? (waPrefsSnap.val() || {}) : {};
  const seasons = seasonsSnap.val() || {};
  const players = playersSnap ? (playersSnap.val() || {}) : {};

  for (const [sid, season] of Object.entries(seasons)) {
    const leagues = season.leagues || {};
    for (const [lid, league] of Object.entries(leagues)) {
      const matches = league.matches || {};
      const memberUids = Object.keys(league.members || {});
      if (memberUids.length < 2) continue;

      if (isMorning) {
        await _morningSchedule(sid, lid, league, matches, todayET, now, players, waPrefs);
      } else {
        await _eveningStandings(sid, lid, league, matches, memberUids, todayET, now, players, waPrefs);
      }
    }
  }

  console.log('Daily digest complete.');
}

async function _morningSchedule(sid, lid, league, matches, todayET, now, players, waPrefs) {
  const flagRef = db.ref(`config/dailyDigest/${todayET}/schedule/${lid}`);
  if ((await flagRef.once('value')).val()) {
    console.log(`  [${lid}] schedule already posted for ${todayET}`);
    return;
  }

  const todayMatches = Object.entries(matches)
    .filter(([, m]) => m.scheduledAt && m.status !== 'confirmed' && m.status !== 'cancelled'
      && etDateStr(m.scheduledAt) === todayET)
    .sort(([, a], [, b]) => a.scheduledAt - b.scheduledAt)
    .map(([mid, m]) => ({ mid, playerA: m.playerA, playerB: m.playerB, scheduledAt: m.scheduledAt }));

  if (todayMatches.length === 0) {
    console.log(`  [${lid}] no matches scheduled for ${todayET}`);
    return;
  }

  await db.ref('activity').push().set({
    type: 'daily_schedule',
    ts: now,
    sid,
    lid,
    dateET: todayET,
    matches: todayMatches,
  });
  await flagRef.set(true);
  console.log(`  [${lid}] posted daily_schedule with ${todayMatches.length} match(es)`);

  // WhatsApp: morning schedule
  if (waEnabled && players && waPrefs.dailySchedule !== false) {
    const leagueName = league.name || lid;
    const MEDALS = ['🥇', '🥈', '🥉'];
    let msg = `📅 *Today's matches — ${leagueName}*\n`;
    for (const { playerA, playerB, scheduledAt } of todayMatches) {
      const pA = players[playerA]?.alias || players[playerA]?.name || playerA;
      const pB = players[playerB]?.alias || players[playerB]?.name || playerB;
      const timeStr = scheduledAt
        ? new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true,
          }).format(new Date(scheduledAt))
        : null;
      msg += timeStr ? `• ${pA} vs ${pB} at ${timeStr}\n` : `• ${pA} vs ${pB}\n`;
    }
    await sendWA(msg.trim());
  }

  // Push reminders — players who opted in and have a match today
  if (pushEnabled && players && Object.keys(players).length > 0) {
    const notifiedUids = new Set();
    for (const { playerA, playerB, scheduledAt } of todayMatches) {
      const time = scheduledAt
        ? new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true,
          }).format(new Date(scheduledAt))
        : null;
      for (const uid of [playerA, playerB].filter(Boolean)) {
        if (notifiedUids.has(uid)) continue;
        const p = players[uid];
        if (!p?.pushSubscription || p.pushPrefs?.reminders !== true) continue;
        const oppUid = uid === playerA ? playerB : playerA;
        const oppName = (players[oppUid]?.alias || players[oppUid]?.name) || 'your opponent';
        const body = time
          ? `You play ${oppName} at ${time} today.`
          : `You have a match vs ${oppName} scheduled for today.`;
        try {
          await webpush.sendNotification(p.pushSubscription, JSON.stringify({
            title: 'Match today!',
            body,
            tag:  `reminder-${uid}-${todayET}`,
            url:  'https://varirvarela.github.io/atp-greenwich/',
          }));
          notifiedUids.add(uid);
          console.log(`  Push reminder sent to ${uid}`);
        } catch (err) {
          if (err.statusCode === 410 || err.statusCode === 404) {
            await db.ref(`players/${uid}/pushSubscription`).remove();
          }
        }
      }
    }
  }
}

async function _eveningStandings(sid, lid, league, matches, memberUids, todayET, now, players, waPrefs) {
  const flagRef = db.ref(`config/dailyDigest/${todayET}/standings/${lid}`);
  if ((await flagRef.once('value')).val()) {
    console.log(`  [${lid}] standings already posted for ${todayET}`);
    return;
  }

  const matchValues = Object.values(matches);

  const cutoff = now - 36 * 60 * 60 * 1000;
  const confirmedToday = matchValues.filter(
    m => m.status === 'confirmed' && m.confirmedAt && m.confirmedAt >= cutoff
  );

  if (confirmedToday.length === 0) {
    console.log(`  [${lid}] no matches confirmed in last 36h`);
    return;
  }

  // Simple W/L standings across all confirmed matches in this league
  const stats = Object.fromEntries(memberUids.map(u => [u, { wins: 0, losses: 0, played: 0 }]));
  for (const m of matchValues) {
    if (m.status !== 'confirmed' || !m.result?.winner) continue;
    const w = m.result.winner;
    const l = m.result.loser;
    if (stats[w]) { stats[w].wins++; stats[w].played++; }
    if (l && stats[l]) { stats[l].losses++; stats[l].played++; }
  }

  const standings = memberUids
    .map(uid => ({ uid, ...stats[uid] }))
    .sort((a, b) => b.wins - a.wins || b.played - a.played);

  await db.ref('activity').push().set({
    type: 'standings_update',
    ts: now,
    sid,
    lid,
    dateET: todayET,
    matchesPlayedToday: confirmedToday.length,
    standings,
  });
  await flagRef.set(true);
  console.log(`  [${lid}] posted standings_update (${confirmedToday.length} game(s) played today)`);

  // WhatsApp: evening standings
  if (waEnabled && waPrefs.eveningStandings !== false) {
    const leagueName = league.name || lid;
    const medals     = ['🥇', '🥈', '🥉'];
    const dateLabel  = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', month: 'short', day: 'numeric',
    }).format(new Date());
    let msg = `🏆 *${leagueName} — ${dateLabel}*\n`;
    standings.forEach(({ uid, wins, losses }, i) => {
      const p     = players?.[uid] || {};
      const alias = p.alias || p.name || uid;
      const elo   = p.eloRating != null ? ` · ${Math.round(p.eloRating)} ELO` : '';
      msg += `${i + 1}. ${medals[i] || '  '} *${alias}* — ${wins}W ${losses}L${elo}\n`;
    });
    await sendWA(msg.trim());
  }
}

run().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
