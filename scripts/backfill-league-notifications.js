// scripts/backfill-league-notifications.js
// One-off: writes notifications/league_assignment entries for every player
// already in a league, so they receive the "you've been added" email.
// Skips entries that already exist (idempotent — safe to run multiple times).
// Run via the backfill-league-emails GitHub Actions workflow.

const admin = require('firebase-admin');

async function main() {
  const saRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!saRaw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is required');

  admin.initializeApp({
    credential:  admin.credential.cert(JSON.parse(saRaw)),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });

  const db = admin.database();

  const [seasonsSnap, existingSnap] = await Promise.all([
    db.ref('seasons').once('value'),
    db.ref('notifications/league_assignment').once('value'),
  ]);

  const seasons  = seasonsSnap.val()  || {};
  const existing = existingSnap.val() || {};

  let created = 0;
  let skipped = 0;

  for (const [sid, season] of Object.entries(seasons)) {
    const leagues = season.leagues || {};
    for (const [lid, league] of Object.entries(leagues)) {
      const members = league.members || {};
      for (const uid of Object.keys(members)) {
        const key = `${uid}_${sid}_${lid}`;
        if (existing[key]) {
          skipped++;
          continue;
        }
        await db.ref(`notifications/league_assignment/${key}`).set({
          uid, sid, lid, createdAt: Date.now(),
        });
        console.log(`Created notification: ${key}`);
        created++;
      }
    }
  }

  console.log(`Done. Created: ${created}, skipped (already exist): ${skipped}`);
  process.exit(0);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
