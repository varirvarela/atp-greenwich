// scripts/cleanup-test-approval.js
// Removes the temporary test player entry created by seed-test-approval.js.

const admin = require('firebase-admin');

async function main() {
  const saRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!saRaw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is required');

  admin.initializeApp({
    credential:  admin.credential.cert(JSON.parse(saRaw)),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });

  const db = admin.database();

  let testUid;
  try {
    testUid = require('fs').readFileSync('/tmp/test-approval-uid.txt', 'utf8').trim();
  } catch {
    console.log('No test UID file found — nothing to clean up.');
    process.exit(0);
  }

  if (!testUid.startsWith('_test_approval_')) {
    console.error('Safety check failed — UID does not look like a test entry:', testUid);
    process.exit(1);
  }

  await db.ref('players/' + testUid).remove();
  console.log(`Removed test entry: players/${testUid}`);
  process.exit(0);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
