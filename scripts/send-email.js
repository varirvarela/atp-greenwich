// scripts/send-email.js — v0.01
// Sends approval emails via Brevo for approved access requests.
// Phase 5 feature — placeholder script created now so the workflow exists.
// Full implementation added in Phase 5.

const admin = require('firebase-admin');

async function main() {
  // Phase 5: full implementation
  // 1. Scan players for status === 'pending_approval' && !emailSent
  // 2. Send Brevo email with app link
  // 3. Mark emailSent: true
  console.log('send-email.js — Phase 5 placeholder. No emails sent.');
  process.exit(0);
}

main().catch((err) => {
  console.error('send-email error:', err);
  process.exit(1);
});
