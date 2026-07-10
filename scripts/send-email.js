// scripts/send-email.js
// Polls Firebase for two types of pending emails and sends them via Brevo:
//   1. New player approvals — players with status 'onboarding' and emailSent != true
//   2. Password resets     — password_resets entries with emailSent != true
// Run every 5 minutes by send-email.yml GitHub Actions workflow.

const admin = require('firebase-admin');
const fetch = require('node-fetch');

const APP_URL       = 'https://varirvarela.github.io/atp-greenwich/';
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const FROM_EMAIL    = 'atpgreenwich@gmail.com';
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
  totalSent += await sendLeagueAssignmentEmails(db, brevoKey);
  totalSent += await sendGroupFixtureEmails(db, brevoKey);
  totalSent += await sendBracketEmails(db, brevoKey);

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

// ─── League assignment emails ──────────────────────────────────────────────────

async function sendLeagueAssignmentEmails(db, brevoKey) {
  const snap   = await db.ref('notifications/league_assignment').once('value');
  const notifs = snap.val() || {};
  let sent = 0;

  for (const [key, notif] of Object.entries(notifs)) {
    if (notif.emailSent === true) continue;
    const { uid, sid, lid } = notif;

    const [playerSnap, seasonSnap] = await Promise.all([
      db.ref(`players/${uid}`).once('value'),
      db.ref(`seasons/${sid}`).once('value'),
    ]);
    const player = playerSnap.val();
    const season = seasonSnap.val();

    if (!player || !player.email) {
      console.warn(`Skipping league assignment ${key} — no player or email`);
      await db.ref(`notifications/league_assignment/${key}/emailSent`).set(true);
      continue;
    }

    const alias          = player.alias || player.username || player.name || 'Player';
    const tournamentName = season?.name  || sid;
    const leagueName     = season?.leagues?.[lid]?.name || lid;

    console.log(`Sending league assignment email to ${player.email} (${alias})`);

    const ok = await sendEmail(brevoKey, {
      to:      [{ email: player.email, name: player.name || alias }],
      subject: "You've been added to a league — ATP Greenwich",
      html:    _leagueAssignmentHtml(alias, tournamentName, leagueName),
    });

    if (ok) {
      await db.ref(`notifications/league_assignment/${key}/emailSent`).set(true);
      sent++;
    }
  }

  return sent;
}

// ─── Group fixture emails ──────────────────────────────────────────────────────

