// scripts/seed-test-approval.js
// Writes a temporary 'onboarding' player entry so send-email.js can send
// an approval email to the given address for testing purposes.
// Usage: EMAIL=pablorvarela@gmail.com node seed-test-approval.js
// The entry is cleaned up by cleanup-test-approval.js after the mailer runs.

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

  // Look up the real player to get their alias (if they exist).
  const snap    = await db.ref('players').once('value');
  const players = snap.val() || {};
  const entry   = Object.entries(players).find(([, p]) => p.email === email);

  const alias = entry ? (entry[1].alias || entry[1].username || 'Player') : 'Player';
  const name  = entry ? (entry[1].name  || alias)                         : alias;

  const testUid = '_test_approval_' + Date.now();

  await db.ref('players/' + testUid).set({
    name,
    alias,
    username: alias,
    email,
    status:    'onboarding',
    createdAt: Date.now(),
    _isTestEntry: true,
  });

  console.log(`Created test approval entry: players/${testUid}`);
  console.log(`email: ${email}  alias: ${alias}`);

  // Write the UID to a temp file so the cleanup step can remove it.
  require('fs').writeFileSync('/tmp/test-approval-uid.txt', testUid);
  process.exit(0);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
