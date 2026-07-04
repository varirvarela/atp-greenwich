// src/shared/scoring.js — v0.01
// League standing calculation for ATP Greenwich.
// Pure functions only. No Firebase, no side effects. Fully testable.
//
// System design:
//   - League standing resets each season (unlike ELO which is global)
//   - Only CONFIRMED matches count (photo uploaded or admin override)
//   - Sort order: Wins (desc) → Matches Played (desc) → Game Diff (desc)
//   - Qualification threshold: configurable per league (default: 6P, 4W)

// ─── Standing calculation ────────────────────────────────────────────────────

// Calculate a single player's standing from their confirmed matches in a league.
// matches: array of confirmed match objects for this player in this league+season
// uid: the player's uid (to determine which side they were on)
//
// Returns: {
//   matchesWon:    number,
//   matchesPlayed: number,
//   gamesWon:      number,
//   gamesLost:     number,
//   gameDiff:      number,
//   winRate:       number (0-1),
//   points:        number (for display — same as matchesWon for now)
// }
function calculateStanding(matches, uid) {
  let matchesWon    = 0;
  let matchesPlayed = 0;
  let setsWon       = 0;
  let setsLost      = 0;
  let gamesWon      = 0;
  let gamesLost     = 0;

  for (const match of matches) {
    if (match.status !== 'confirmed') continue;
    if (!match.result) continue;

    matchesPlayed++;

    const playerSide   = match.playerA === uid ? 'a' : 'b';
    const opponentSide = playerSide === 'a' ? 'b' : 'a';

    if (match.result.winner === uid) matchesWon++;

    // Sum games and sets. Tiebreak sub-scores (set.tb) are not counted as games —
    // only the main set games (e.g., 7–6 counts as 7 games, not 7+tiebreak points).
    const sets = match.result.sets || [];
    for (const set of sets) {
      const pg = set[playerSide]   || 0;
      const og = set[opponentSide] || 0;
      gamesWon  += pg;
      gamesLost += og;
      if (pg > og) setsWon++;
      else if (og > pg) setsLost++;
    }
  }

  const gameDiff = gamesWon - gamesLost;
  const setDiff  = setsWon - setsLost;
  const winRate  = matchesPlayed > 0 ? matchesWon / matchesPlayed : 0;

  return {
    matchesWon,
    matchesLost: matchesPlayed - matchesWon,
    matchesPlayed,
    setsWon,
    setsLost,
    setDiff,
    gamesWon,
    gamesLost,
    gameDiff,
    winRate: Math.round(winRate * 100) / 100,
    points: matchesWon,
  };
}

// ─── League table builder ────────────────────────────────────────────────────

// Build a sorted league table from all confirmed matches in a league.
// allMatches: object { matchId: matchObject } from Firebase
// memberUids: array of uid strings in this league
//
// Returns: array of { uid, rank, standing } sorted by league rules
function buildLeagueTable(allMatches, memberUids) {
  const matchArray = Object.values(allMatches || {});

  const table = memberUids.map((uid) => {
    // Get all confirmed matches this player participated in
    const playerMatches = matchArray.filter(
      (m) => m.status === 'confirmed' && (m.playerA === uid || m.playerB === uid)
    );
    const standing = calculateStanding(playerMatches, uid);
    return { uid, standing };
  });

  // Sort: W desc → P desc → GD desc
  table.sort((a, b) => {
    if (b.standing.matchesWon !== a.standing.matchesWon)
      return b.standing.matchesWon - a.standing.matchesWon;
    if (b.standing.matchesPlayed !== a.standing.matchesPlayed)
      return b.standing.matchesPlayed - a.standing.matchesPlayed;
    return b.standing.gameDiff - a.standing.gameDiff;
  });

  // Assign ranks (tied players get the same rank)
  let rank = 1;
  for (let i = 0; i < table.length; i++) {
    if (i > 0) {
      const prev = table[i - 1].standing;
      const curr = table[i].standing;
      const tied = prev.matchesWon === curr.matchesWon
        && prev.matchesPlayed === curr.matchesPlayed
        && prev.gameDiff === curr.gameDiff;
      if (!tied) rank = i + 1;
    }
    table[i].rank = rank;
  }

  return table;
}

// ─── Qualification check ─────────────────────────────────────────────────────

// Check if a player qualifies for the end-of-season bracket.
// standing: result of calculateStanding()
// config: { minMatches: 6, minWins: 4 } — from league scoringConfig
function isQualified(standing, config) {
  const minMatches = (config && config.minMatches) || 6;
  const minWins    = (config && config.minWins)    || 4;
  return standing.matchesPlayed >= minMatches && standing.matchesWon >= minWins;
}

// Get the list of qualified players, sorted by standing, up to bracketSize.
// table: result of buildLeagueTable()
// config: { minMatches, minWins, bracketSize }
function getQualifiedPlayers(table, config) {
  const bracketSize = (config && config.bracketSize) || 8;
  return table
    .filter((row) => isQualified(row.standing, config))
    .slice(0, bracketSize);
}

// ─── 2-match cap check ───────────────────────────────────────────────────────

