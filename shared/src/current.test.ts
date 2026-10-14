import { expect, test } from 'vitest';
import { WORLD_RADIUS } from './constants.ts';
import { currentAt, drift } from './current.ts';

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

test('drift is path-identical whether computed at once or tick by tick', () => {
  const once = { x: 321.5, y: -654.25, tick: 1000 };
  const steps = { ...once };
  drift(once, 1600);
  for (let t = 1001; t <= 1600; t++) drift(steps, t);
  expect(steps).toEqual(once);
  expect(Math.hypot(once.x - 321.5, once.y + 654.25)).toBeGreaterThan(10); // it actually moved
});
