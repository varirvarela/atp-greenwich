// src/shared/changelog.js — App version history for ATP Greenwich
//
// HOW TO ADD A RELEASE:
//   1. Add a new entry at the TOP of CHANGELOG (newest first).
//   2. Set `version` to the new semver string (e.g. "1.3.0").
//   3. Set `date` to today (YYYY-MM-DD).
//   4. List every user-visible change in `changes[]` — one sentence each.
//   5. Bump the `"version"` field in package.json to match.
//   6. Deploy. Players will see a "What's New" modal on their next open.

export const CHANGELOG = [
  {
    version: '1.4.1',
    date:    '2026-07-06',
    changes: [
      'Tournament switcher: pill in top bar now truncates long names and fits on mobile',
      'Feed: league filter is now collapsed by default — tap to expand, auto-closes after selection',
      'Admin: bracket section now persists the selected tournament when navigating away',
      'Admin: bottom nav includes a "Player App" shortcut to return to the player view',
      'All matches (not just fixture matches) now count toward group stage points',
      'Player app: tab content constrained to 640px on wide screens for better readability',
    ],
  },
  {
    version: '1.4.0',
    date:    '2026-07-06',
    changes: [
      'Onboarding: league selection step removed — admin assigns players to leagues',
      'Standings: unassigned players see an empty state instead of another league\'s standings',
      'Admin: last-selected tournament persists across all admin sections',
      'Admin: mobile bottom nav replaces the hamburger menu at narrow widths',
      'Tournament switcher: players in multiple seasons can switch from the top bar',
      'All tabs (matches, feed, bracket) now follow the active tournament selection',
      'Feed: league filter bar wraps instead of scrolling horizontally',
    ],
  },
  {
    version: '1.3.3',
    date:    '2026-07-05',
    changes: [
      'Admin: "← Player App" link in sidebar to return from admin to player view',
      'Admin — Matches: filter by season, league, status, and player name; click any match to edit result',
      'Admin — Leagues: season filter dropdown; Release Fixtures now shows a modal with smart qualify-point defaults',
      'Admin — Bracket: season and league selector; standings table adds group-points column; click any player to see profile',
      'Admin — Settings: version number now reflects the actual app version',
    ],
  },
  {
    version: '1.3.2',
    date:    '2026-07-05',
    changes: [
      'Players: tap any player row in Standings or match card to see their stats, ELO, and full match history',
      'Matches: tap any confirmed match card to see full score, ELO changes, and match photo',
      'Admin access: players granted admin by the admin can open the Admin Panel directly from their profile',
      'Admin: Players tab now has "Make Admin" / "Revoke Admin" toggle for active players',
    ],
  },
  {
    version: '1.3.1',
    date:    '2026-07-03',
    changes: [
      'Bracket tab: qualification tracker now shows group points and a "Qualified / X pts needed" badge per player',
      'Bracket tab: removed outdated "Top 4 / min wins" description — qualification is now group-points-based',
    ],
  },
  {
    version: '1.3.0',
    date:    '2026-07-03',
    changes: [
      'Group stage: admin can now release randomised group fixtures with a deadline and point system',
      'Group stage: standings show group points as the primary ranking during the group phase',
      'Group stage: "How scoring works" accordion in standings explains the live-configured rules',
      'Group stage: match cards show a Group badge, play-by deadline, and a Forfeit option',
      'Avatars: all styles now render at the correct size on iOS Safari — no more top-left clipping',
      'Admin: mobile-friendly layout — works on phone, hamburger menu, no companion app needed',
    ],
  },
  {
    version: '1.2.0',
    date:    '2026-07-04',
    changes: [
      'League switch: play in multiple leagues and switch between them from the top bar',
      'Match results: winner is now derived automatically from the scores you enter',
      'Match results: photos are compressed client-side before upload — faster saves',
      'Activity feed: match photos show as thumbnails inline in each result card',
      'Activity feed: tap any player name or avatar to see their full match history',
      'Standings: now shows W–L, sets in favour / against, and games in favour / against',
      'Avatars: adventurer style no longer clips to the top-left corner',
      'Match cards: action buttons no longer overflow the card on narrow screens',
    ],
  },
  {
    version: '1.1.0',
    date:    '2026-06-30',
    changes: [
      'Match results: 3rd set support with optional tiebreak scores per set',
      'Match results: photo is now required when submitting a result',
      'Confirmed matches: both players can now adjust a result — ELO is recalculated',
      'Admin app: fixed touch events being blocked on mobile screens',
      'Court Companion: new mobile tool for entering scores courtside',
      'Push notifications: opt-in banner for match challenges and score updates',
    ],
  },
  {
    version: '1.0.0',
    date:    '2026-06-15',
    changes: [
      'Initial release of ATP Greenwich',
      'Player registration with invite codes, login, and custom avatar selection',
      'Match proposals with Best of 3 and Pro 10 formats',
      'Live activity feed with emoji reactions',
      'Standings table with ELO rankings',
      'Playoff bracket qualification tracker',
    ],
  },
];

// Always derived from the top entry — no separate constant to keep in sync.
export const APP_VERSION = CHANGELOG[0].version;

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Compare two semver strings (major.minor.patch). Returns negative if a < b,
// positive if a > b, 0 if equal.
export function compareVersions(a, b) {
  const pa = (a || '0.0.0').split('.').map(Number);
  const pb = (b || '0.0.0').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// Returns all changelog entries strictly newer than `sinceVersion`.
// If `sinceVersion` is null/undefined, returns nothing (first install).
export function changesSince(sinceVersion) {
  if (!sinceVersion) return [];
  return CHANGELOG.filter(e => compareVersions(e.version, sinceVersion) > 0);
}
