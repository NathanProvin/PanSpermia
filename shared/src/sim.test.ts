import { expect, test } from 'vitest';
import {
  DRIFT_PILI, MASS_CAP, RUN_TURN_RATE, SPAWN_MASS, SWIM_CREEP, SWIM_FLAGELLUM, SWIM_PILI, TUMBLE_ERROR,
  TUMBLE_ERROR_CHEMO, TUMBLE_TIME, WORLD_RADIUS,
} from './constants.ts';
import { GENES } from './genes.ts';
import { type CellBody, clampSteer, radiusOf, speedOf, stepCell, wrapAngle } from './sim.ts';

const DT = 0.05;
const T = 12.3;
const { pili, flagellum, chemoreceptor } = { pili: GENES.pili.bit, flagellum: GENES.flagellum.bit, chemoreceptor: GENES.chemoreceptor.bit };
const cell = (over: Partial<CellBody> = {}): CellBody => ({ x: 200, y: -100, heading: 0, tumble: 0, rng: 12345, ...over });

/** Displacement over one step. */
const stepOf = (genome: number, dirX: number, dirY: number, start = cell()) => {
  const b = { ...start };
  stepCell(b, SPAWN_MASS, genome, dirX, dirY, DT, T);
  return { dx: b.x - start.x, dy: b.y - start.y, body: b };
};
/** Swim displacement alone: the same step minus the pure drift from the same spot and time. */
const swimOf = (genome: number, dirX: number, dirY: number) => {
  const moved = stepOf(genome, dirX, dirY);
  const drifted = stepOf(genome, 0, 0);
  return Math.hypot(moved.dx - drifted.dx, moved.dy - drifted.dy);
};

test('bigger cells are larger and slower', () => {
  expect(radiusOf(MASS_CAP)).toBeGreaterThan(radiusOf(SPAWN_MASS));
  expect(speedOf(MASS_CAP)).toBeLessThan(speedOf(SPAWN_MASS));
});

test('swim speed follows motility genes and throttle', () => {
  const full = speedOf(SPAWN_MASS) * DT;
  expect(swimOf(0, 1, 0)).toBeCloseTo(SWIM_CREEP * full, 10);
  expect(swimOf(pili, 1, 0)).toBeCloseTo(SWIM_PILI * full, 10);
  expect(swimOf(flagellum, 1, 0)).toBeCloseTo(SWIM_FLAGELLUM * full, 10); // heading 0 = pointer: a run
  expect(swimOf(pili, 0.3, 0.4)).toBeCloseTo(SWIM_PILI * full * 0.5, 10);
});

test('currents carry every cell; pili grip resists them', () => {
  const free = stepOf(0, 0, 0);
  const gripped = stepOf(pili, 0, 0);
  expect(Math.hypot(free.dx, free.dy)).toBeGreaterThan(0);
  expect(gripped.dx).toBeCloseTo(free.dx * DRIFT_PILI, 10);
  expect(gripped.dy).toBeCloseTo(free.dy * DRIFT_PILI, 10);
});

test('flagellum: small turns steer slowly during a run', () => {
  const { body } = stepOf(flagellum, Math.cos(0.5), Math.sin(0.5)); // 0.5 rad < tumble angle
  expect(body.tumble).toBe(0);
  expect(body.heading).toBeCloseTo(RUN_TURN_RATE * DT, 10);
});

test('flagellum: wide turns tumble, then re-aim at the pointer with bounded random error', () => {
  for (const [genome, bound] of [[flagellum, TUMBLE_ERROR], [flagellum | chemoreceptor, TUMBLE_ERROR_CHEMO]] as const) {
    const errors: number[] = [];
    for (let seed = 1; seed <= 200; seed++) {
      const b = cell({ rng: seed * 2654435761 >>> 0 });
      const want = 2.5; // well past the tumble angle from heading 0
      stepCell(b, SPAWN_MASS, genome, Math.cos(want), Math.sin(want), DT, T);
      expect(b.tumble).toBeGreaterThan(0);
      const stepsToFinish = Math.round(TUMBLE_TIME / DT);
      for (let i = 0; i < stepsToFinish; i++) {
        const before = { x: b.x, y: b.y };
        const drift = stepOf(genome, 0, 0, b); // no swim while tumbling: same as drifting
        stepCell(b, SPAWN_MASS, genome, Math.cos(want), Math.sin(want), DT, T);
        if (b.tumble > 0) expect(Math.hypot(b.x - before.x - drift.dx, b.y - before.y - drift.dy)).toBeLessThan(1e-9);
      }
      expect(b.tumble).toBe(0);
      errors.push(wrapAngle(b.heading - want));
    }
    expect(Math.max(...errors.map(Math.abs))).toBeLessThanOrEqual(bound);
    expect(Math.max(...errors) - Math.min(...errors)).toBeGreaterThan(bound); // genuinely random, both sides
  }
});

test('steps are deterministic given the same rng state', () => {
  const a = cell({ rng: 777 });
  const b = cell({ rng: 777 });
  for (let i = 0; i < 50; i++) {
    const dir = [Math.cos(i), Math.sin(i * 1.7)] as const;
    stepCell(a, SPAWN_MASS, flagellum, dir[0], dir[1], DT, T + i * DT);
    stepCell(b, SPAWN_MASS, flagellum, dir[0], dir[1], DT, T + i * DT);
  }
  expect(a).toEqual(b);
});

test('the whole cell stays inside the pool', () => {
  const b = cell({ x: WORLD_RADIUS - 1, y: 0 });
  stepCell(b, MASS_CAP, flagellum, 1, 0, DT, T);
  expect(Math.hypot(b.x, b.y)).toBeLessThanOrEqual(WORLD_RADIUS - radiusOf(MASS_CAP) + 1e-9);
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
