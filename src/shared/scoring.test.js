import { describe, it, expect } from 'vitest';
import {
  calculateStanding,
  buildLeagueTable,
  isQualified,
  getQualifiedPlayers,
  matchCountBetween,
  canPlayAgainst,
} from './scoring.js';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const A = 'player_a';
const B = 'player_b';
const C = 'player_c';
const D = 'player_d';

const win_A_over_B = {
  status: 'confirmed',
  playerA: A,
  playerB: B,
  result: {
    winner: A,
    sets: [{ a: 6, b: 3 }, { a: 7, b: 5 }],
  },
};

const loss_A_to_B = {
  status: 'confirmed',
  playerA: A,
  playerB: B,
  result: {
    winner: B,
    sets: [{ a: 3, b: 6 }, { a: 4, b: 6 }],
  },
};

const pending_match = {
  status: 'result_pending',
  playerA: A,
  playerB: B,
  result: null,
};

// ─── calculateStanding ────────────────────────────────────────────────────────

describe('calculateStanding', () => {
  describe('single win', () => {
    const s = calculateStanding([win_A_over_B], A);

    it('matchesWon = 1',  () => expect(s.matchesWon).toBe(1));
    it('matchesPlayed = 1', () => expect(s.matchesPlayed).toBe(1));
    it('gamesWon = 13 (6+7)', () => expect(s.gamesWon).toBe(13));
    it('gamesLost = 8 (3+5)', () => expect(s.gamesLost).toBe(8));
    it('gameDiff = 5',    () => expect(s.gameDiff).toBe(5));
    it('winRate = 1',     () => expect(s.winRate).toBe(1));
    it('points = 1',      () => expect(s.points).toBe(1));
  });

  describe('single loss', () => {
    const s = calculateStanding([loss_A_to_B], A);

    it('matchesWon = 0',       () => expect(s.matchesWon).toBe(0));
    it('gamesWon = 7 (3+4)',   () => expect(s.gamesWon).toBe(7));
    it('gamesLost = 12 (6+6)', () => expect(s.gamesLost).toBe(12));
    it('gameDiff = -5',        () => expect(s.gameDiff).toBe(-5));
    it('winRate = 0',          () => expect(s.winRate).toBe(0));
  });

  describe('from B side — same match, B perspective', () => {
    const s = calculateStanding([win_A_over_B], B);

    it('B lost — matchesWon = 0', () => expect(s.matchesWon).toBe(0));
    it('B gamesWon = 8 (opp side)', () => expect(s.gamesWon).toBe(8));
    it('B gamesLost = 13',          () => expect(s.gamesLost).toBe(13));
  });

  describe('win/loss mix', () => {
    const s = calculateStanding([win_A_over_B, loss_A_to_B], A);

    it('matchesPlayed = 2', () => expect(s.matchesPlayed).toBe(2));
    it('matchesWon = 1',    () => expect(s.matchesWon).toBe(1));
    it('winRate = 0.5',     () => expect(s.winRate).toBe(0.5));
  });

  describe('pending/non-confirmed matches are ignored', () => {
    const s = calculateStanding([win_A_over_B, pending_match], A);

    it('only 1 match counted', () => expect(s.matchesPlayed).toBe(1));
  });

  describe('empty match list', () => {
    const s = calculateStanding([], A);

    it('zero wins',    () => expect(s.matchesWon).toBe(0));
    it('zero played',  () => expect(s.matchesPlayed).toBe(0));
    it('winRate = 0',  () => expect(s.winRate).toBe(0));
    it('gameDiff = 0', () => expect(s.gameDiff).toBe(0));
  });

  describe('3-set match', () => {
    const threeSet = {
      status: 'confirmed',
      playerA: A,
      playerB: B,
      result: {
        winner: A,
        sets: [{ a: 6, b: 3 }, { a: 4, b: 6 }, { a: 6, b: 4 }],
      },
    };
    const s = calculateStanding([threeSet], A);

    it('gamesWon = 16',  () => expect(s.gamesWon).toBe(16));
    it('gamesLost = 13', () => expect(s.gamesLost).toBe(13));
    it('gameDiff = 3',   () => expect(s.gameDiff).toBe(3));
  });
});

// ─── buildLeagueTable ─────────────────────────────────────────────────────────

