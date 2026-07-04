// Run once to generate VAPID keys for push notifications:
//   cd scripts && node generate-vapid.js
//
// Add the output as GitHub secrets:
//   VAPID_PUBLIC_KEY  → Settings → Secrets → Actions
//   VAPID_PRIVATE_KEY → Settings → Secrets → Actions
//
// Also add VAPID_PUBLIC_KEY as a repo variable for the Vite build:
//   Settings → Variables → Actions → VAPID_PUBLIC_KEY

const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();
console.log('\nVAPID keys generated:\n');
console.log('VAPID_PUBLIC_KEY=', keys.publicKey);
console.log('VAPID_PRIVATE_KEY=', keys.privateKey);
console.log('\nAdd both as GitHub secrets and VAPID_PUBLIC_KEY as a repo variable.\n');
