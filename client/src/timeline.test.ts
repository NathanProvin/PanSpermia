import { TICK_RATE } from '@panspermia/shared';
import { expect, test } from 'vitest';
import { TRAIL_DELAY, createTickClock, createTrails } from './timeline.ts';

test('the tick clock runs evenly through bursty patches', () => {
  const clock = createTickClock();
  const dt = 1 / 60;
  let tick = 0;
  let arrived = 0;
  let last = clock(tick, 0, dt);
  const steps: number[] = [];
  // Patches every 62 ms carrying 1 or 2 ticks (Windows timers), frames at 60 Hz, for 4 s.
  for (let f = 1, next = 0.062; f < 240; f++) {
    const now = f * dt;
    if (now >= next) { tick = Math.floor(next * TICK_RATE); arrived = next; next += 0.062; }
    const at = clock(tick, now - arrived, dt);
    if (f > 60) steps.push(at - last); // past the settling
    last = at;
  }
  const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
  expect(mean).toBeCloseTo(TICK_RATE * dt, 1);
  for (const s of steps) expect(Math.abs(s - mean)).toBeLessThan(0.35 * mean); // no saw: never back, never a leap
});

test('a trail plays back by tick, lerped, the short way round', () => {
  const trails = createTrails();
  const cell = { x: 0, y: 0, heading: Math.PI - 0.1 };
  trails.record([cell], 10);
  Object.assign(cell, { x: 10, heading: -Math.PI + 0.1 }); // across ±π
  trails.record([cell], 12); // a patch that carried two ticks
  const mid = trails.pose(cell, 11 + TRAIL_DELAY);
  expect(mid.x).toBeCloseTo(5);
  expect(Math.abs(mid.heading)).toBeCloseTo(Math.PI);
  expect(trails.pose(cell, 99).x).toBe(10); // past the newest: held, not extrapolated
  expect(trails.pose(cell, 0).x).toBe(0);
});