async function sendGroupFixtureEmails(db, brevoKey) {
  const snap   = await db.ref('notifications/group_fixtures').once('value');
  const notifs = snap.val() || {};
  let sent = 0;

  for (const [key, notif] of Object.entries(notifs)) {
    if (notif.emailSent === true) continue;
    const { sid, lid } = notif;

    const [playersSnap, seasonSnap] = await Promise.all([
      db.ref('players').once('value'),
      db.ref(`seasons/${sid}`).once('value'),
    ]);
    const players = playersSnap.val() || {};
    const season  = seasonSnap.val();
    const league  = season?.leagues?.[lid];

    if (!league) {
      console.warn(`Skipping group fixtures ${key} — league not found`);
      await db.ref(`notifications/group_fixtures/${key}/emailSent`).set(true);
      continue;
    }

    const leagueName = league.name || lid;
    const deadline   = league.groupStageConfig?.deadline
      ? new Date(league.groupStageConfig.deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      : null;

    const members = Object.keys(league.members || {});
    const matches = Object.values(league.matches || {}).filter(m => m.groupMatch === true);

    for (const uid of members) {
      const player = players[uid];
      if (!player?.email) continue;

      const myMatches = matches.filter(m => m.playerA === uid || m.playerB === uid);
      const opponents = myMatches.map(m => {
        const oppUid = m.playerA === uid ? m.playerB : m.playerA;
        const opp    = players[oppUid];
        return opp?.alias || opp?.username || opp?.name || oppUid;
      });

      if (opponents.length === 0) continue;

      const alias = player.alias || player.username || player.name || 'Player';
      console.log(`Sending fixtures email to ${player.email} (${alias})`);

      const ok = await sendEmail(brevoKey, {
        to:      [{ email: player.email, name: player.name || alias }],
        subject: 'Your group stage fixtures are ready — ATP Greenwich',
        html:    _groupFixturesHtml(alias, leagueName, deadline, opponents),
      });

      if (ok) sent++;
    }

    await db.ref(`notifications/group_fixtures/${key}/emailSent`).set(true);
  }

  return sent;
}

// ─── Bracket emails ────────────────────────────────────────────────────────────

async function sendBracketEmails(db, brevoKey) {
  const snap   = await db.ref('notifications/bracket').once('value');
  const notifs = snap.val() || {};
  let sent = 0;

  for (const [key, notif] of Object.entries(notifs)) {
    if (notif.emailSent === true) continue;
    const { sid, lid } = notif;

    const [playersSnap, seasonSnap] = await Promise.all([
      db.ref('players').once('value'),
      db.ref(`seasons/${sid}`).once('value'),
    ]);
    const players = playersSnap.val() || {};
    const season  = seasonSnap.val();
    const league  = season?.leagues?.[lid];
    const bracket = league?.bracket;

    if (!bracket?.rounds?.r0) {
      console.warn(`Skipping bracket ${key} — no bracket found`);
      await db.ref(`notifications/bracket/${key}/emailSent`).set(true);
      continue;
    }

    const tournamentName = season?.name || sid;
    const leagueName     = league?.name || lid;
    const firstRound     = bracket.rounds.r0;
    const roundName      = firstRound.name || 'Quarterfinals';

    for (const match of Object.values(firstRound.matches || {})) {
      const { playerA, playerB } = match;
      if (!playerA || !playerB || match.score === 'BYE') continue;

      for (const [uid, oppUid] of [[playerA, playerB], [playerB, playerA]]) {
        const player = players[uid];
        const opp    = players[oppUid];
        if (!player?.email) continue;

        const alias    = player.alias || player.username || player.name || 'Player';
        const oppAlias = opp?.alias   || opp?.username   || opp?.name   || 'your opponent';

        console.log(`Sending bracket email to ${player.email} (${alias})`);

        const ok = await sendEmail(brevoKey, {
          to:      [{ email: player.email, name: player.name || alias }],
          subject: 'The knockout bracket is live — ATP Greenwich',
          html:    _bracketHtml(alias, tournamentName, leagueName, roundName, oppAlias),
        });

        if (ok) sent++;
      }
    }

    await db.ref(`notifications/bracket/${key}/emailSent`).set(true);
  }

  return sent;
}

// ─── Email HTML templates ──────────────────────────────────────────────────────

const IMAGES_URL = 'https://varirvarela.github.io/atp-greenwich/images';

function _emailShell(subtitle, imageFile, body, footer) {
  return `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;border-radius:16px;overflow:hidden;border:1px solid #e8e2db;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#b84008;">
    <tr>
      <td style="padding:24px 28px 20px;">
        <table cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding-right:14px;vertical-align:middle;">
              <img src="${IMAGES_URL}/atp-icon-512.png" alt="ATP Greenwich" width="40" height="40" style="border-radius:10px;display:block;">
            </td>
            <td style="vertical-align:middle;">
              <div style="font-size:18px;font-weight:700;color:#fff;line-height:1.1;">ATP Greenwich</div>
              <div style="font-size:12px;color:rgba(255,255,255,0.7);margin-top:2px;">${subtitle}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
  <div style="background:#f5ede4;text-align:center;padding:32px 0 0;">
    <img src="${IMAGES_URL}/${imageFile}" alt="" width="220" style="display:block;margin:0 auto;">
  </div>
  <div style="background:#ffffff;padding:32px 28px 28px;">${body}</div>
  <div style="background:#f7f3ef;padding:16px 28px;border-top:1px solid #ede7df;">
    <p style="font-size:12px;color:#8a7e72;margin:0;line-height:1.6;">${footer}</p>
  </div>
</div>`;
}

function _infoCard(rows) {
  const cells = rows.map(([label, value, highlight]) => `
    <tr><td style="font-size:11px;color:#8a7e72;text-transform:uppercase;letter-spacing:0.6px;padding-bottom:3px;">${label}</td></tr>
    <tr><td style="font-size:${highlight ? '20px' : '16px'};font-weight:700;color:${highlight ? '#b84008' : '#1c1814'};padding-bottom:${highlight ? '0' : '14px'};">${value}</td></tr>
  `).join('');
  return `<div style="background:#f7f3ef;border-left:4px solid #b84008;border-radius:0 10px 10px 0;padding:16px 20px;margin-bottom:28px;">
    <table style="border-collapse:collapse;">${cells}</table>
  </div>`;
}

function _ctaButton(label) {
  return `<a href="${APP_URL}" style="display:inline-block;background:#b84008;color:#fff;text-decoration:none;border-radius:10px;padding:14px 32px;font-size:15px;font-weight:700;">${label} →</a>`;
}

function _leagueAssignmentHtml(alias, tournamentName, leagueName) {
  const body = `
    <h2 style="font-size:22px;font-weight:700;color:#1c1814;margin:0 0 8px 0;">You're in a league, ${escName(alias)}!</h2>
    <p style="font-size:15px;color:#4a4038;line-height:1.7;margin:0 0 24px 0;">
      The admin has added you to a league. Head to the app to see your opponents and start scheduling matches.
    </p>
    ${_infoCard([['Tournament', escName(tournamentName), false], ['Your league', escName(leagueName), true]])}
    ${_ctaButton('Open ATP Greenwich')}
  `;
  return _emailShell('League Management', 'atp-match-confirmed.png', body,
    "You're receiving this because you were assigned to a league by the tournament admin.");
}

function _groupFixturesHtml(alias, leagueName, deadline, opponents) {
  const deadlineBlock = deadline ? `
    <div style="background:#f7f3ef;border-left:4px solid #b84008;border-radius:0 10px 10px 0;padding:14px 20px;margin-bottom:20px;">
      <div style="font-size:11px;color:#8a7e72;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">Play-by deadline</div>
      <div style="font-size:20px;font-weight:700;color:#b84008;">${escName(deadline)}</div>
    </div>` : '';

  const rows = opponents.map(opp => `
    <tr>
      <td style="padding:12px 0;font-size:15px;font-weight:600;color:#1c1814;border-bottom:1px solid #f0ebe4;">${escName(opp)}</td>
      <td style="padding:12px 0;text-align:right;border-bottom:1px solid #f0ebe4;">
        <span style="font-size:12px;color:#8a7e72;background:#f7f3ef;padding:3px 10px;border-radius:20px;">Fixture</span>
      </td>
    </tr>`).join('');

  const body = `
    <h2 style="font-size:22px;font-weight:700;color:#1c1814;margin:0 0 8px 0;">Your fixtures are live, ${escName(alias)}!</h2>
    <p style="font-size:15px;color:#4a4038;line-height:1.7;margin:0 0 24px 0;">
      Group stage matches for <strong>${escName(leagueName)}</strong> have been published.
      You have <strong>${opponents.length} ${opponents.length === 1 ? 'match' : 'matches'}</strong> to play${deadline ? ' before the deadline' : ''} — coordinate with your opponents and log results in the app.
    </p>
    ${deadlineBlock}
    <div style="font-size:11px;color:#8a7e72;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:10px;">Your opponents</div>
    <table width="100%" style="border-collapse:collapse;margin-bottom:28px;">${rows}</table>
    ${_ctaButton('See my fixtures')}
  `;
  return _emailShell('Group Stage', 'atp-onboarding-serve.png', body,
    "You're receiving this because the admin published group stage fixtures for your league.");
}

function _bracketHtml(alias, tournamentName, leagueName, roundName, opponentAlias) {
  const body = `
    <h2 style="font-size:22px;font-weight:700;color:#1c1814;margin:0 0 8px 0;">You're in the bracket, ${escName(alias)}!</h2>
    <p style="font-size:15px;color:#4a4038;line-height:1.7;margin:0 0 24px 0;">
      You've qualified for the knockout stage in <strong>${escName(tournamentName)}</strong>. Here's your first match — good luck!
    </p>
    ${_infoCard([
      ['Tournament', `${escName(tournamentName)} — ${escName(leagueName)}`, false],
      ['Round', escName(roundName), false],
      ['Your opponent', escName(opponentAlias), true],
    ])}
    ${_ctaButton('See the bracket')}
  `;
  return _emailShell('Knockout Stage', 'atp-bracket-start.png', body,
    "You're receiving this because the knockout bracket for your tournament has been published.");
}

// ─── Run ──────────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error('send-email failed:', err.message);
  process.exit(1);
});
