// src/player/notif-settings.js — Notification preferences modal

import { dbGet, dbMultiUpdate, pRef } from '@shared/firebase.js';
import { escHtml } from '@shared/utils.js';

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY;

// ─── Push subscription helpers ────────────────────────────────────────────────

function _urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - base64.length % 4) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(b64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function _getPushStatus() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  if (!VAPID) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'prompt';
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'subscribed' : 'prompt';
  } catch {
    return 'prompt';
  }
}

async function _enablePush(uid) {
  if (!VAPID) throw new Error('VAPID not configured');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permission not granted');
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub = existing || await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: _urlBase64ToUint8Array(VAPID),
  });
  await dbMultiUpdate({ [`players/${uid}/pushSubscription`]: sub.toJSON() });
  localStorage.removeItem('push_dismissed');
}

// ─── Prefs helpers ────────────────────────────────────────────────────────────

function _defaultPrefs(raw) {
  return {
    challenged: raw?.challenged !== false,
    result:     raw?.result     !== false,
    confirmed:  raw?.confirmed  !== false,
    reminders:  raw?.reminders  === true,
  };
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export async function showNotifSettings(uid) {
  const [rawPrefs, pushStatus] = await Promise.all([
    dbGet(pRef(uid, 'pushPrefs')).catch(() => null),
    _getPushStatus(),
  ]);
  const prefs = _defaultPrefs(rawPrefs);

  const enabled = pushStatus === 'subscribed';
  const disabled = pushStatus === 'unsupported' || pushStatus === 'denied';

  const statusBlock = pushStatus === 'unsupported'
    ? `<p class="t-small t-muted" style="margin:0;">Push notifications are not supported in this browser.</p>`
    : pushStatus === 'denied'
    ? `<p class="t-small" style="margin:0;color:var(--ace3);">Notifications are blocked. Enable them in your browser or device settings, then revisit here.</p>`
    : pushStatus === 'subscribed'
    ? `<div style="display:flex;align-items:center;gap:8px;">
         <span style="font-size:10px;background:rgba(0,160,80,.12);color:#007a3d;
           padding:2px 8px;border-radius:12px;font-weight:700;">Active</span>
         <span class="t-small t-muted">Push notifications are enabled</span>
       </div>`
    : `<button class="btn btn-primary" id="btn-enable-push" style="width:100%;">
         Enable push notifications
       </button>`;

  function toggle(key, label, desc) {
    return `
      <label style="display:flex;align-items:flex-start;gap:12px;padding:10px 12px;
        background:var(--surface2);border-radius:8px;cursor:${disabled ? 'not-allowed' : 'pointer'};
        opacity:${disabled ? '0.5' : '1'};">
        <input type="checkbox" data-pref="${escHtml(key)}" ${prefs[key] ? 'checked' : ''}
          ${disabled ? 'disabled' : ''}
          style="width:16px;height:16px;accent-color:var(--ace);cursor:pointer;flex-shrink:0;margin-top:1px;">
        <div>
          <div style="font-size:13px;font-weight:600;">${label}</div>
          <div class="t-small t-muted" style="margin-top:2px;">${desc}</div>
        </div>
      </label>`;
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-sheet" style="max-height:85dvh;overflow-y:auto;">
      <div class="modal-handle"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;
        padding-bottom:16px;border-bottom:1px solid var(--border);margin-bottom:16px;">
        <span style="font-size:15px;font-weight:700;">Notification preferences</span>
        <button id="btn-close-notif" style="background:none;border:none;cursor:pointer;
          padding:4px;color:var(--text3);">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
          </svg>
        </button>
      </div>

      <p class="t-label t-muted" style="margin:0 0 8px;">Push notifications</p>
      <div style="margin-bottom:20px;">${statusBlock}</div>

      <p class="t-label t-muted" style="margin:0 0 8px;">Notify me when…</p>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px;">
        ${toggle('challenged', 'Challenge received',  'Someone sends me a direct or open challenge')}
        ${toggle('result',     'Result to confirm',   'My opponent enters a result I need to confirm')}
        ${toggle('confirmed',  'Match confirmed',     'A match is fully confirmed and ELO updated')}
        ${toggle('reminders',  'Daily match reminder','Morning push when I have a match scheduled today')}
      </div>

      ${disabled ? '' : `<button class="btn btn-primary" id="btn-save-notif" style="width:100%;">Save preferences</button>`}
      <div style="padding-bottom:8px;"></div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('#btn-close-notif').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  // Enable push button
  const enableBtn = overlay.querySelector('#btn-enable-push');
  if (enableBtn) {
    enableBtn.addEventListener('click', async () => {
      enableBtn.disabled = true;
      enableBtn.textContent = 'Enabling…';
      try {
        await _enablePush(uid);
        overlay.remove();
        showNotifSettings(uid);
      } catch {
        enableBtn.disabled = false;
        enableBtn.textContent = 'Enable push notifications';
      }
    });
  }

  // Save preferences
  overlay.querySelector('#btn-save-notif')?.addEventListener('click', async () => {
    const newPrefs = {};
    overlay.querySelectorAll('[data-pref]').forEach(cb => {
      newPrefs[cb.dataset.pref] = cb.checked;
    });
    await dbMultiUpdate({ [`players/${uid}/pushPrefs`]: newPrefs });
    close();
  });
}