describe('buildLeagueTable', () => {
  it('returns one row per member uid', () => {
    const table = buildLeagueTable({}, [A, B, C]);
    expect(table).toHaveLength(3);
  });

  it('all rows have rank, uid, and standing', () => {
    const table = buildLeagueTable({}, [A, B]);
    table.forEach(row => {
      expect(row).toHaveProperty('uid');
      expect(row).toHaveProperty('rank');
      expect(row).toHaveProperty('standing');
    });
  });

  it('player with more wins ranks higher', () => {
    const matches = {
      m1: win_A_over_B,
    };
    const table = buildLeagueTable(matches, [A, B]);
    expect(table[0].uid).toBe(A);
    expect(table[0].rank).toBe(1);
  });

  it('tied players share the same rank', () => {
    // A and B have no confirmed matches — both 0W, 0P, 0GD
    const table = buildLeagueTable({}, [A, B]);
    expect(table[0].rank).toBe(1);
    expect(table[1].rank).toBe(1);
  });

  it('rank skips after a tie (1,1,3 not 1,1,2)', () => {
    // Three players all with 0 confirmed matches → tied at rank 1
    const table = buildLeagueTable({}, [A, B, C]);
    expect(table.every(r => r.rank === 1)).toBe(true);
  });

  it('handles null/empty allMatches gracefully', () => {
    expect(() => buildLeagueTable(null, [A, B])).not.toThrow();
    expect(() => buildLeagueTable({},   [A, B])).not.toThrow();
  });

  it('tiebreak: same wins but better gameDiff ranks higher', () => {
    const bigWin = {
      status: 'confirmed',
      playerA: A,
      playerB: C,
      result: { winner: A, sets: [{ a: 6, b: 0 }, { a: 6, b: 0 }] },
    };
    const smallWin = {
      status: 'confirmed',
      playerA: B,
      playerB: C,
      result: { winner: B, sets: [{ a: 7, b: 6 }, { a: 7, b: 6 }] },
    };
    const table = buildLeagueTable({ m1: bigWin, m2: smallWin }, [A, B, C]);
    // A: 1W, GD = +12. B: 1W, GD = +2. A should rank higher.
    expect(table[0].uid).toBe(A);
  });
});

// ─── isQualified ──────────────────────────────────────────────────────────────

describe('isQualified', () => {
  const cfg = { minMatches: 6, minWins: 4 };

  it('meets both thresholds → qualified',
    () => expect(isQualified({ matchesPlayed: 7, matchesWon: 5 }, cfg)).toBe(true));

  it('exact minimums → qualified',
    () => expect(isQualified({ matchesPlayed: 6, matchesWon: 4 }, cfg)).toBe(true));

  it('not enough matches → not qualified',
    () => expect(isQualified({ matchesPlayed: 4, matchesWon: 4 }, cfg)).toBe(false));

  it('not enough wins → not qualified',
    () => expect(isQualified({ matchesPlayed: 8, matchesWon: 3 }, cfg)).toBe(false));

  it('uses default thresholds when config omitted',
    () => expect(isQualified({ matchesPlayed: 6, matchesWon: 4 }, {})).toBe(true));
});

// ─── getQualifiedPlayers ──────────────────────────────────────────────────────

describe('getQualifiedPlayers', () => {
  it('returns only qualified players', () => {
    const table = [
      { uid: A, rank: 1, standing: { matchesPlayed: 8, matchesWon: 5, gameDiff: 10 } },
      { uid: B, rank: 2, standing: { matchesPlayed: 3, matchesWon: 1, gameDiff: -2 } },
    ];
    const result = getQualifiedPlayers(table, { minMatches: 6, minWins: 4, bracketSize: 8 });
    expect(result).toHaveLength(1);
    expect(result[0].uid).toBe(A);
  });

  it('caps at bracketSize', () => {
    const qualified = Array.from({ length: 10 }, (_, i) => ({
      uid: `player_${i}`,
      rank: i + 1,
      standing: { matchesPlayed: 8, matchesWon: 6, gameDiff: 5 },
    }));
    const result = getQualifiedPlayers(qualified, { minMatches: 6, minWins: 4, bracketSize: 4 });
    expect(result).toHaveLength(4);
  });
});

// ─── matchCountBetween ────────────────────────────────────────────────────────

describe('matchCountBetween', () => {
  const matches = {
    m1: { status: 'confirmed',     playerA: A, playerB: B },
    m2: { status: 'scheduled',     playerA: A, playerB: B },
    m3: { status: 'result_pending', playerA: A, playerB: B },
    m4: { status: 'photo_pending', playerA: A, playerB: B },
    m5: { status: 'confirmed',     playerA: A, playerB: C }, // different opponent
  };

  it('counts all non-cancelled statuses between A and B', () =>
    expect(matchCountBetween(matches, A, B)).toBe(4));

  it('counts regardless of playerA/playerB order', () =>
    expect(matchCountBetween(matches, B, A)).toBe(4));

  it('does not count matches involving a third player', () =>
    expect(matchCountBetween(matches, A, C)).toBe(1));

  it('returns 0 when no matches exist between the pair', () =>
    expect(matchCountBetween(matches, B, C)).toBe(0));

  it('handles empty match object', () =>
    expect(matchCountBetween({}, A, B)).toBe(0));

  it('handles null match object', () =>
    expect(matchCountBetween(null, A, B)).toBe(0));
});

// ─── canPlayAgainst ───────────────────────────────────────────────────────────

describe('canPlayAgainst', () => {
  it('0 matches → can play',  () => expect(canPlayAgainst({}, A, B)).toBe(true));

  it('1 match → can still play', () => {
    const m = { m1: { status: 'confirmed', playerA: A, playerB: B } };
    expect(canPlayAgainst(m, A, B)).toBe(true);
  });

  it('2 matches → cap reached, cannot play', () => {
    const m = {
      m1: { status: 'confirmed', playerA: A, playerB: B },
      m2: { status: 'scheduled', playerA: A, playerB: B },
    };
    expect(canPlayAgainst(m, A, B)).toBe(false);
  });

  it('cap on A vs B does not affect A vs C', () => {
    const m = {
      m1: { status: 'confirmed', playerA: A, playerB: B },
      m2: { status: 'confirmed', playerA: A, playerB: B },
    };
    expect(canPlayAgainst(m, A, C)).toBe(true);
  });
});
