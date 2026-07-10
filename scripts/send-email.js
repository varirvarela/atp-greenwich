// scripts/send-email.js
// Polls Firebase for two types of pending emails and sends them via Brevo:
//   1. New player approvals — players with status 'onboarding' and emailSent != true
//   2. Password resets     — password_resets entries with emailSent != true
// Run every 5 minutes by send-email.yml GitHub Actions workflow.

const admin = require('firebase-admin');
const fetch = require('node-fetch');

const APP_URL       = 'https://varirvarela.github.io/atp-greenwich/';
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const FROM_EMAIL    = 'atp.greenwich.league@gmail.com';
const FROM_NAME     = 'ATP Greenwich';

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function main() {
  const saRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!saRaw || saRaw.trim() === '') {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT secret is missing or empty. ' +
      'Add it under GitHub repo → Settings → Secrets → Actions.'
    );
  }

  const brevoKey = process.env.BREVO_API_KEY;
  if (!brevoKey || brevoKey.trim() === '') {
    throw new Error(
      'BREVO_API_KEY secret is missing or empty. ' +
      'Add it under GitHub repo → Settings → Secrets → Actions.'
    );
  }

  admin.initializeApp({
    credential:  admin.credential.cert(JSON.parse(saRaw)),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });

  const db = admin.database();

  let totalSent = 0;
  totalSent += await sendApprovalEmails(db, brevoKey);
  totalSent += await sendPasswordResetEmails(db, brevoKey);

  console.log(`Done. Total emails sent: ${totalSent}`);
  process.exit(0);
}

// ─── Approval emails ──────────────────────────────────────────────────────────

async function sendApprovalEmails(db, brevoKey) {
  const snap    = await db.ref('players').once('value');
  const players = snap.val() || {};
  let sent = 0;

  for (const [uid, player] of Object.entries(players)) {
    if (player.status !== 'onboarding') continue;
    if (player.emailSent === true) continue;
    if (!player.email) {
      console.warn(`Skipping approval for ${uid} — no email on record`);
      continue;
    }

    const name = player.name || player.alias || 'Player';
    console.log(`Sending approval email to ${player.email} (${name})`);

    const alias = player.alias || player.username || name;
    const ok = await sendEmail(brevoKey, {
      to:      [{ email: player.email, name }],
      subject: 'You\'re in — ATP Greenwich League',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;">
          <h1 style="font-size:22px;color:#b84008;margin-bottom:8px;">ATP Greenwich</h1>
          <p style="font-size:16px;color:#1c1814;margin-bottom:24px;">Hi ${escName(name)},</p>
          <p style="font-size:15px;color:#4a4038;line-height:1.6;margin-bottom:16px;">
            Your account has been approved — welcome to the league!
          </p>
          <table style="background:#f7f3ef;border-radius:10px;padding:16px 20px;margin-bottom:24px;width:100%;border-collapse:collapse;">
            <tr>
              <td style="font-size:13px;color:#8a7e72;padding-bottom:4px;">Your alias on the app</td>
            </tr>
            <tr>
              <td style="font-size:20px;font-weight:700;color:#b84008;letter-spacing:0.5px;">${escName(alias)}</td>
            </tr>
          </table>
          <a href="${APP_URL}"
            style="display:inline-block;background:#b84008;color:#fff;text-decoration:none;
              border-radius:10px;padding:13px 28px;font-size:15px;font-weight:700;">
            Open ATP Greenwich
          </a>
          <p style="font-size:12px;color:#8a7e72;margin-top:32px;line-height:1.5;">
            If you didn't request access, you can ignore this email.
          </p>
        </div>
      `,
    });

    if (ok) {
      await db.ref(`players/${uid}/emailSent`).set(true);
      sent++;
    }
  }

  return sent;
}

// ─── Password reset emails ────────────────────────────────────────────────────

async function sendPasswordResetEmails(db, brevoKey) {
  const snap   = await db.ref('password_resets').once('value');
  const resets = snap.val() || {};
  let sent = 0;

  for (const [token, record] of Object.entries(resets)) {
    if (record.emailSent === true) continue;
    if (!record.email) {
      console.warn(`Skipping reset token ${token} — no email`);
      continue;
    }
    if (record.expiry && record.expiry < Date.now()) {
      console.log(`Skipping expired reset token for ${record.email}`);
      continue;
    }

    const resetUrl = `${APP_URL}?reset=${token}`;
    console.log(`Sending password reset email to ${record.email}`);

    const ok = await sendEmail(brevoKey, {
      to:      [{ email: record.email }],
      subject: 'Reset your ATP Greenwich password',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;">
          <h1 style="font-size:22px;color:#b84008;margin-bottom:8px;">ATP Greenwich</h1>
          <p style="font-size:15px;color:#4a4038;line-height:1.6;margin-bottom:24px;">
            We received a request to reset your password. Click the button below to set a new one.
            This link expires in 1 hour.
          </p>
          <a href="${resetUrl}"
            style="display:inline-block;background:#b84008;color:#fff;text-decoration:none;
              border-radius:10px;padding:13px 28px;font-size:15px;font-weight:700;">
            Reset Password
          </a>
          <p style="font-size:12px;color:#8a7e72;margin-top:32px;line-height:1.5;">
            If you didn't request a password reset, you can ignore this email.<br>
            Link: ${resetUrl}
          </p>
        </div>
      `,
    });

    if (ok) {
      await db.ref(`password_resets/${token}/emailSent`).set(true);
      sent++;
    }
  }

  return sent;
}

// ─── Brevo sender ─────────────────────────────────────────────────────────────

async function sendEmail(brevoKey, { to, subject, html }) {
  try {
    const res = await fetch(BREVO_API_URL, {
      method:  'POST',
      headers: {
        'api-key':      brevoKey,
        'Content-Type': 'application/json',
        'Accept':       'application/json',
      },
      body: JSON.stringify({
        sender:      { name: FROM_NAME, email: FROM_EMAIL },
        to,
        subject,
        htmlContent: html,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`Brevo error ${res.status}: ${body}`);
      return false;
    }

    return true;
  } catch (err) {
    console.error('sendEmail network error:', err.message);
    return false;
  }
}

function escName(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Run ──────────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error('send-email failed:', err.message);
  process.exit(1);
});
