// scripts/backfill-league-notifications.js
// Idempotent: writes missing email notifications AND feed activity entries for
// every player already in a league. Safe to run multiple times.
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

  const [seasonsSnap, existingNotifSnap, existingActivitySnap] = await Promise.all([
    db.ref('seasons').once('value'),
    db.ref('notifications/league_assignment').once('value'),
    db.ref('activity').once('value'),
  ]);

  const seasons          = seasonsSnap.val()          || {};
  const existingNotifs   = existingNotifSnap.val()    || {};
  const existingActivity = existingActivitySnap.val() || {};

  let notifsCreated = 0, notifsSkipped = 0;
  let actCreated = 0,    actSkipped = 0;

  for (const [sid, season] of Object.entries(seasons)) {
    const leagues = season.leagues || {};
    for (const [lid, league] of Object.entries(leagues)) {
      const members = league.members || {};
      for (const [uid, member] of Object.entries(members)) {

        // ── Email notification ────────────────────────────────────────────────
        const notifKey = `${uid}_${sid}_${lid}`;
        if (existingNotifs[notifKey]) {
          notifsSkipped++;
        } else {
          await db.ref(`notifications/league_assignment/${notifKey}`).set({
            uid, sid, lid, createdAt: Date.now(),
          });
          console.log(`Created notification: ${notifKey}`);
          notifsCreated++;
        }

        // ── Feed activity — deterministic key prevents duplicate cards ────────
        const actKey = `backfill_join_${uid}_${sid}_${lid}`;
        if (existingActivity[actKey]) {
          actSkipped++;
        } else {
          await db.ref(`activity/${actKey}`).set({
            type: 'joined_league',
            ts:   (member && member.joinedAt) || Date.now(),
            uid, sid, lid,
          });
          console.log(`Created activity: ${actKey}`);
          actCreated++;
        }
      }
    }
  }

  console.log(`Notifications — created: ${notifsCreated}, skipped: ${notifsSkipped}`);
  console.log(`Activity      — created: ${actCreated}, skipped: ${actSkipped}`);
  process.exit(0);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
