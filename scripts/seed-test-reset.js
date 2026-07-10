// scripts/seed-test-reset.js
// Writes a test password_resets entry for a given email address so that
// send-email.js can be triggered manually to verify the Brevo integration.
// Usage: EMAIL=pablorvarela@gmail.com node seed-test-reset.js
// Requires: FIREBASE_SERVICE_ACCOUNT and FIREBASE_DATABASE_URL env vars.

const admin = require('firebase-admin');

async function main() {
  const email = process.env.EMAIL;
  if (!email) throw new Error('EMAIL env var is required');

  const saRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!saRaw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is required');

  admin.initializeApp({
    credential:  admin.credential.cert(JSON.parse(saRaw)),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });

  const db = admin.database();

  // Look up the player UID by email.
  const snap    = await db.ref('players').once('value');
  const players = snap.val() || {};
  const entry   = Object.entries(players).find(([, p]) => p.email === email);

  if (!entry) {
    console.error(`No player found with email: ${email}`);
    process.exit(1);
  }

  const [uid] = entry;
  const token  = 'test_rst_' + Date.now();

  await db.ref('password_resets/' + token).set({
    uid,
    email,
    expiry:    Date.now() + 3_600_000,
    createdAt: Date.now(),
  });

  console.log(`Created test reset entry: password_resets/${token}`);
  console.log(`email: ${email}  uid: ${uid}`);
  process.exit(0);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
