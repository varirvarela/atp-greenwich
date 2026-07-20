// Daily feed digests — morning schedule (12:00 UTC) + evening standings (02:00 UTC)
// Port of scripts/daily-digest.js for Cloudflare Workers

import { createFirebase }    from './firebase.js';
import { sendWebPush }       from './vapid.js';
import { waEnabled, sendWA } from './whatsapp.js';

function etDateStr(tsMs) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(tsMs));
}

export async function runDailyDigest(env) {
  const pushEnabled = !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

  const now      = Date.now();
  const todayET  = etDateStr(now);
  const utcHour  = new Date(now).getUTCHours();
  const isMorning = utcHour >= 10 && utcHour <= 14;
  const isEvening = utcHour >= 23 || utcHour <= 5;

  if (!isMorning && !isEvening) {
    console.log(`UTC hour ${utcHour} — not a digest window; skipping.`);
    return;
  }

  const mode = isMorning ? 'morning schedule' : 'evening standings';
  console.log(`Daily digest — ${mode}, ET date: ${todayET}`);

  const db = createFirebase(env);

  const needsPlayers = (isMorning && pushEnabled) || waEnabled(env);

  const [seasons, players, waPrefs] = await Promise.all([
    db.get('seasons').then(v => v || {}),
    needsPlayers ? db.get('players').then(v => v || {}) : Promise.resolve({}),
    waEnabled(env) ? db.get('config/whatsappPrefs').then(v => v || {}) : Promise.resolve({}),
  ]);

  for (const [sid, season] of Object.entries(seasons)) {
    const leagues = season.leagues || {};
    for (const [lid, league] of Object.entries(leagues)) {
      const matches    = league.matches || {};
      const memberUids = Object.keys(league.members || {});
      if (memberUids.length < 2) continue;

      if (isMorning) {
        await _morningSchedule(db, env, sid, lid, league, matches, todayET, now, players, waPrefs, pushEnabled);
      } else {
        await _eveningStandings(db, env, sid, lid, league, matches, memberUids, todayET, now, players, waPrefs);
      }
    }
  }

  console.log('Daily digest complete.');
}

async function _morningSchedule(db, env, sid, lid, league, matches, todayET, now, players, waPrefs, pushEnabled) {
  const flagPath = `config/dailyDigest/${todayET}/schedule/${lid}`;
  if (await db.get(flagPath)) {
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

  await db.push('activity', {
    type: 'daily_schedule', ts: now, sid, lid, dateET: todayET, matches: todayMatches,
  });
  await db.set(flagPath, true);
  console.log(`  [${lid}] posted daily_schedule with ${todayMatches.length} match(es)`);

  // WhatsApp morning schedule
  if (waEnabled(env) && waPrefs.dailySchedule !== false) {
    const leagueName = league.name || lid;
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
    await sendWA(msg.trim(), env);
  }

  // Push reminders
  if (pushEnabled && Object.keys(players).length > 0) {
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
        const oppName = players[oppUid]?.alias || players[oppUid]?.name || 'your opponent';
        const body = time
          ? `You play ${oppName} at ${time} today.`
          : `You have a match vs ${oppName} scheduled for today.`;
        try {
          await sendWebPush(p.pushSubscription, {
            title: 'Match today!', body,
            tag:   `reminder-${uid}-${todayET}`,
            url:   'https://varirvarela.github.io/atp-greenwich/',
          }, env);
          notifiedUids.add(uid);
          console.log(`  Push reminder sent to ${uid}`);
        } catch (err) {
          if (err.statusCode === 410 || err.statusCode === 404) {
            await db.set(`players/${uid}/pushSubscription`, null);
          }
        }
      }
    }
  }
}

async function _eveningStandings(db, env, sid, lid, league, matches, memberUids, todayET, now, players, waPrefs) {
  const flagPath = `config/dailyDigest/${todayET}/standings/${lid}`;
  if (await db.get(flagPath)) {
    console.log(`  [${lid}] standings already posted for ${todayET}`);
    return;
  }

  const matchValues    = Object.values(matches);
  const cutoff         = now - 36 * 60 * 60 * 1000;
  const confirmedToday = matchValues.filter(
    m => m.status === 'confirmed' && m.confirmedAt && m.confirmedAt >= cutoff
  );

  if (confirmedToday.length === 0) {
    console.log(`  [${lid}] no matches confirmed in last 36h`);
    return;
  }

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

  await db.push('activity', {
    type: 'standings_update', ts: now, sid, lid,
    dateET: todayET,
    matchesPlayedToday: confirmedToday.length,
    standings,
  });
  await db.set(flagPath, true);
  console.log(`  [${lid}] posted standings_update (${confirmedToday.length} game(s) played today)`);

  if (waEnabled(env) && waPrefs.eveningStandings !== false) {
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
    await sendWA(msg.trim(), env);
  }
}
