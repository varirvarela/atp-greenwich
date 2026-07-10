// src/shared/changelog.js — App version history for ATP Greenwich
//
// HOW TO ADD A RELEASE:
//   1. Add a new entry at the TOP of CHANGELOG (newest first).
//   2. Set `version` to the new semver string (e.g. "1.3.0").
//   3. Set `date` to today (YYYY-MM-DD).
//   4. List player-visible changes in `changes[]`; admin-only changes in `adminChanges[]`.
//   5. Bump the `"version"` field in package.json to match.
//   6. Deploy. Players see only `changes`; admins see both.

export const CHANGELOG = [
  {
    version: '1.7.2',
    date:    '2026-07-10',
    changes: [
      'Install prompt: Android shows a one-tap Install button; iPhone shows step-by-step instructions for Safari or Chrome; desktop sees nothing',
    ],
    adminChanges: [],
  },
  {
    version: '1.7.1',
    date:    '2026-07-09',
    changes: [
      'Fixed: "Replay app tutorial" button now works — tapping it immediately navigates to the Feed tab and launches the tour',
    ],
    adminChanges: [],
  },
  {
    version: '1.7.0',
    date:    '2026-07-09',
    changes: [
      'Navigation badges now clear when you open the relevant tab — the matches badge goes away once you visit the Matches tab',
      'Profile: "Replay app tutorial" button lets you re-run the walkthrough tour at any time',
    ],
    adminChanges: [],
  },
  {
    version: '1.6.1',
    date:    '2026-07-09',
    changes: [
      'All app text is now in English (Season / League labels, walkthrough, match modals, feed cards)',
      'Walkthrough tour now navigates to the relevant screen as you step through it',
      'League explainer accordion updated: correct English description of scheduled vs ad-hoc match rules',
      'Match results: tiebreak scores are now validated — must reach 7 and win by 2',
      'Matches: forfeited and canceled matches moved out of In Progress into a dedicated Canceled section',
    ],
    adminChanges: [],
  },
  {
    version: '1.6.0',
    date:    '2026-07-09',
    changes: [
      'Feed: profile changes (avatar or alias updates) now appear as activity cards',
      'Feed: match challenges, bracket advancements, and new player arrivals appear in the feed',
      'Feed: fixture releases announced in the feed when the admin publishes group stage matches',
      'Feed: activity cards are mixed into the feed alongside confirmed match results',
      'Bottom nav: red badge on Feed shows unread activity count since you last opened it',
      'Bottom nav: red badge on Matches shows received challenges waiting for your response',
    ],
    adminChanges: [],
  },
  {
    version: '1.5.0',
    date:    '2026-07-09',
    changes: [
      'App walkthrough: a step-by-step guide appears on first visit — tap "Siguiente" to go through or "No volver a mostrar" to skip permanently',
      'Match results: invalid set scores are highlighted in red with a hint (e.g. 8-3 is not a valid tennis score)',
      'Match results: 3rd set appears automatically when sets are 1-1',
      'Match results: "Resultado incompleto" option lets you record a walkover or forfeit without entering full scores',
      'Profile: "Cómo funciona la liga" accordion explains group phase, scheduled vs ad-hoc matches, and the knockout bracket',
      'Profile: "En honor a Pepe" tribute now shows his photo',
      'Top-nav: "Temporada" and "Liga" labels added above the selectors',
    ],
    adminChanges: [],
  },
  {
    version: '1.4.5',
    date:    '2026-07-07',
    changes: [
      'Top-nav pills enlarged — full league and tournament names now show without abbreviation',
      'Bracket: BYE matches auto-advance correctly to the next round',
      'Profile: "En honor a Pepe" tribute section added at the bottom',
      'Admin updates now have a separate changelog — player notifications stay relevant',
    ],
    adminChanges: [
      'Admin: hamburger menu removed from mobile top bar — use the bottom nav to switch sections',
      'Admin Bracket: "Advance BYE" button fixes existing brackets where a BYE was blocking the next round',
    ],
  },
  {
    version: '1.4.4',
    date:    '2026-07-07',
    changes: [
      'Feed: now shows matches from ALL leagues in the active tournament (not just your own league)',
      'Feed: gear settings list all tournament leagues so you can filter by any of them',
      'Standings: league badge removed from table header (already in top-nav pill)',
      'Standings: inline missed-match badge also counts forfeited matches',
      'Standings: player detail modal shows Played, Won, Lost, Missed, Forfeit, Opp.Forfeit stats plus ELO delta per match',
      'Standings: standings freeze when group stage is closed (bracket results no longer affect group stage rankings)',
      'Matches: league badge removed from header (already in top-nav pill)',
      'Bracket: league badge removed from header (already in top-nav pill)',
      'Profile: "How ELO works" accordion shows formula + two worked examples',
      'Version footer fixed — always visible above the bottom navigation bar',
    ],
    adminChanges: [
      'Admin: "Back to Player App" now shows as a visible styled button on mobile',
      'Admin Players: clicking the player card opens the profile (no separate Profile button)',
      'Admin Players: Edit ELO and Reset Password available in the player profile modal; Change League removed',
    ],
  },
  {
    version: '1.4.2',
    date:    '2026-07-06',
    changes: [
      'Admin: "Back to Player App" arrow moved to top-right corner of mobile topbar',
      'Admin: owner can now permanently delete players from the Players section',
      'Admin: bracket qualified count now correctly uses the closed group stage flag',
      'Player app: league pill shows all leagues in the active tournament (can browse freely)',
      'Player app: league switcher removed from individual sections — use the top-bar pill',
      'Feed: membership check — feed only shows if you are in at least one league',
      'Feed: gear icon opens settings sheet to choose which leagues to include',
      'Standings: ELO tier labels removed; missed matches shown inline; tap row for details',
      'Version footer added below content in all sections',
    ],
  },
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

// Returns changelog entries strictly newer than `sinceVersion`.
// Pass `includeAdmin: true` to also include adminChanges in each entry's changes list.
// If `sinceVersion` is null/undefined, returns nothing (first install).
export function changesSince(sinceVersion, { includeAdmin = false } = {}) {
  if (!sinceVersion) return [];
  return CHANGELOG
    .filter(e => compareVersions(e.version, sinceVersion) > 0)
    .map(e => ({
      ...e,
      changes: includeAdmin
        ? [...(e.changes || []), ...(e.adminChanges || [])]
        : (e.changes || []),
    }));
}
