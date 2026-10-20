import { expect, test } from 'vitest';
import { openHall } from './hall.ts';

const NOW = Date.UTC(2026, 9, 21, 12);
const YESTERDAY = NOW - 86_400_000;

test('the hall ranks by time to land, then by fewest generations', () => {
  const hall = openHall(':memory:');
  hall.record({ name: 'Slow', seconds: 900, generations: 3, kills: 0 }, 10, NOW);
  hall.record({ name: 'Fast many', seconds: 600, generations: 9, kills: 2 }, 10, NOW);
  const { allTime, rankAll } = hall.record({ name: 'Fast few', seconds: 600, generations: 4, kills: 1 }, 10, NOW);
  expect(rankAll).toBe(1);
  expect(allTime.map((w) => w.name)).toEqual(['Fast few', 'Fast many', 'Slow']);
  expect(allTime.map((w) => w.rank)).toEqual([1, 2, 3]);

  // Out of the top n: the list stays the top, the rank is still exact.
  const out = hall.record({ name: 'Last', seconds: 1200, generations: 1, kills: 0 }, 2, NOW);
  expect(out.allTime.map((w) => w.name)).toEqual(['Fast few', 'Fast many']);
  expect(out.rankAll).toBe(4);
});

test('today counts only wins since the UTC day began; all-time counts every win', () => {
  const hall = openHall(':memory:');
  hall.record({ name: 'Old champion', seconds: 100, generations: 2, kills: 0 }, 10, YESTERDAY);
  const r = hall.record({ name: 'Today', seconds: 300, generations: 5, kills: 0 }, 10, NOW);
  expect(r.today.map((w) => w.name)).toEqual(['Today']);
  expect(r.allTime.map((w) => w.name)).toEqual(['Old champion', 'Today']);
  expect([r.rankToday, r.rankAll]).toEqual([1, 2]);
  expect(hall.lists(10, NOW).rankAll).toBe(0); // reading enters nothing
});
