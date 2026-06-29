// src/shared/utils.js — v0.01
// Pure utility functions shared across all three apps.
// No Firebase imports. No side effects. Fully testable.

// ─── Password hashing ────────────────────────────────────────────────────────
// Simple deterministic hash. Not cryptographic — appropriate for a private
// friend-group app where the real security is the invite system.
// Reused exactly from Prode 2026 for consistency.

function simpleHash(str) {
  var h = 0;
  for (var i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return 'h_' + Math.abs(h).toString(36);
}

// ─── HTML escaping ───────────────────────────────────────────────────────────
// Always escape user-generated content before inserting into innerHTML.

function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Email key ───────────────────────────────────────────────────────────────
// Converts an email to a Firebase-safe key for email_index lookups.
// Firebase keys cannot contain . # $ [ ]
// Reused exactly from Prode 2026.

function toEmailKey(email) {
  return email.toLowerCase()
    .replace(/@/g, '_at_')
    .replace(/\./g, '_dot_');
}

// ─── UID generation ──────────────────────────────────────────────────────────
// Generates a collision-resistant local UID for players.
// Format: player_{timestamp}_{random4}

function generateUid(prefix) {
  const p = prefix || 'uid';
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return p + '_' + ts + '_' + rand;
}

// Generates a short invite code. Format: XXXX-XXXX (uppercase alphanumeric)
function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/I/1 confusion
  function seg() {
    let s = '';
    for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }
  return seg() + '-' + seg();
}

// ─── Date helpers ────────────────────────────────────────────────────────────

// Returns a human-friendly relative time string.
// e.g. "2 hours ago", "Yesterday", "Jun 14"
function timeAgo(timestamp) {
  const now  = Date.now();
  const diff = now - timestamp;
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);

  if (mins < 1)   return 'Just now';
  if (mins < 60)  return mins + 'm ago';
  if (hours < 24) return hours + 'h ago';
  if (days === 1) return 'Yesterday';
  if (days < 7)   return days + 'd ago';

  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Formats a timestamp as a readable date+time.
// e.g. "Sat Jun 21 · 10:00am"
function formatMatchTime(timestamp) {
  const d = new Date(timestamp);
  const day  = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
  return day + ' · ' + time;
}

// Returns ISO date string in local time (for date inputs)
function toLocalISOString(date) {
  const d = date || new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

// ─── Validation ──────────────────────────────────────────────────────────────

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 6;
}

// ─── Score parsing ───────────────────────────────────────────────────────────
// Parses a set score string "6-3" into { a: 6, b: 3 }
function parseSetScore(str) {
  const parts = String(str).trim().split('-');
  if (parts.length !== 2) return null;
  const a = parseInt(parts[0], 10);
  const b = parseInt(parts[1], 10);
  if (isNaN(a) || isNaN(b)) return null;
  return { a, b };
}

// Calculates total game difference from an array of set scores.
// sets: [{ a: 6, b: 3 }, { a: 4, b: 6 }, { a: 7, b: 5 }]
// Returns: { gamesWon: 17, gamesLost: 14, gameDiff: 3 } from player A's perspective
function calcGameDiff(sets) {
  let won = 0, lost = 0;
  for (const s of sets) {
    won  += s.a;
    lost += s.b;
  }
  return { gamesWon: won, gamesLost: lost, gameDiff: won - lost };
}

// Determines winner of a Bo3 match from sets array.
// Returns 'a' | 'b' | null (if match not complete)
function determineWinner(sets) {
  let winsA = 0, winsB = 0;
  for (const s of sets) {
    if (s.a > s.b) winsA++;
    else if (s.b > s.a) winsB++;
  }
  if (winsA >= 2) return 'a';
  if (winsB >= 2) return 'b';
  return null;
}

// ─── Exports ─────────────────────────────────────────────────────────────────
export {
  simpleHash,
  escHtml,
  toEmailKey,
  generateUid,
  generateInviteCode,
  timeAgo,
  formatMatchTime,
  toLocalISOString,
  isValidEmail,
  isValidPassword,
  parseSetScore,
  calcGameDiff,
  determineWinner,
};
