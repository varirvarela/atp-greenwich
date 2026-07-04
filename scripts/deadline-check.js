// scripts/deadline-check.js
// Daily cron: apply deadline penalties to group matches whose deadline has passed
// with no result and no forfeit, and the deadlinePenaltyApplied flag not yet set.
//
// Run: node scripts/deadline-check.js
// Requires: FIREBASE_SERVICE_ACCOUNT env var (JSON string) or GOOGLE_APPLICATION_CREDENTIALS

'use strict';

const admin = require('firebase-admin');

// ─── Init ─────────────────────────────────────────────────────────────────────

let credential;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  credential = admin.credential.cert(sa);
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  credential = admin.credential.applicationDefault();
} else {
  console.error('No credentials found. Set FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS.');
  process.exit(1);
}

admin.initializeApp({
  credential,
  databaseURL: 'https://atp-greenwich-default-rtdb.firebaseio.com',
});

const db = admin.database();

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  const now = Date.now();

  const seasonsSnap = await db.ref('seasons').once('value');
  const seasons = seasonsSnap.val() || {};

  let penalised = 0;

  for (const [sid, season] of Object.entries(seasons)) {
    const leagues = season.leagues || {};
    for (const [lid, league] of Object.entries(leagues)) {
      const gs = league.groupStageConfig || {};
      if (gs.status !== 'active') continue;

      const matches = league.matches || {};
      const updates = {};

      for (const [mid, match] of Object.entries(matches)) {
        if (!match.groupMatch) continue;
        if (match.status === 'confirmed') continue;
        if (match.forfeited) continue;
        if (match.deadlinePenaltyApplied) continue;
        if (!match.deadline || match.deadline > now) continue;

        updates[`seasons/${sid}/leagues/${lid}/matches/${mid}/deadlinePenaltyApplied`] = true;
        penalised++;
      }

      if (Object.keys(updates).length > 0) {
        await db.ref().update(updates);
        console.log(`[${sid}/${lid}] Penalised ${Object.keys(updates).length} match(es).`);
      }
    }
  }

  console.log(penalised === 0 ? 'No deadline penalties to apply.' : `Done. Total penalised: ${penalised}`);
  process.exit(0);
}

run().catch(err => {
  console.error('Deadline check failed:', err);
  process.exit(1);
});
