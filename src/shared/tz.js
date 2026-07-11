// src/shared/tz.js — Timezone helpers locked to the league location
// All timestamps are stored as UTC epoch ms; display and input use LEAGUE_TZ.
export const LEAGUE_TZ = 'America/New_York';

// Format a UTC timestamp for display in the league timezone (e.g. "Jul 18, 9:00 AM")
export function fmtTime(ts) {
  return new Date(ts).toLocaleString('en-US', {
    timeZone: LEAGUE_TZ, month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

// UTC ms → "YYYY-MM-DDTHH:mm" in LEAGUE_TZ, for pre-filling a datetime-local input
export function tsToLocalInput(ts) {
  return new Date(ts).toLocaleString('sv', { timeZone: LEAGUE_TZ }).slice(0, 16).replace(' ', 'T');
}

// "YYYY-MM-DDTHH:mm" interpreted as LEAGUE_TZ → UTC ms
// Works by treating the naive string as UTC first, then correcting for the actual NYC offset.
export function localInputToTs(val) {
  if (!val) return null;
  const [datePart, timePart = '00:00'] = val.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [h, mi] = timePart.split(':').map(Number);
  const probeMs = Date.UTC(y, m - 1, d, h, mi);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: LEAGUE_TZ,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(probeMs)).map(p => [p.type, p.value])
  );
  const nyH = parseInt(parts.hour) % 24;
  const diffMin = (h * 60 + mi) - (nyH * 60 + parseInt(parts.minute));
  return probeMs + diffMin * 60000;
}
