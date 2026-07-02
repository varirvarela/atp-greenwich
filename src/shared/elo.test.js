import { describe, it, expect } from 'vitest';
import {
  calculateElo,
  expectedScore,
  getStartingElo,
  eloTrend,
  eloTierLabel,
} from './elo.js';

// ─── calculateElo ─────────────────────────────────────────────────────────────

describe('calculateElo', () => {
  describe('equal ratings (1200 vs 1200)', () => {
    const result = calculateElo(1200, 1200, 'a', 32);

    it('winner gains exactly 16', () => expect(result.deltaA).toBe(16));
    it('loser loses exactly 16', () => expect(result.deltaB).toBe(-16));
    it('new rating A', () => expect(result.newRatingA).toBe(1216));
    it('new rating B', () => expect(result.newRatingB).toBe(1184));
  });

  describe('underdog wins (1000 vs 1400, A wins)', () => {
    const result = calculateElo(1000, 1400, 'a', 32);

    it('underdog gains more than 20 points', () => expect(result.deltaA).toBeGreaterThan(20));
    it('favourite loses more than 20 points', () => expect(result.deltaB).toBeLessThan(-20));
    it('underdog new rating increases', () => expect(result.newRatingA).toBeGreaterThan(1000));
  });

  describe('favourite wins (1400 vs 1000, A wins)', () => {
    const result = calculateElo(1400, 1000, 'a', 32);

    it('favourite gains less than 10 points', () => {
      expect(result.deltaA).toBeGreaterThan(0);
      expect(result.deltaA).toBeLessThan(10);
    });
    it('underdog loses less than 10 points', () => {
      expect(result.deltaB).toBeLessThan(0);
      expect(result.deltaB).toBeGreaterThan(-10);
    });
  });

  describe('slight underdog wins (1180 vs 1220, A wins)', () => {
    const result = calculateElo(1180, 1220, 'a', 32);

    it('underdog gains more than 16', () => expect(result.deltaA).toBeGreaterThan(16));
    it('new rating exceeds 1196', () => expect(result.newRatingA).toBeGreaterThan(1196));
  });

  describe('slight favourite wins (1220 vs 1180, A wins)', () => {
    const result = calculateElo(1220, 1180, 'a', 32);

    it('favourite gains less than 16', () => expect(result.deltaA).toBeLessThan(16));
  });

  describe('B wins (walkover)', () => {
    const result = calculateElo(1200, 1200, 'b', 32);

    it('B gains 16', () => expect(result.deltaB).toBe(16));
    it('new rating B', () => expect(result.newRatingB).toBe(1216));
  });

  describe('custom K-factor', () => {
    const result = calculateElo(1200, 1200, 'a', 16);

    it('K=16 equal ratings — winner gains 8', () => expect(result.deltaA).toBe(8));
  });

  describe('ELO conservation', () => {
    it('deltaA + deltaB always equals zero', () => {
      const r1 = calculateElo(1350, 1150, 'b', 32);
      expect(r1.deltaA + r1.deltaB).toBe(0);

      const r2 = calculateElo(1000, 2000, 'a', 32);
      expect(r2.deltaA + r2.deltaB).toBe(0);
    });
  });

  describe('expectedA field', () => {
    it('equal ratings — expectedA is 0.5', () => {
      const r = calculateElo(1200, 1200, 'a', 32);
      expect(r.expectedA).toBe(0.5);
    });

    it('higher-rated A has expectedA > 0.5', () => {
      const r = calculateElo(1400, 1000, 'a', 32);
      expect(r.expectedA).toBeGreaterThan(0.5);
    });
  });
});

// ─── expectedScore ────────────────────────────────────────────────────────────

describe('expectedScore', () => {
  it('equal ratings → 0.5', () => expect(expectedScore(1200, 1200)).toBe(0.5));
  it('much higher A → close to 1', () => expect(expectedScore(2000, 1000)).toBeGreaterThan(0.99));
  it('much lower A → close to 0', () => expect(expectedScore(1000, 2000)).toBeLessThan(0.01));
});

// ─── getStartingElo ───────────────────────────────────────────────────────────

describe('getStartingElo', () => {
  it('beginner_new → 800',   () => expect(getStartingElo('beginner_new')).toBe(800));
  it('beginner → 1000',      () => expect(getStartingElo('beginner')).toBe(1000));
  it('intermediate → 1200',  () => expect(getStartingElo('intermediate')).toBe(1200));
  it('advanced → 1400',      () => expect(getStartingElo('advanced')).toBe(1400));
  it('expert → 1600',        () => expect(getStartingElo('expert')).toBe(1600));
  it('unknown level → 1000', () => expect(getStartingElo('unknown')).toBe(1000));
  it('undefined → 1000',     () => expect(getStartingElo(undefined)).toBe(1000));
});

// ─── eloTierLabel ─────────────────────────────────────────────────────────────

describe('eloTierLabel', () => {
  it('≥ 1600 → Expert',       () => expect(eloTierLabel(1600)).toBe('Expert'));
  it('1650 → Expert',         () => expect(eloTierLabel(1650)).toBe('Expert'));
  it('1400 → Advanced',       () => expect(eloTierLabel(1400)).toBe('Advanced'));
  it('1399 → Intermediate',   () => expect(eloTierLabel(1399)).toBe('Intermediate'));
  it('1200 → Intermediate',   () => expect(eloTierLabel(1200)).toBe('Intermediate'));
  it('1199 → Beginner',       () => expect(eloTierLabel(1199)).toBe('Beginner'));
  it('1000 → Beginner',       () => expect(eloTierLabel(1000)).toBe('Beginner'));
  it('999 → Newcomer',        () => expect(eloTierLabel(999)).toBe('Newcomer'));
  it('0 → Newcomer',          () => expect(eloTierLabel(0)).toBe('Newcomer'));
});

// ─── eloTrend ─────────────────────────────────────────────────────────────────

describe('eloTrend', () => {
  it('three positive deltas summing > 10 → up',
    () => expect(eloTrend([{ delta: 8 }, { delta: 12 }, { delta: 6 }])).toBe('up'));

  it('three negative deltas summing < -10 → down',
    () => expect(eloTrend([{ delta: -8 }, { delta: -12 }, { delta: -6 }])).toBe('down'));

  it('mixed deltas within ±10 → neutral',
    () => expect(eloTrend([{ delta: 2 }, { delta: -3 }, { delta: 1 }])).toBe('neutral'));

  it('empty history → neutral',
    () => expect(eloTrend([])).toBe('neutral'));

  it('null history → neutral',
    () => expect(eloTrend(null)).toBe('neutral'));

  it('only uses last 3 entries — old losses ignored if recent gains are strong', () => {
    const history = [
      { delta: -20 }, { delta: -20 }, { delta: -20 }, // old — ignored
      { delta: 15 },  { delta: 12 },  { delta: 8 },   // recent
    ];
    expect(eloTrend(history)).toBe('up');
  });
});
