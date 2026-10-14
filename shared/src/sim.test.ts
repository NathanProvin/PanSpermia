import { expect, test } from 'vitest';
import { MASS_CAP, SPAWN_MASS, WORLD_RADIUS } from './constants.ts';
import { clampSteer, move, radiusOf, speedOf } from './sim.ts';

const DT = 0.05;
const stepFrom = (dirX: number, dirY: number, mass = SPAWN_MASS) => {
  const body = { x: 0, y: 0 };
  move(body, mass, dirX, dirY, DT);
  return body;
};

test('bigger cells are larger and slower', () => {
  expect(radiusOf(MASS_CAP)).toBeGreaterThan(radiusOf(SPAWN_MASS));
  expect(speedOf(MASS_CAP)).toBeLessThan(speedOf(SPAWN_MASS));
});

test('full throttle covers speed·dt along the heading', () => {
  const b = stepFrom(0, 1);
  expect(b.x).toBe(0);
  expect(b.y).toBeCloseTo(speedOf(SPAWN_MASS) * DT, 10);
});

test('throttle scales with |dir| and clamps at 1', () => {
  const full = Math.hypot(...Object.values(stepFrom(3, 4)));
  expect(full).toBeCloseTo(speedOf(SPAWN_MASS) * DT, 10);
  expect(Math.hypot(...Object.values(stepFrom(0.3, 0.4)))).toBeCloseTo(full / 2, 10);
});

test('zero or non-finite input does not move', () => {
  for (const [x, y] of [[0, 0], [NaN, 1], [Infinity, 0], [1, -Infinity]] as const) {
    expect(stepFrom(x, y)).toEqual({ x: 0, y: 0 });
  }
});

test('the whole cell stays inside the pool', () => {
  const body = { x: WORLD_RADIUS - 1, y: 0 };
  move(body, MASS_CAP, 1, 0, DT);
  expect(Math.hypot(body.x, body.y)).toBeCloseTo(WORLD_RADIUS - radiusOf(MASS_CAP), 10);
});

test('clampSteer caps throttle at 1 without bending the heading', () => {
  const far = { dirX: -512, dirY: 58 };
  clampSteer(far);
  expect(Math.hypot(far.dirX, far.dirY)).toBeCloseTo(1, 12);
  expect(Math.atan2(far.dirY, far.dirX)).toBeCloseTo(Math.atan2(58, -512), 12);

  const gentle = { dirX: 0.3, dirY: -0.4 };
  clampSteer(gentle);
  expect(gentle).toEqual({ dirX: 0.3, dirY: -0.4 });

  for (const [dirX, dirY] of [[NaN, 1], [Infinity, 0], [1, -Infinity]]) {
    const bad = { dirX: dirX!, dirY: dirY! };
    clampSteer(bad);
    expect(bad).toEqual({ dirX: 0, dirY: 0 });
  }
});
