// src/shared/elo.js — v0.01
// ELO rating calculation for ATP Greenwich.
// Pure functions only. No Firebase, no side effects. Fully testable.
//
// System design:
//   - ELO is global and persistent across seasons
//   - Updates after every confirmed match (photo uploaded or admin override)
//   - Bracket matches also update ELO
//   - No draws in tennis — Sa is always 1 (win) or 0 (loss)
//   - Walkover / retirement = counted as a normal win/loss
//   - Default K-factor: 32 (configurable by master admin per league)

// ─── Core formula ────────────────────────────────────────────────────────────

// Expected score for player A against player B.
// Returns a value between 0 and 1.
function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

// Calculate new ELO ratings after a match.
// winner: 'a' | 'b'
// kFactor: defaults to 32
//
// Returns: {
//   newRatingA: number,
//   newRatingB: number,
//   deltaA: number,   // change for player A (positive if won, negative if lost)
//   deltaB: number,   // change for player B
//   expectedA: number // pre-match expected score for A (useful for display)
// }
function calculateElo(ratingA, ratingB, winner, kFactor) {
  const k  = kFactor || 32;
  const ea = expectedScore(ratingA, ratingB);
  const eb = 1 - ea; // expectedScore(ratingB, ratingA) — equivalent, avoids rounding issues

  const sa = winner === 'a' ? 1 : 0;
  const sb = winner === 'b' ? 1 : 0;

  const deltaA = Math.round(k * (sa - ea));
  const deltaB = Math.round(k * (sb - eb));

  return {
    newRatingA: ratingA + deltaA,
    newRatingB: ratingB + deltaB,
    deltaA,
    deltaB,
    expectedA: Math.round(ea * 100) / 100,
  };
}

// ─── Self-assessment ELO seeding ─────────────────────────────────────────────
// Maps onboarding self-assessment answer to starting ELO.

const STARTING_ELO = {
  'beginner_new':      800,   // Just starting out
  'beginner':          1000,  // Know the rules, play occasionally
  'intermediate':      1200,  // Play regularly, have some technique
  'advanced':          1400,  // Compete, strong all-round game
  'expert':            1600,  // Tournament-level play
};

function getStartingElo(level) {
  return STARTING_ELO[level] || 1000;
}

// ─── ELO display helpers ─────────────────────────────────────────────────────

// Returns a trend label based on recent ELO history.
// history: array of { delta } objects, most recent last
function eloTrend(history) {
  if (!history || history.length === 0) return 'neutral';
  const recent = history.slice(-3); // last 3 matches
  const total  = recent.reduce((sum, h) => sum + h.delta, 0);
  if (total > 10)  return 'up';
  if (total < -10) return 'down';
  return 'neutral';
}

// Returns a human-readable ELO tier label.
function eloTierLabel(rating) {
  if (rating >= 1600) return 'Expert';
  if (rating >= 1400) return 'Advanced';
  if (rating >= 1200) return 'Intermediate';
  if (rating >= 1000) return 'Beginner';
  return 'Newcomer';
}

// ─── Test suite ──────────────────────────────────────────────────────────────
// Call runEloTests() in the browser console to verify correctness.
// All tests must pass before any UI is built on top of this module.

function runEloTests() {
  const results = [];

  function test(name, actual, expected, tolerance) {
    const tol  = tolerance || 0;
    const pass = Math.abs(actual - expected) <= tol;
    results.push({ name, pass, actual, expected });
    if (!pass) console.error('FAIL:', name, '— got', actual, 'expected', expected);
  }

  // Test 1: Equal ratings, player A wins
  // Expected: A gains ~16, B loses ~16
  const t1 = calculateElo(1200, 1200, 'a', 32);
  test('Equal ratings A wins — deltaA', t1.deltaA, 16);
  test('Equal ratings A wins — deltaB', t1.deltaB, -16);
  test('Equal ratings A wins — newRatingA', t1.newRatingA, 1216);
  test('Equal ratings A wins — newRatingB', t1.newRatingB, 1184);

  // Test 2: Underdog wins (lower-rated player beats higher-rated)
  // A=1000, B=1400 — A wins. A should gain significantly more than 16.
  const t2 = calculateElo(1000, 1400, 'a', 32);
  test('Underdog win — deltaA positive large', t2.deltaA > 20, true);
  test('Underdog win — deltaB negative large', t2.deltaB < -20, true);
  test('Underdog win — newRatingA increases', t2.newRatingA > 1000, true);

  // Test 3: Favorite wins (higher-rated beats lower-rated)
  // A=1400, B=1000 — A wins. A gains less than 16 (expected to win).
  const t3 = calculateElo(1400, 1000, 'a', 32);
  test('Favorite win — deltaA positive small', t3.deltaA > 0 && t3.deltaA < 10, true);
  test('Favorite win — deltaB negative small', t3.deltaB < 0 && t3.deltaB > -10, true);

  // Test 4: Close ratings, lower-rated wins
  // A=1180, B=1220 — A wins (slight underdog)
  const t4 = calculateElo(1180, 1220, 'a', 32);
  test('Close ratings underdog win — deltaA > 16', t4.deltaA > 16, true);
  test('Close ratings underdog win — newRatingA', t4.newRatingA > 1196, true);

  // Test 5: Close ratings, higher-rated wins
  const t5 = calculateElo(1220, 1180, 'a', 32);
  test('Close ratings favorite win — deltaA < 16', t5.deltaA < 16, true);

  // Test 6: Walkover — same formula as normal win
  const t6 = calculateElo(1200, 1200, 'b', 32); // B wins walkover
  test('Walkover B wins — deltaB', t6.deltaB, 16);
  test('Walkover B wins — newRatingB', t6.newRatingB, 1216);

  // Test 7: Custom K-factor
  const t7 = calculateElo(1200, 1200, 'a', 16); // K=16
  test('Custom K=16 — deltaA', t7.deltaA, 8);

  // Test 8: ELO deltas sum to zero (conservation)
  const t8 = calculateElo(1350, 1150, 'b', 32);
  test('ELO conservation — deltaA + deltaB = 0', t8.deltaA + t8.deltaB, 0);

  // Test 9: Starting ELO seeding
  test('Starting ELO beginner_new', getStartingElo('beginner_new'), 800);
  test('Starting ELO intermediate', getStartingElo('intermediate'), 1200);
  test('Starting ELO expert', getStartingElo('expert'), 1600);
  test('Starting ELO unknown defaults to 1000', getStartingElo('unknown'), 1000);

  // Test 10: ELO trend
  test('Trend up', eloTrend([{ delta: 8 }, { delta: 12 }, { delta: 6 }]), 'up');
  test('Trend down', eloTrend([{ delta: -8 }, { delta: -12 }, { delta: -6 }]), 'down');
  test('Trend neutral', eloTrend([{ delta: 2 }, { delta: -3 }, { delta: 1 }]), 'neutral');
  test('Trend empty', eloTrend([]), 'neutral');

  // Summary
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log('ELO Tests:', passed + '/' + results.length + ' passed' + (failed ? ' — ' + failed + ' FAILED' : ' ✅'));
  return results;
}

// ─── Exports ─────────────────────────────────────────────────────────────────
export {
  calculateElo,
  expectedScore,
  getStartingElo,
  eloTrend,
  eloTierLabel,
  runEloTests,
  STARTING_ELO,
};
