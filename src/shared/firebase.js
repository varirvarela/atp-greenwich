// src/shared/firebase.js — v0.01
// Firebase initialization, scoped reference helpers, and storage access.
// Imported by all three apps (player, admin, companion).

import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, get, update, push, remove, onValue, off } from 'firebase/database';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';

// ─── Firebase config ────────────────────────────────────────────────────────
// DO NOT commit this file to a public repo without moving config to .env
const firebaseConfig = {
  apiKey: 'AIzaSyBNIau6O0y27-XKxXxBLHN198Q0WA3Euis',
  authDomain: 'atp-greenwich.firebaseapp.com',
  databaseURL: 'https://atp-greenwich-default-rtdb.firebaseio.com',
  projectId: 'atp-greenwich',
  storageBucket: 'atp-greenwich.firebasestorage.app',
  messagingSenderId: '235666909896',
  appId: '1:235666909896:web:58372949053ada842ad3fd',
};

// ─── Init ────────────────────────────────────────────────────────────────────
const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);
const storage = getStorage(app);

// ─── Global ref helpers ──────────────────────────────────────────────────────
// Use these for root-level nodes (players, config, email_index, etc.)

function dbRef(path) {
  return ref(db, path);
}

// ─── Season + League scoped ref helper ──────────────────────────────────────
// All match, standing, bracket, and member data lives under:
//   seasons/{sid}/leagues/{lid}/{path}
//
// Usage:
//   sRef(sid, lid)                → seasons/{sid}/leagues/{lid}
//   sRef(sid, lid, 'matches')     → seasons/{sid}/leagues/{lid}/matches
//   sRef(sid, lid, 'matches/mid') → seasons/{sid}/leagues/{lid}/matches/mid
//
// Pass null for lid to scope to season root:
//   sRef(sid, null)               → seasons/{sid}
//   sRef(sid, null, 'promotions') → seasons/{sid}/promotions

function sRef(sid, lid, path) {
  if (!sid) throw new Error('sRef: sid is required');
  let base = 'seasons/' + sid;
  if (lid) base += '/leagues/' + lid;
  if (path) base += '/' + path;
  return ref(db, base);
}

// ─── Player ref helper ───────────────────────────────────────────────────────
// Use for global player profile data (ELO, credentials, etc.)
// pRef()          → players/
// pRef(uid)       → players/{uid}
// pRef(uid, path) → players/{uid}/{path}

function pRef(uid, path) {
  let base = 'players';
  if (uid) base += '/' + uid;
  if (path) base += '/' + path;
  return ref(db, base);
}

// ─── Storage helpers ─────────────────────────────────────────────────────────

// Upload a match confirmation photo.
// file: File object from <input type="file">
// matchId: the match document ID
// Returns: public download URL string
async function uploadMatchPhoto(matchId, file) {
  const ext  = file.name.split('.').pop() || 'jpg';
  const path = 'match-photos/' + matchId + '.' + ext;
  const ref  = storageRef(storage, path);
  const snap = await uploadBytes(ref, file);
  const url  = await getDownloadURL(snap.ref);
  return url;
}

// ─── Convenience wrappers ────────────────────────────────────────────────────
// These keep callers clean — no need to import Firebase internals everywhere.

async function dbGet(refOrPath) {
  const r = typeof refOrPath === 'string' ? dbRef(refOrPath) : refOrPath;
  const snap = await get(r);
  return snap.exists() ? snap.val() : null;
}

async function dbSet(refOrPath, value) {
  const r = typeof refOrPath === 'string' ? dbRef(refOrPath) : refOrPath;
  return set(r, value);
}

async function dbUpdate(refOrPath, updates) {
  const r = typeof refOrPath === 'string' ? dbRef(refOrPath) : refOrPath;
  return update(r, updates);
}

async function dbPush(refOrPath, value) {
  const r = typeof refOrPath === 'string' ? dbRef(refOrPath) : refOrPath;
  return push(r, value);
}

async function dbRemove(refOrPath) {
  const r = typeof refOrPath === 'string' ? dbRef(refOrPath) : refOrPath;
  return remove(r);
}

// Listen to a path in real time.
// Returns an unsubscribe function — call it to detach the listener.
// Always detach listeners before switching season/league context.
function dbListen(refOrPath, callback) {
  const r = typeof refOrPath === 'string' ? dbRef(refOrPath) : refOrPath;
  onValue(r, (snap) => {
    callback(snap.exists() ? snap.val() : null);
  });
  // Return detach function
  return () => off(r);
}

// Multi-path atomic update — use this whenever you need to write to
// multiple nodes at once (e.g. confirm match + update ELO + update standing).
// updates: flat object with full paths as keys
// Example: { 'players/uid1/eloRating': 1224, 'seasons/sid/leagues/lid/members/uid1/standing/matchesWon': 5 }
async function dbMultiUpdate(updates) {
  return update(ref(db), updates);
}

// ─── Exports ─────────────────────────────────────────────────────────────────
export {
  db,
  storage,
  dbRef,
  sRef,
  pRef,
  dbGet,
  dbSet,
  dbUpdate,
  dbPush,
  dbRemove,
  dbListen,
  dbMultiUpdate,
  uploadMatchPhoto,
};
