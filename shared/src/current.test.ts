import { expect, test } from 'vitest';
import { WORLD_RADIUS } from './constants.ts';
import { currentAt } from './current.ts';

test('currents are divergence-free and gentle compared to cells', () => {
  const h = 0.01;
  let maxSpeed = 0;
  for (let i = 0; i < 500; i++) {
    const x = (Math.random() * 2 - 1) * WORLD_RADIUS;
    const y = (Math.random() * 2 - 1) * WORLD_RADIUS;
    const t = Math.random() * 1000;
    const div = (currentAt(x + h, y, t).x - currentAt(x - h, y, t).x) / (2 * h)
      + (currentAt(x, y + h, t).y - currentAt(x, y - h, t).y) / (2 * h);
    expect(Math.abs(div)).toBeLessThan(1e-6);
    const c = currentAt(x, y, t);
    maxSpeed = Math.max(maxSpeed, Math.hypot(c.x, c.y));
  }
  expect(maxSpeed).toBeGreaterThan(5); // it does flow
  expect(maxSpeed).toBeLessThan(70); // slowest cell (mass cap) swims 47 u/s; currents nudge, rarely overpower
});
