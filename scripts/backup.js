// scripts/backup.js — v0.01
// Exports entire Firebase Realtime Database to a JSON file.
// Run by GitHub Actions nightly cron (backup.yml).

const admin = require('firebase-admin');
const fs    = require('fs');

async function main() {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });

  console.log('Starting Firebase backup...');

  const snap = await admin.database().ref('/').once('value');
  const data = snap.val();

  const filename = 'backup-' + new Date().toISOString().slice(0, 10) + '.json';
  fs.writeFileSync(filename, JSON.stringify(data, null, 2));

  console.log('Backup saved to:', filename);
  console.log('Size:', (JSON.stringify(data).length / 1024).toFixed(1), 'KB');

  process.exit(0);
}

main().catch((err) => {
  console.error('Backup failed:', err);
  process.exit(1);
});
