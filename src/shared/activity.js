// src/shared/activity.js — Fire-and-forget global activity log
import { dbRef, dbPush } from '@shared/firebase.js';

export function writeActivity(type, payload) {
  dbPush(dbRef('activity'), { type, ts: Date.now(), ...payload })
    .catch(e => console.warn('[activity]', e));
}
