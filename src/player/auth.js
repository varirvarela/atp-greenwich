// src/player/auth.js — All auth and onboarding screens for the player app
// Each exported function renders a full screen into the `container` element.
// Navigation between screens is handled via callbacks, not a router.

import { dbGet, dbRef, pRef, dbSet, dbMultiUpdate, dbListen } from '@shared/firebase.js';
import { simpleHash, toEmailKey, generateUid, isValidEmail, isValidPassword, escHtml } from '@shared/utils.js';
import { getStartingElo } from '@shared/elo.js';
import { initAnalytics, logAppOpen } from '@shared/analytics.js';
import { renderAvatarPicker, avatarToSvg } from '@player/avatars.js';

// ─── Module-level auth state ──────────────────────────────────────────────────
// Accumulated across new-user screens before final localStorage write
let _pending = { uid: null, pwdHash: null, email: null };

// Active real-time listener — cleaned up before any new screen renders
let _unsubscribeFn = null;

function _detachListener() {
  if (_unsubscribeFn) {
    _unsubscribeFn();
    _unsubscribeFn = null;
  }
}

// ─── Toast system ─────────────────────────────────────────────────────────────

function showToast(message, type) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'toast' + (type ? ' ' + type : '');
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 200);
  }, 3200);
}

// ─── Alias availability check ────────────────────────────────────────────────
// Returns true if alias is free, or an error string if already taken.

async function _checkAliasAvailable(alias, excludeUid) {
  try {
    const all = await dbGet(pRef());
    if (!all) return true;
    const taken = Object.entries(all)
      .filter(([id]) => !excludeUid || id !== excludeUid)
      .some(([, p]) =>
        (p.username || '').toLowerCase() === alias.toLowerCase() ||
        (p.alias    || '').toLowerCase() === alias.toLowerCase()
      );
    return taken ? 'Alias already taken — choose another.' : true;
  } catch {
    return true; // fail open on network error
  }
}

// ─── Avatar duplicate check ───────────────────────────────────────────────────
// Returns true if no other player has this avatarId, or a message string if taken.

async function _checkNoDuplicate(avatarId, excludeUid) {
  try {
    const allPlayers = await dbGet(pRef());
    if (!allPlayers) return true;
    const taken = Object.entries(allPlayers)
      .filter(([id]) => id !== excludeUid)
      .some(([, p]) => p.avatarId === avatarId);
    return taken ? 'Someone else already has this one — trying another…' : true;
  } catch {
    return true; // allow on network error
  }
}

// ─── Shared form helpers ──────────────────────────────────────────────────────

// Real-time password match feedback. Call from both pw and pw2 input handlers.
function _checkPwMatch(pwInput, pw2Input, errEl) {
  const pw  = pwInput.value;
  const pw2 = pw2Input.value;
  if (pw2.length === 0) {
    errEl.style.display = 'none';
    pw2Input.classList.remove('error', 'valid');
    return;
  }
  if (pw !== pw2) {
    errEl.textContent = 'Passwords do not match.';
    errEl.style.display = 'block';
    pw2Input.classList.add('error');
    pw2Input.classList.remove('valid');
  } else {
    errEl.style.display = 'none';
    pw2Input.classList.remove('error');
    pw2Input.classList.add('valid');
  }
}

// ─── Screen A — Onboarding ────────────────────────────────────────────────────

export function showOnboarding(container, onAuthenticated) {
  _detachListener();

  // Check for ?code= param — if present, skip straight to invite code screen
  const params = new URLSearchParams(window.location.search);
  const codeParam = params.get('code') || '';
  if (codeParam) {
    showInviteCode(container, codeParam, onAuthenticated);
    return;
  }

  const base     = import.meta.env.BASE_URL;
  const heroImgs = ['atp-onboarding-serve.png', 'atp-onboarding-parrilla.png'];
  const heroImg  = heroImgs[Math.floor(Math.random() * heroImgs.length)];

  container.innerHTML = `
    <div class="screen-center" style="text-align:center;gap:0;padding-bottom:32px;">
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;">

        <!-- Hero image — randomly chosen each visit -->
        <img src="${base}images/${heroImg}" alt=""
          style="width:200px;height:200px;object-fit:cover;border-radius:20px;margin-bottom:4px;">

        <div class="auth-logo">ATP</div>
        <div class="auth-sub" style="margin-bottom:2px;">Greenwich</div>
        <p class="auth-tagline">Amateur Tennis and Parrilla.<br>Private league for friends.</p>
      </div>
      <div style="width:100%;display:flex;flex-direction:column;gap:12px;max-width:320px;">
        <button class="btn btn-primary" id="btn-request">Request Access</button>
        <button class="btn btn-secondary" id="btn-code">I have an invite code</button>
        <button class="btn btn-ghost" id="btn-login" style="margin-top:4px;">Already a member? Sign in</button>
      </div>
      <div class="version-label" style="margin-top:24px;">v0.02 — Phase 1B</div>
    </div>
  `;

  container.querySelector('#btn-request').addEventListener('click', () => {
    showRequestAccess(container, onAuthenticated);
  });

  container.querySelector('#btn-code').addEventListener('click', () => {
    showInviteCode(container, '', onAuthenticated);
  });

  container.querySelector('#btn-login').addEventListener('click', () => {
    showLogin(container, onAuthenticated);
  });
}

// ─── Screen B — Request Access ────────────────────────────────────────────────

