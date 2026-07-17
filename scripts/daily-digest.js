// scripts/daily-digest.js — Daily feed digests
// Morning run (12pm UTC / 7am EST): post today's match schedule per league
// Evening run (2am UTC / 9pm EST): post end-of-day standings per league with play
//
// Required secrets: FIREBASE_SERVICE_ACCOUNT, FIREBASE_DATABASE_URL

'use strict';

const admin = require('firebase-admin');

const DB_URL = process.env.FIREBASE_DATABASE_URL;

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

  const seasonsSnap = await db.ref('seasons').once('value');
  const seasons = seasonsSnap.val() || {};

  for (const [sid, season] of Object.entries(seasons)) {
    const leagues = season.leagues || {};
    for (const [lid, league] of Object.entries(leagues)) {
      const matches = league.matches || {};
      const memberUids = Object.keys(league.members || {});
      if (memberUids.length < 2) continue;

      if (isMorning) {
        await _morningSchedule(sid, lid, matches, todayET, now);
      } else {
        await _eveningStandings(sid, lid, matches, memberUids, todayET, now);
      }
    }
  }

  console.log('Daily digest complete.');
}

async function _morningSchedule(sid, lid, matches, todayET, now) {
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
}

async function _eveningStandings(sid, lid, matches, memberUids, todayET, now) {
  const flagRef = db.ref(`config/dailyDigest/${todayET}/standings/${lid}`);
  if ((await flagRef.once('value')).val()) {
    console.log(`  [${lid}] standings already posted for ${todayET}`);
    return;
  }

  const matchValues = Object.values(matches);

  const confirmedToday = matchValues.filter(
    m => m.status === 'confirmed' && m.confirmedAt && etDateStr(m.confirmedAt) === todayET
  );

  if (confirmedToday.length === 0) {
    console.log(`  [${lid}] no matches confirmed today`);
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
}

run().catch(err => { console.error(err); process.exit(1); });