// Check how many confirmed (or scheduled/pending) matches two players
// have played against each other in a league+season.
// Returns: number (0, 1, or 2)
function matchCountBetween(allMatches, uidA, uidB) {
  const countableStatuses = ['scheduled', 'result_pending', 'photo_pending', 'confirmed'];
  return Object.values(allMatches || {}).filter((m) => {
    const involves = (m.playerA === uidA && m.playerB === uidB)
                  || (m.playerA === uidB && m.playerB === uidA);
    return involves && countableStatuses.includes(m.status);
  }).length;
}

// Returns true if these two players can still play another match.
function canPlayAgainst(allMatches, uidA, uidB) {
  return matchCountBetween(allMatches, uidA, uidB) < 2;
}

// ─── Test suite ──────────────────────────────────────────────────────────────
// Call runScoringTests() in the browser console to verify correctness.

function runScoringTests() {
  const results = [];

  function test(name, actual, expected) {
    const pass = JSON.stringify(actual) === JSON.stringify(expected)
      || actual === expected;
    results.push({ name, pass, actual, expected });
    if (!pass) console.error('FAIL:', name, '— got', actual, 'expected', expected);
  }

  const uidA = 'player_a';
  const uidB = 'player_b';
  const uidC = 'player_c';

  // Test matches
  const matchWin = {
    status: 'confirmed',
    playerA: uidA,
    playerB: uidB,
    result: {
      winner: uidA,
      sets: [{ a: 6, b: 3 }, { a: 7, b: 5 }],
    },
  };

  const matchLoss = {
    status: 'confirmed',
    playerA: uidA,
    playerB: uidB,
    result: {
      winner: uidB,
      sets: [{ a: 3, b: 6 }, { a: 4, b: 6 }],
    },
  };

  const matchPending = {
    status: 'result_pending',
    playerA: uidA,
    playerB: uidB,
    result: null,
  };

  // Test 1: Single win
  const s1 = calculateStanding([matchWin], uidA);
  test('Single win — matchesWon', s1.matchesWon, 1);
  test('Single win — matchesPlayed', s1.matchesPlayed, 1);
  test('Single win — gamesWon', s1.gamesWon, 13);   // 6+7
  test('Single win — gamesLost', s1.gamesLost, 8);  // 3+5
  test('Single win — gameDiff', s1.gameDiff, 5);
  test('Single win — winRate', s1.winRate, 1);

  // Test 2: Single loss
  const s2 = calculateStanding([matchLoss], uidA);
  test('Single loss — matchesWon', s2.matchesWon, 0);
  test('Single loss — gamesWon', s2.gamesWon, 7);   // 3+4
  test('Single loss — gamesLost', s2.gamesLost, 12); // 6+6
  test('Single loss — gameDiff', s2.gameDiff, -5);

  // Test 3: Pending match not counted
  const s3 = calculateStanding([matchWin, matchPending], uidA);
  test('Pending not counted — matchesPlayed', s3.matchesPlayed, 1);

  // Test 4: Win rate
  const s4 = calculateStanding([matchWin, matchLoss], uidA);
  test('Win rate 50%', s4.winRate, 0.5);
  test('Matches played 2', s4.matchesPlayed, 2);

  // Test 5: League table sort — more wins ranks higher
  const allMatches = { m1: matchWin, m2: matchLoss };
  const table = buildLeagueTable(allMatches, [uidA, uidB]);
  test('Table length', table.length, 2);
  // uidB won matchLoss (they are B side who won), uidA won matchWin
  // Both have 1 win — tiebreak goes to matches played then GD
  test('Table first rank', table[0].rank, 1);

  // Test 6: Qualification check
  const qualStanding = { matchesPlayed: 7, matchesWon: 5, gameDiff: 10 };
  const noQualStanding = { matchesPlayed: 4, matchesWon: 4, gameDiff: 8 };
  test('Qualified player', isQualified(qualStanding, { minMatches: 6, minWins: 4 }), true);
  test('Not qualified — not enough matches', isQualified(noQualStanding, { minMatches: 6, minWins: 4 }), false);

  // Test 7: 2-match cap
  const allM = {
    m1: { status: 'confirmed', playerA: uidA, playerB: uidB, result: { winner: uidA, sets: [] } },
    m2: { status: 'scheduled', playerA: uidA, playerB: uidB, result: null },
  };
  test('2 matches between A and B', matchCountBetween(allM, uidA, uidB), 2);
  test('Cap reached — cannot play', canPlayAgainst(allM, uidA, uidB), false);
  test('Cap not reached vs C', canPlayAgainst(allM, uidA, uidC), true);

  // Summary
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log('Scoring Tests:', passed + '/' + results.length + ' passed' + (failed ? ' — ' + failed + ' FAILED' : ' ✅'));
  return results;
}

// ─── Exports ─────────────────────────────────────────────────────────────────
export {
  calculateStanding,
  buildLeagueTable,
  isQualified,
  getQualifiedPlayers,
  matchCountBetween,
  canPlayAgainst,
  runScoringTests,
};