function showRequestAccess(container, onAuthenticated) {
  _detachListener();

  container.innerHTML = `
    <div class="screen" style="gap:0;">
      <div style="padding-top:16px;">
        <button class="back-btn" id="btn-back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="m15 18-6-6 6-6"/>
          </svg>
          Back
        </button>
      </div>

      <div style="margin-bottom:28px;">
        <h1 class="t-h2" style="margin-bottom:6px;">Request Access</h1>
        <p class="t-small t-muted">Fill in your details. An admin will approve you.</p>
      </div>

      <div style="display:flex;flex-direction:column;gap:16px;flex:1;">
        <div class="input-group">
          <label class="input-label" for="ra-name">Full Name</label>
          <input class="input" id="ra-name" type="text" placeholder="e.g. John Smith"
            autocomplete="name" autocapitalize="words" maxlength="60">
        </div>

        <div class="input-group">
          <label class="input-label" for="ra-email">Email</label>
          <input class="input" id="ra-email" type="email" placeholder="you@example.com"
            autocomplete="email" autocapitalize="none" autocorrect="off" maxlength="120">
          <div class="input-hint" id="ra-email-hint"></div>
        </div>

        <div class="input-group">
          <label class="input-label" for="ra-alias">Alias / Username</label>
          <input class="input" id="ra-alias" type="text" placeholder="Your nickname on the court"
            autocomplete="username" autocapitalize="none" autocorrect="off" maxlength="30">
          <div class="input-hint" id="ra-alias-hint" style="font-size:12px;color:var(--text3);">
            Shown on standings. Letters and numbers only.
          </div>
        </div>

        <div class="input-group">
          <label class="input-label" for="ra-pw">Password</label>
          <input class="input" id="ra-pw" type="password" placeholder="Min 6 characters"
            autocomplete="new-password" maxlength="100">
          <div class="pw-strength"><div class="pw-strength-bar" id="ra-pw-bar"></div></div>
        </div>

        <div class="input-group">
          <label class="input-label" for="ra-pw2">Confirm Password</label>
          <input class="input" id="ra-pw2" type="password" placeholder="Repeat your password"
            autocomplete="new-password" maxlength="100">
          <div class="input-error" id="ra-pw2-err" style="display:none;"></div>
        </div>
      </div>

      <div style="margin-top:24px;padding-bottom:16px;">
        <button class="btn btn-primary" id="btn-submit" disabled>Request Access</button>
      </div>
    </div>
  `;

  const nameInput  = container.querySelector('#ra-name');
  const emailInput = container.querySelector('#ra-email');
  const aliasInput = container.querySelector('#ra-alias');
  const pwInput    = container.querySelector('#ra-pw');
  const pw2Input   = container.querySelector('#ra-pw2');
  const emailHint  = container.querySelector('#ra-email-hint');
  const aliasHint  = container.querySelector('#ra-alias-hint');
  const pw2Err     = container.querySelector('#ra-pw2-err');
  const pwBar      = container.querySelector('#ra-pw-bar');
  const submitBtn  = container.querySelector('#btn-submit');

  container.querySelector('#btn-back').addEventListener('click', () => {
    showOnboarding(container, onAuthenticated);
  });

  // Email duplicate check — debounced 500ms
  let emailDebounce = null;
  let emailValid = false;

  // Alias availability check — debounced 500ms
  let aliasDebounce = null;
  let aliasValid = false;

  aliasInput.addEventListener('input', () => {
    clearTimeout(aliasDebounce);
    aliasInput.classList.remove('error', 'valid');
    aliasHint.style.color = 'var(--text3)';
    aliasHint.textContent = 'Shown on standings. Letters and numbers only.';
    aliasValid = false;
    updateSubmit();

    const val = aliasInput.value.trim();
    if (val.length < 2) return;

    aliasDebounce = setTimeout(async () => {
      aliasHint.textContent = 'Checking…';
      const result = await _checkAliasAvailable(val);
      if (result === true) {
        aliasInput.classList.add('valid');
        aliasHint.style.color = 'var(--ace2)';
        aliasHint.textContent = 'Alias available';
        aliasValid = true;
      } else {
        aliasInput.classList.add('error');
        aliasHint.style.color = 'var(--ace3)';
        aliasHint.textContent = result;
        aliasValid = false;
      }
      updateSubmit();
    }, 500);
  });

  emailInput.addEventListener('input', () => {
    clearTimeout(emailDebounce);
    emailHint.textContent = '';
    emailHint.style.color = 'var(--text3)';
    emailInput.classList.remove('error', 'valid');
    emailValid = false;
    updateSubmit();

    const val = emailInput.value.trim();
    if (!val || !isValidEmail(val)) return;

    emailDebounce = setTimeout(async () => {
      emailHint.textContent = 'Checking…';
      try {
        const key = toEmailKey(val);
        const existing = await dbGet(dbRef('email_index/' + key));
        if (existing) {
          emailInput.classList.add('error');
          emailHint.style.color = 'var(--ace3)';
          emailHint.textContent = 'This email is already registered. Sign in instead?';
          emailValid = false;
        } else {
          emailInput.classList.add('valid');
          emailHint.style.color = 'var(--ace2)';
          emailHint.textContent = 'Email available';
          emailValid = true;
        }
      } catch {
        emailHint.textContent = '';
        emailValid = true; // allow submit on network error
      }
      updateSubmit();
    }, 500);
  });

  // Password strength indicator + re-check confirm field match
  pwInput.addEventListener('input', () => {
    const len = pwInput.value.length;
    pwBar.className = 'pw-strength-bar';
    if (len >= 10)     pwBar.classList.add('strong');
    else if (len >= 6) pwBar.classList.add('medium');
    else if (len > 0)  pwBar.classList.add('weak');
    _checkPwMatch(pwInput, pw2Input, pw2Err);
    updateSubmit();
  });

  pw2Input.addEventListener('input', () => {
    _checkPwMatch(pwInput, pw2Input, pw2Err);
    updateSubmit();
  });

  nameInput.addEventListener('input', updateSubmit);
  aliasInput.addEventListener('input', updateSubmit);

  function updateSubmit() {
    const name  = nameInput.value.trim();
    const email = emailInput.value.trim();
    const alias = aliasInput.value.trim();
    const pw    = pwInput.value;
    const pw2   = pw2Input.value;
    const ready = name.length >= 2
      && isValidEmail(email)
      && emailValid
      && alias.length >= 2
      && aliasValid
      && isValidPassword(pw)
      && pw === pw2;
    submitBtn.disabled = !ready;
  }

  submitBtn.addEventListener('click', async () => {
    const name  = nameInput.value.trim();
    const email = emailInput.value.trim().toLowerCase();
    const alias = aliasInput.value.trim();
    const pw    = pwInput.value;
    const pw2   = pw2Input.value;

    if (pw !== pw2) {
      pw2Err.textContent = 'Passwords do not match.';
      pw2Err.style.display = 'block';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';

    try {
      const uid      = generateUid('player');
      const emailKey = toEmailKey(email);
      const pwdHash  = simpleHash(pw);
      const now      = Date.now();

      await dbMultiUpdate({
        ['players/' + uid]: {
          name,
          email,
          username: alias,
          alias,
          passwordHash: pwdHash,
          avatarId: null,
          eloRating: null,
          eloHistory: [],
          adminRole: null,
          status: 'invited',
          selfAssessment: null,
          createdAt: now,
          lastActive: now,
        },
        ['email_index/' + emailKey]: uid,
        ['pending_approvals/' + uid]: {
          name,
          email,
          username: alias,
          createdAt: now,
          status: 'pending',
        },
      });

      _pending = { uid, pwdHash, email };
      showWaitingApproval(container, uid, name, onAuthenticated);

    } catch (err) {
      console.error('Request access error:', err);
      showToast('Something went wrong. Please try again.', 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Request Access';
    }
  });
}

// ─── Screen C — Waiting for Approval ─────────────────────────────────────────

function showWaitingApproval(container, uid, playerName, onAuthenticated) {
  _detachListener();

  container.innerHTML = `
    <div class="screen-center" style="text-align:center;gap:20px;">
      <div style="width:72px;height:72px;border-radius:50%;background:var(--ace-bg);display:flex;align-items:center;justify-content:center;">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--ace)" stroke-width="1.8"
          stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
          <path d="M12 6v6l4 2"/>
        </svg>
      </div>
      <div>
        <h2 class="t-h2" style="margin-bottom:8px;">Hang tight, ${escHtml(playerName ? playerName.split(' ')[0] : 'friend')}!</h2>
        <p class="t-body t-muted" style="max-width:280px;margin:0 auto;">
          Your request is in. An admin will approve you shortly.
          This page will update automatically.
        </p>
      </div>
      <div class="pulse-dots">
        <div class="pulse-dot"></div>
        <div class="pulse-dot"></div>
        <div class="pulse-dot"></div>
      </div>
      <div class="card" style="max-width:300px;text-align:left;">
        <div class="t-label t-muted" style="margin-bottom:6px;">Your account</div>
        <div style="font-weight:700;font-size:15px;">${escHtml(playerName || '')}</div>
        <div class="t-small t-muted" id="wait-status-label"
          style="margin-top:4px;font-family:var(--font-mono);font-size:11px;">
          Status: waiting for approval
        </div>
      </div>
      <p class="t-small t-muted" style="max-width:260px;">
        You can close this tab and come back later — your account will be ready when you return.
      </p>
    </div>
  `;

  // Listen for status change to 'onboarding'
  _unsubscribeFn = dbListen(pRef(uid, 'status'), (status) => {
    if (status === 'onboarding') {
      _detachListener();
      showToast('You\'ve been approved! Let\'s set up your profile.', 'success');
      showSelfAssessment(container, uid, onAuthenticated);
    } else if (status === 'active') {
      // Admin fast-tracked the player all the way to active
      _detachListener();
      _launchAfterSetup(container, uid, onAuthenticated);
    }
  });
}

// ─── Screen D — Invite Code ───────────────────────────────────────────────────

function showInviteCode(container, prefillCode, onAuthenticated) {
  _detachListener();

  container.innerHTML = `
    <div class="screen" style="gap:0;">
      <div style="padding-top:16px;">
        <button class="back-btn" id="btn-back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="m15 18-6-6 6-6"/>
          </svg>
          Back
        </button>
      </div>

      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;padding:16px 0;">
        <div style="text-align:center;">
          <div style="font-size:40px;margin-bottom:12px;">🎾</div>
          <h1 class="t-h2" style="margin-bottom:8px;">Enter Invite Code</h1>
          <p class="t-small t-muted">Your invite code was sent by the league admin.</p>
        </div>

        <div class="input-group" style="width:100%;">
          <input class="input input-code" id="ic-input" type="text"
            placeholder="XXXX-XXXX" maxlength="9"
            autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false">
          <div class="input-error" id="ic-error" style="display:none;text-align:center;"></div>
        </div>

        <div id="ic-preview" style="display:none;text-align:center;">
          <div class="badge badge-teal" style="font-size:13px;padding:6px 14px;font-family:var(--font-sans);font-weight:700;letter-spacing:0;" id="ic-name"></div>
          <div class="t-small t-muted" style="margin-top:6px;">Ready to join ATP Greenwich</div>
        </div>
      </div>

      <div style="padding-bottom:16px;">
        <button class="btn btn-primary" id="btn-validate" disabled>Verify Code</button>
      </div>
    </div>
  `;

  const input    = container.querySelector('#ic-input');
  const errorEl  = container.querySelector('#ic-error');
  const preview  = container.querySelector('#ic-preview');
  const nameEl   = container.querySelector('#ic-name');
  const validateBtn = container.querySelector('#btn-validate');

  container.querySelector('#btn-back').addEventListener('click', () => {
    // Clear URL params when going back
    window.history.replaceState({}, '', window.location.pathname);
    showOnboarding(container, onAuthenticated);
  });

  // Auto-format as user types: XXXX-XXXX
  input.addEventListener('input', (e) => {
    let raw = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (raw.length > 4) raw = raw.slice(0, 4) + '-' + raw.slice(4, 8);
    e.target.value = raw;
    errorEl.style.display = 'none';
    preview.style.display = 'none';
    validateBtn.disabled = raw.length < 9;
    validateBtn.textContent = 'Verify Code';
  });

  // Pre-fill from URL param
  if (prefillCode) {
    let raw = prefillCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (raw.length > 4) raw = raw.slice(0, 4) + '-' + raw.slice(4, 8);
    input.value = raw;
    if (raw.length >= 9) validateBtn.disabled = false;
  }

  validateBtn.addEventListener('click', async () => {
    const code = input.value.trim();
    if (code.length < 9) return;

    validateBtn.disabled = true;
    validateBtn.textContent = 'Checking…';
    errorEl.style.display = 'none';

    try {
      const record = await dbGet(dbRef('invite_codes/' + code));

      if (!record) {
        errorEl.textContent = 'Code not found. Double-check and try again.';
        errorEl.style.display = 'block';
        validateBtn.disabled = false;
        validateBtn.textContent = 'Verify Code';
        return;
      }

      if (record.used) {
        errorEl.textContent = 'This code has already been used.';
        errorEl.style.display = 'block';
        validateBtn.disabled = false;
        validateBtn.textContent = 'Verify Code';
        return;
      }

      // Generate a fresh uid — the player will fill in their own details
      const newUid = generateUid('player');
      _pending = { uid: newUid, pwdHash: null, email: null };

      nameEl.textContent = 'Code verified ✓';
      preview.style.display = 'block';
      validateBtn.textContent = 'Continue →';
      validateBtn.disabled = false;

      validateBtn.addEventListener('click', () => {
        window.history.replaceState({}, '', window.location.pathname);
        showCompleteRegistration(container, code, newUid, onAuthenticated);
      }, { once: true });

    } catch (err) {
      console.error('Code validation error:', err);
      errorEl.textContent = 'Could not verify code. Check your connection and try again.';
      errorEl.style.display = 'block';
      validateBtn.disabled = false;
      validateBtn.textContent = 'Verify Code';
    }
  });
}

// ─── Screen E — Set Password ──────────────────────────────────────────────────

function showSetPassword(container, uid, playerName, inviteCode, onAuthenticated) {
  _detachListener();

  container.innerHTML = `
    <div class="screen" style="gap:0;">
      <div style="padding-top:16px;">
        <button class="back-btn" id="btn-back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="m15 18-6-6 6-6"/>
          </svg>
          Back
        </button>
      </div>

      <div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:24px;">
        <div>
          <h1 class="t-h2" style="margin-bottom:8px;">Set your password</h1>
          <p class="t-small t-muted">Welcome, ${escHtml(playerName ? playerName.split(' ')[0] : 'Player')}. Create a password for your account.</p>
        </div>

        <div style="display:flex;flex-direction:column;gap:16px;">
          <div class="input-group">
            <label class="input-label" for="sp-pw">Password</label>
            <input class="input" id="sp-pw" type="password" placeholder="Min 6 characters"
              autocomplete="new-password" maxlength="100">
            <div class="pw-strength"><div class="pw-strength-bar" id="sp-pw-bar"></div></div>
          </div>

          <div class="input-group">
            <label class="input-label" for="sp-pw2">Confirm Password</label>
            <input class="input" id="sp-pw2" type="password" placeholder="Repeat your password"
              autocomplete="new-password" maxlength="100">
            <div class="input-error" id="sp-pw2-err" style="display:none;"></div>
          </div>
        </div>
      </div>

      <div style="padding-bottom:16px;">
        <button class="btn btn-primary" id="btn-submit" disabled>Set Password &amp; Continue</button>
      </div>
    </div>
  `;

  const pwInput  = container.querySelector('#sp-pw');
  const pw2Input = container.querySelector('#sp-pw2');
  const pwBar    = container.querySelector('#sp-pw-bar');
  const pw2Err   = container.querySelector('#sp-pw2-err');
  const submitBtn = container.querySelector('#btn-submit');

  container.querySelector('#btn-back').addEventListener('click', () => {
    showInviteCode(container, '', onAuthenticated);
  });

  pwInput.addEventListener('input', () => {
    const len = pwInput.value.length;
    pwBar.className = 'pw-strength-bar';
    if (len >= 10)     pwBar.classList.add('strong');
    else if (len >= 6) pwBar.classList.add('medium');
    else if (len > 0)  pwBar.classList.add('weak');
    _checkPwMatch(pwInput, pw2Input, pw2Err);
    updateSubmit();
  });

  pw2Input.addEventListener('input', () => {
    _checkPwMatch(pwInput, pw2Input, pw2Err);
    updateSubmit();
  });

  function updateSubmit() {
    submitBtn.disabled = !(isValidPassword(pwInput.value) && pwInput.value === pw2Input.value);
  }

  submitBtn.addEventListener('click', async () => {
    const pw  = pwInput.value;
    const pw2 = pw2Input.value;

    if (pw !== pw2) {
      pw2Err.textContent = 'Passwords do not match.';
      pw2Err.style.display = 'block';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';

    try {
      const pwdHash = simpleHash(pw);

      await dbMultiUpdate({
        ['players/' + uid + '/passwordHash']: pwdHash,
        ['invite_codes/' + inviteCode + '/used']: true,
      });

      _pending.pwdHash = pwdHash;
      showSelfAssessment(container, uid, onAuthenticated);

    } catch (err) {
      console.error('Set password error:', err);
      showToast('Could not save password. Check your connection.', 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Set Password & Continue';
    }
  });
}

// ─── Screen E2 — Complete Registration (invite code path) ────────────────────
// Collects name, alias, email (optional), and password for a new player
// redeeming an invite code. Creates the player record and marks the code used.

function showCompleteRegistration(container, code, uid, onAuthenticated) {
  _detachListener();

  container.innerHTML = `
    <div class="screen" style="gap:0;">
      <div style="padding-top:16px;">
        <button class="back-btn" id="btn-back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="m15 18-6-6 6-6"/>
          </svg>
          Back
        </button>
      </div>

      <div style="margin-bottom:24px;">
        <h1 class="t-h2" style="margin-bottom:6px;">Set up your profile</h1>
        <p class="t-small t-muted">You're in! Tell us a bit about yourself.</p>
      </div>

      <div style="display:flex;flex-direction:column;gap:16px;flex:1;">
        <div class="input-group">
          <label class="input-label" for="cr-name">Full Name</label>
          <input class="input" id="cr-name" type="text" placeholder="e.g. John Smith"
            autocomplete="name" autocapitalize="words" maxlength="60">
        </div>

        <div class="input-group">
          <label class="input-label" for="cr-alias">Alias / Username</label>
          <input class="input" id="cr-alias" type="text" placeholder="Your nickname on the court"
            autocomplete="username" autocapitalize="none" autocorrect="off" maxlength="30">
          <div class="input-hint" id="cr-alias-hint" style="font-size:12px;color:var(--text3);">
            Shown on standings. Letters and numbers only.
          </div>
        </div>

        <div class="input-group">
          <label class="input-label" for="cr-email">
            Email <span class="t-muted" style="font-weight:400;">(optional)</span>
          </label>
          <input class="input" id="cr-email" type="email" placeholder="you@example.com"
            autocomplete="email" autocapitalize="none" autocorrect="off" maxlength="120">
          <div class="input-hint" id="cr-email-hint" style="font-size:12px;"></div>
        </div>

        <div class="input-group">
          <label class="input-label" for="cr-pw">Password</label>
          <input class="input" id="cr-pw" type="password" placeholder="Min 6 characters"
            autocomplete="new-password" maxlength="100">
          <div class="pw-strength"><div class="pw-strength-bar" id="cr-pw-bar"></div></div>
        </div>

        <div class="input-group">
          <label class="input-label" for="cr-pw2">Confirm Password</label>
          <input class="input" id="cr-pw2" type="password" placeholder="Repeat your password"
            autocomplete="new-password" maxlength="100">
          <div class="input-error" id="cr-pw2-err" style="display:none;"></div>
        </div>
      </div>

      <div style="margin-top:24px;padding-bottom:16px;">
        <button class="btn btn-primary" id="btn-submit" disabled>Create Account</button>
      </div>
    </div>
  `;

  const nameInput  = container.querySelector('#cr-name');
  const aliasInput = container.querySelector('#cr-alias');
  const aliasHint  = container.querySelector('#cr-alias-hint');
  const emailInput = container.querySelector('#cr-email');
  const emailHint  = container.querySelector('#cr-email-hint');
  const pwInput    = container.querySelector('#cr-pw');
  const pw2Input   = container.querySelector('#cr-pw2');
  const pwBar      = container.querySelector('#cr-pw-bar');
  const pw2Err     = container.querySelector('#cr-pw2-err');
  const submitBtn  = container.querySelector('#btn-submit');

  container.querySelector('#btn-back').addEventListener('click', () => {
    showInviteCode(container, '', onAuthenticated);
  });

  // Alias availability check — debounced 500ms
  let aliasDebounce = null;
  let aliasValid = false;

  aliasInput.addEventListener('input', () => {
    clearTimeout(aliasDebounce);
    aliasInput.classList.remove('error', 'valid');
    aliasHint.style.color = 'var(--text3)';
    aliasHint.textContent = 'Shown on standings. Letters and numbers only.';
    aliasValid = false;
    updateSubmit();

    const val = aliasInput.value.trim();
    if (val.length < 2) return;

    aliasDebounce = setTimeout(async () => {
      aliasHint.textContent = 'Checking…';
      const result = await _checkAliasAvailable(val);
      if (result === true) {
        aliasInput.classList.add('valid');
        aliasHint.style.color = 'var(--ace2)';
        aliasHint.textContent = 'Alias available';
        aliasValid = true;
      } else {
        aliasInput.classList.add('error');
        aliasHint.style.color = 'var(--ace3)';
        aliasHint.textContent = result;
        aliasValid = false;
      }
      updateSubmit();
    }, 500);
  });

  // Email duplicate check — optional field, only check if non-empty
  let emailValid = true; // valid by default when empty (email is optional)
  let emailDebounce = null;

  emailInput.addEventListener('input', () => {
    clearTimeout(emailDebounce);
    emailHint.textContent = '';
    emailInput.classList.remove('error', 'valid');
    const val = emailInput.value.trim();

    if (!val) {
      emailValid = true;
      updateSubmit();
      return;
    }

    if (!isValidEmail(val)) {
      emailValid = false;
      updateSubmit();
      return;
    }

    emailDebounce = setTimeout(async () => {
      emailHint.textContent = 'Checking…';
      emailHint.style.color = 'var(--text3)';
      try {
        const existing = await dbGet(dbRef('email_index/' + toEmailKey(val)));
        if (existing) {
          emailInput.classList.add('error');
          emailHint.style.color = 'var(--ace3)';
          emailHint.textContent = 'This email is already registered.';
          emailValid = false;
        } else {
          emailInput.classList.add('valid');
          emailHint.style.color = 'var(--ace2)';
          emailHint.textContent = 'Email available';
          emailValid = true;
        }
      } catch {
        emailHint.textContent = '';
        emailValid = true;
      }
      updateSubmit();
    }, 500);
  });

  pwInput.addEventListener('input', () => {
    const len = pwInput.value.length;
    pwBar.className = 'pw-strength-bar';
    if (len >= 10)     pwBar.classList.add('strong');
    else if (len >= 6) pwBar.classList.add('medium');
    else if (len > 0)  pwBar.classList.add('weak');
    _checkPwMatch(pwInput, pw2Input, pw2Err);
    updateSubmit();
  });

  pw2Input.addEventListener('input', () => {
    _checkPwMatch(pwInput, pw2Input, pw2Err);
    updateSubmit();
  });

  nameInput.addEventListener('input', updateSubmit);
  aliasInput.addEventListener('input', updateSubmit);

  function updateSubmit() {
    const ready = nameInput.value.trim().length >= 2
      && aliasInput.value.trim().length >= 2
      && aliasValid
      && emailValid
      && isValidPassword(pwInput.value)
      && pwInput.value === pw2Input.value;
    submitBtn.disabled = !ready;
  }

  submitBtn.addEventListener('click', async () => {
    const name  = nameInput.value.trim();
    const alias = aliasInput.value.trim();
    const email = emailInput.value.trim().toLowerCase() || null;
    const pw    = pwInput.value;

    if (pw !== pw2Input.value) {
      pw2Err.textContent = 'Passwords do not match.';
      pw2Err.style.display = 'block';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating account…';

    try {
      const pwdHash = simpleHash(pw);
      const now     = Date.now();

      const updates = {
        ['players/' + uid]: {
          name,
          email:        email,
          username:     alias,
          alias,
          passwordHash: pwdHash,
          avatarId:     null,
          eloRating:    null,
          eloHistory:   [],
          adminRole:    null,
          status:       'onboarding',
          selfAssessment: null,
          createdAt:    now,
          lastActive:   now,
        },
        ['invite_codes/' + code + '/used']: true,
      };

      if (email) {
        updates['email_index/' + toEmailKey(email)] = uid;
      }

      await dbMultiUpdate(updates);

      _pending = { uid, pwdHash, email };
      showSelfAssessment(container, uid, onAuthenticated);

    } catch (err) {
      console.error('Complete registration error:', err);
      showToast('Could not create account. Check your connection.', 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Account';
    }
  });
}

// ─── Screen F — Self Assessment ───────────────────────────────────────────────

const LEVEL_OPTIONS = [
  { key: 'beginner',     label: 'Beginner',     sub: 'Know the rules, still building consistency' },
  { key: 'intermediate', label: 'Intermediate', sub: 'Play regularly, solid all-round game' },
  { key: 'advanced',     label: 'Advanced',     sub: 'Compete regularly, strong technique' },
];

async function showSelfAssessment(container, uid, onAuthenticated) {
  _detachListener();

  let step = 1;
  let selectedLevel = null;
  let selectedLeague = null;
  let leagues = [];

  // Try to load available leagues for Q2
  try {
    const defaultSeason = await dbGet(dbRef('config/defaultSeason'));
    if (defaultSeason) {
      const leaguesObj = await dbGet(dbRef('seasons/' + defaultSeason + '/leagues'));
      if (leaguesObj) {
        leagues = Object.entries(leaguesObj).map(([lid, l]) => ({ lid, name: l.name || lid, tier: l.tier || '' }));
      }
    }
  } catch { /* leagues unavailable — skip Q2 */ }

  function renderStep1() {
    container.innerHTML = `
      <div class="screen" style="gap:0;">
        <div style="padding-top:24px;margin-bottom:4px;">
          <div class="step-indicator">Step 1 of ${leagues.length ? 2 : 1}</div>
        </div>
        <div style="margin-bottom:24px;">
          <h1 class="t-h2" style="margin-bottom:8px;">How would you rate<br>your tennis level?</h1>
          <p class="t-small t-muted">Honest answers make the league more competitive for everyone.</p>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;flex:1;">
          ${LEVEL_OPTIONS.map(opt => `
            <div class="tap-card${selectedLevel === opt.key ? ' selected' : ''}" data-key="${escHtml(opt.key)}">
              <div class="tap-card-body">
                <div class="tap-card-title">${escHtml(opt.label)}</div>
                <div class="tap-card-sub">${escHtml(opt.sub)}</div>
              </div>
            </div>
          `).join('')}
        </div>
        <div style="padding:20px 0 16px;">
          <button class="btn btn-primary" id="btn-next" ${!selectedLevel ? 'disabled' : ''}>
            ${leagues.length ? 'Next' : 'Continue'}
          </button>
        </div>
      </div>
    `;

    container.querySelectorAll('.tap-card').forEach(card => {
      card.addEventListener('click', () => {
        selectedLevel = card.dataset.key;
        container.querySelectorAll('.tap-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        const titleEl = card.querySelector('.tap-card-title');
        if (titleEl) titleEl.style.color = 'var(--ace)';
        container.querySelector('#btn-next').disabled = false;
      });
    });

    container.querySelector('#btn-next').addEventListener('click', () => {
      if (!selectedLevel) return;
      if (leagues.length) {
        step = 2;
        renderStep2();
      } else {
        submitAssessment();
      }
    });
  }

  function renderStep2() {
    container.innerHTML = `
      <div class="screen" style="gap:0;">
        <div style="padding-top:24px;margin-bottom:4px;">
          <div class="step-indicator">Step 2 of 2</div>
        </div>
        <div style="margin-bottom:24px;">
          <h1 class="t-h2" style="margin-bottom:8px;">Which league feels right for you?</h1>
          <div class="badge badge-muted" style="font-size:11px;">Suggestion only — admin assigns</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;flex:1;">
          ${leagues.map(lg => `
            <div class="tap-card${selectedLeague === lg.lid ? ' selected' : ''}" data-lid="${escHtml(lg.lid)}">
              <div class="tap-card-body">
                <div class="tap-card-title">${escHtml(lg.name)}</div>
                ${lg.tier ? `<div class="tap-card-sub">${escHtml(lg.tier)}</div>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
        <div style="padding:20px 0 16px;display:flex;flex-direction:column;gap:10px;">
          <button class="btn btn-primary" id="btn-submit" ${!selectedLeague ? 'disabled' : ''}>Continue</button>
          <button class="btn btn-ghost" id="btn-skip">Skip this question</button>
        </div>
      </div>
    `;

    container.querySelectorAll('.tap-card').forEach(card => {
      card.addEventListener('click', () => {
        selectedLeague = card.dataset.lid;
        container.querySelectorAll('.tap-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        container.querySelector('#btn-submit').disabled = false;
      });
    });

    container.querySelector('#btn-submit').addEventListener('click', () => {
      if (!selectedLeague) return;
      submitAssessment();
    });

    container.querySelector('#btn-skip').addEventListener('click', () => {
      selectedLeague = null;
      submitAssessment();
    });
  }

  async function submitAssessment() {
    const eloRating = getStartingElo(selectedLevel);
    const now = Date.now();

    try {
      await dbMultiUpdate({
        ['players/' + uid + '/eloRating']: eloRating,
        ['players/' + uid + '/eloHistory']: [{ delta: 0, match: 'onboarding', ts: now }],
        ['players/' + uid + '/selfAssessment']: {
          level: selectedLevel,
          suggestedLeague: selectedLeague || null,
          completedAt: now,
        },
      });

      showAvatarPicker(container, uid, onAuthenticated);

    } catch (err) {
      console.error('Self-assessment error:', err);
      showToast('Could not save. Check your connection.', 'error');
    }
  }

  renderStep1();
}

// ─── Screen G — Avatar Picker ─────────────────────────────────────────────────

export function showAvatarPicker(container, uid, onAuthenticated) {
  _detachListener();

  container.innerHTML = `
    <div class="screen" style="gap:0;">
      <div style="padding-top:24px;margin-bottom:16px;">
        <h1 class="t-h2" style="margin-bottom:6px;">Choose your avatar</h1>
        <p class="t-small t-muted">This is how you'll appear on the standings and feed.</p>
      </div>
      <div id="picker-mount" style="flex:1;overflow-y:auto;"></div>
    </div>
  `;

  const mount = container.querySelector('#picker-mount');

  // uid as initial seed so the first avatar feels personalized to them
  renderAvatarPicker(mount, [], async (avatarId) => {
    try {
      const player = await dbGet(pRef(uid));
      const email  = (player && player.email) ? player.email : (_pending.email || '');
      const pwdHash = _pending.pwdHash || (player && player.passwordHash) || '';
      const now = Date.now();

      const updates = {
        ['players/' + uid + '/avatarId']: avatarId,
        ['players/' + uid + '/status']:   'active',
        ['players/' + uid + '/lastActive']: now,
      };

      if (email) {
        updates['email_index/' + toEmailKey(email)] = uid;
      }

      await dbMultiUpdate(updates);

      const updatedPlayer = await dbGet(pRef(uid));

      const creds = {
        uid,
        email:     email,
        pwdHash:   pwdHash,
        avatarId:  avatarId,
        adminRole: updatedPlayer ? updatedPlayer.adminRole : null,
      };

      localStorage.setItem('atp_player_creds', JSON.stringify(creds));
      initAnalytics(uid);
      logAppOpen();

      _pending = { uid: null, pwdHash: null, email: null };
      onAuthenticated(updatedPlayer, creds);

    } catch (err) {
      console.error('Avatar save error:', err);
      showToast('Could not save avatar. Try again.', 'error');
    }
  }, uid, (id) => _checkNoDuplicate(id, uid));
}

// ─── Screen H — Login ─────────────────────────────────────────────────────────

export function showLogin(container, onAuthenticated) {
  _detachListener();

  container.innerHTML = `
    <div class="screen" style="gap:0;">
      <div style="padding-top:16px;">
        <button class="back-btn" id="btn-back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="m15 18-6-6 6-6"/>
          </svg>
          Back
        </button>
      </div>

      <div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:28px;">
        <div style="text-align:center;">
          <div class="auth-logo" style="font-size:40px;">ATP</div>
          <div class="auth-sub" style="margin-top:4px;">Greenwich</div>
        </div>

        <div style="display:flex;flex-direction:column;gap:16px;">
          <div class="input-group">
            <label class="input-label" for="li-email">Email or Username</label>
            <input class="input" id="li-email" type="text" placeholder="you@example.com or your alias"
              autocomplete="username" autocapitalize="none" autocorrect="off" autocomplete="email">
            <div class="input-error" id="li-err" style="display:none;"></div>
          </div>

          <div class="input-group">
            <label class="input-label" for="li-pw">Password</label>
            <input class="input" id="li-pw" type="password" placeholder="Your password"
              autocomplete="current-password">
          </div>
        </div>
      </div>

      <div style="padding-bottom:16px;">
        <button class="btn btn-primary" id="btn-submit">Sign In</button>
      </div>
    </div>
  `;

  const emailInput = container.querySelector('#li-email');
  const pwInput    = container.querySelector('#li-pw');
  const errEl      = container.querySelector('#li-err');
  const submitBtn  = container.querySelector('#btn-submit');

  container.querySelector('#btn-back').addEventListener('click', () => {
    showOnboarding(container, onAuthenticated);
  });

  // Allow Enter key to submit
  [emailInput, pwInput].forEach(el => {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitBtn.click();
    });
  });

  submitBtn.addEventListener('click', async () => {
    const identifier = emailInput.value.trim().toLowerCase();
    const pw = pwInput.value;

    errEl.style.display = 'none';
    if (!identifier || !pw) {
      errEl.textContent = 'Please enter your email/username and password.';
      errEl.style.display = 'block';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in…';

    try {
      let uid = null;

      // Try email lookup first
      const emailKey = toEmailKey(identifier);
      uid = await dbGet(dbRef('email_index/' + emailKey));

      // If not found by email, try scanning players by username
      if (!uid) {
        const allPlayers = await dbGet(pRef());
        if (allPlayers) {
          const found = Object.entries(allPlayers).find(([, p]) =>
            (p.username || '').toLowerCase() === identifier ||
            (p.alias || '').toLowerCase() === identifier
          );
          if (found) uid = found[0];
        }
      }

      if (!uid) {
        errEl.textContent = 'Account not found. Check your email or username.';
        errEl.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In';
        return;
      }

      const player = await dbGet(pRef(uid));

      if (!player) {
        errEl.textContent = 'Account data not found. Contact an admin.';
        errEl.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In';
        return;
      }

      const pwdHash = simpleHash(pw);
      if (player.passwordHash !== pwdHash) {
        errEl.textContent = 'Incorrect password.';
        errEl.style.display = 'block';
        emailInput.classList.add('error');
        pwInput.classList.add('error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In';
        return;
      }

      if (player.status === 'invited' || player.status === 'onboarding') {
        errEl.textContent = 'Your account is not active yet. Please complete onboarding.';
        errEl.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In';
        // Let them continue onboarding
        if (player.status === 'onboarding') {
          setTimeout(() => showSelfAssessment(container, uid, onAuthenticated), 1200);
        }
        return;
      }

      const creds = {
        uid,
        email:     player.email || identifier,
        pwdHash,
        avatarId:  player.avatarId || null,
        adminRole: player.adminRole || null,
      };

      localStorage.setItem('atp_player_creds', JSON.stringify(creds));
      window.history.replaceState({}, '', window.location.pathname);

      // Update lastActive
      dbSet(pRef(uid, 'lastActive'), Date.now()).catch(() => {});

      initAnalytics(uid);
      logAppOpen(window.matchMedia('(display-mode: standalone)').matches ? 'pwa' : 'browser');

      onAuthenticated(player, creds);

    } catch (err) {
      console.error('Login error:', err);
      errEl.textContent = 'Sign in failed. Check your connection and try again.';
      errEl.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In';
    }
  });
}

// ─── Internal helper — launch app for already-set-up player ──────────────────
// Called when a player's status jumps to 'active' without going through full flow

async function _launchAfterSetup(container, uid, onAuthenticated) {
  try {
    const player = await dbGet(pRef(uid));
    if (!player) { showOnboarding(container, onAuthenticated); return; }

    const creds = {
      uid,
      email:     player.email || '',
      pwdHash:   player.passwordHash || _pending.pwdHash || '',
      avatarId:  player.avatarId || null,
      adminRole: player.adminRole || null,
    };

    localStorage.setItem('atp_player_creds', JSON.stringify(creds));
    initAnalytics(uid);
    logAppOpen();
    _pending = { uid: null, pwdHash: null, email: null };
    onAuthenticated(player, creds);
  } catch {
    showOnboarding(container, onAuthenticated);
  }
}
