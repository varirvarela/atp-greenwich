// src/shared/analytics.js — v0.01
// Custom analytics for ATP Greenwich. Stores all data in Firebase.
// No third-party service. Available from player app v0.01+.
//
// Usage:
//   import { initAnalytics, logEvent } from '@shared/analytics.js';
//   initAnalytics(db, sid, uid);   // call once after login
//   logEvent('tab_view', { tab: 'matches', prev_tab: 'feed', time_on_prev: 42 });

import { dbRef, dbPush, dbSet } from './firebase.js';

// ─── Module state ────────────────────────────────────────────────────────────
let _db        = null;
let _sid       = null; // current season id — analytics scoped globally, not per season
let _uid       = null;
let _sessionId = null;
let _sessionStart = null;
let _initialized  = false;

// ─── Init ────────────────────────────────────────────────────────────────────

function initAnalytics(uid, sid) {
  _uid  = uid;
  _sid  = sid;
  _sessionId    = 's_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  _sessionStart = Date.now();
  _initialized  = true;

  // Log session end on page hide
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      _writeSession();
    }
  });

  // Also log on beforeunload as a fallback
  window.addEventListener('beforeunload', function () {
    _writeSession();
  });
}

// ─── Event logging ───────────────────────────────────────────────────────────

function logEvent(eventName, meta) {
  if (!_initialized || !_uid) return;

  const event = Object.assign({
    uid:     _uid,
    event:   eventName,
    ts:      Date.now(),
    sid:     _sessionId,
    device:  getDevice(),
    browser: getBrowser(),
    screen:  getScreenType(),
    pwa:     isPWA(),
  }, meta || {});

  // Write to global analytics node (not season-scoped — want long-term history)
  dbPush(dbRef('analytics/events'), event).catch(function () {
    // Silently fail — analytics should never break the app
  });
}

// ─── Session writing ─────────────────────────────────────────────────────────

function _writeSession() {
  if (!_initialized || !_uid || !_sessionId) return;
  const duration = Math.round((Date.now() - _sessionStart) / 1000);

  dbSet(dbRef('analytics/sessions/' + _sessionId), {
    uid:      _uid,
    ts:       _sessionStart,
    endTs:    Date.now(),
    duration, // seconds
    device:   getDevice(),
    browser:  getBrowser(),
    screen:   getScreenType(),
    pwa:      isPWA(),
  }).catch(function () {});
}

// ─── Device fingerprint ──────────────────────────────────────────────────────

function getDevice() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua))                              return 'iphone';
  if (/iPad/.test(ua))                                return 'ipad';
  if (/Android/.test(ua) && /Mobile/.test(ua))        return 'android_phone';
  if (/Android/.test(ua))                             return 'android_tablet';
  if (/Windows/.test(ua))                             return 'windows';
  if (/Mac/.test(ua))                                 return 'mac';
  if (/Linux/.test(ua))                               return 'linux';
  return 'unknown';
}

function getBrowser() {
  const ua = navigator.userAgent;
  if (/CriOS/.test(ua))                               return 'chrome_ios';
  if (/FxiOS/.test(ua))                               return 'firefox_ios';
  if (/EdgA?\//.test(ua))                             return 'edge';
  if (/Chrome/.test(ua) && !/Edge/.test(ua))          return 'chrome';
  if (/Firefox/.test(ua))                             return 'firefox';
  if (/Safari/.test(ua) && !/Chrome/.test(ua))        return 'safari';
  return 'other';
}

function getScreenType() {
  const w = window.innerWidth;
  if (w < 768)  return 'mobile';
  if (w < 1024) return 'tablet';
  return 'desktop';
}

function isPWA() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

// ─── Standard event helpers ──────────────────────────────────────────────────
// Convenience wrappers for the most common events.
// These keep call sites clean and enforce consistent meta shapes.

function logAppOpen(source) {
  logEvent('app_open', { source: source || 'browser' });
}

function logTabView(tab, prevTab, timeOnPrev) {
  logEvent('tab_view', { tab, prev_tab: prevTab || null, time_on_prev: timeOnPrev || 0 });
}

function logMatchProposed(type) {
  logEvent('match_proposed', { type }); // type: 'marketplace' | 'direct'
}

function logMatchAccepted(msSinceProposal) {
  logEvent('match_accepted', { ms_since_proposal: msSinceProposal });
}

function logMatchCancelled(initiator) {
  logEvent('match_cancelled', { initiator }); // 'self' | 'opponent'
}

function logResultEntered(format) {
  logEvent('result_entered', { format }); // 'bo3' | 'pro10'
}

function logPhotoUploaded(msSinceResult) {
  logEvent('photo_uploaded', { ms_since_result: msSinceResult });
}

function logStandingsViewed(view) {
  logEvent('standings_viewed', { view }); // 'table' | 'elo'
}

function logReactionAdded(reactionType) {
  logEvent('reaction_added', { reaction_type: reactionType });
}

function logInstallPrompted(platform) {
  logEvent('install_prompted', { platform }); // 'ios' | 'android'
}

function logInstallCompleted(platform) {
  logEvent('install_completed', { platform });
}

// ─── Exports ─────────────────────────────────────────────────────────────────
export {
  initAnalytics,
  logEvent,
  getDevice,
  getBrowser,
  getScreenType,
  isPWA,
  logAppOpen,
  logTabView,
  logMatchProposed,
  logMatchAccepted,
  logMatchCancelled,
  logResultEntered,
  logPhotoUploaded,
  logStandingsViewed,
  logReactionAdded,
  logInstallPrompted,
  logInstallCompleted,
};
