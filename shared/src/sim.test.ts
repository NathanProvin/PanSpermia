import { rimAt } from './rim.ts';
import { expect, test } from 'vitest';
import {
  CILIA_TURN, DRIFT_PILI, INERTIA, MASS_CAP, PILI_TURN, RUN_TURN_RATE, SPAWN_MASS, TUMBLE_SPIN, SWIM_CREEP, SWIM_FLAGELLUM, SWIM_PILI, TUMBLE_ERROR,
  TUMBLE_ERROR_CHEMO, TUMBLE_TIME, WORLD_RADIUS,
} from './constants.ts';
import { ACTION_SPORE, CAPSULE_SWIM, ENDOSPORE_COOLDOWN, ENDOSPORE_TIME, WALL_SWIM } from './combat.ts';
import { GENES } from './genes.ts';
import { type CellBody, clampSteer, radiusOf, speedOf, stepCell, wrapAngle } from './sim.ts';

const DT = 0.05;
const T = 12.3;
const { pili, flagellum, chemoreceptor } = { pili: GENES.pili.bit, flagellum: GENES.flagellum.bit, chemoreceptor: GENES.chemoreceptor.bit };
const cell = (over: Partial<CellBody> = {}): CellBody => ({
  x: 200, y: -100, heading: 0, tumble: 0, rng: 12345, spore: 0, sporeCooldown: 0, dash: 0, dashCooldown: 0, vx: 0, vy: 0, aim: 0,
  ...over,
});

/** Displacement over one step. */
const stepOf = (genome: number, dirX: number, dirY: number, start = cell()) => {
  const b = { ...start };
  stepCell(b, SPAWN_MASS, genome, dirX, dirY, 0, DT, T);
  return { dx: b.x - start.x, dy: b.y - start.y, body: b };
};
/** Swim speed once the cell has turned and got up to speed (inertia settled): 15 s of the same input. */
const swimOf = (genome: number, dirX: number, dirY: number, tier = 1, genome2 = 0) => {
  const b = cell();
  for (let i = 0; i < 300; i++) stepCell(b, tier === 2 ? 120 : SPAWN_MASS, genome, dirX, dirY, 0, DT, T, tier, genome2);
  return Math.hypot(b.vx, b.vy);
};

test('bigger cells are larger and slower', () => {
  expect(radiusOf(MASS_CAP)).toBeGreaterThan(radiusOf(SPAWN_MASS));
  expect(speedOf(MASS_CAP)).toBeLessThan(speedOf(SPAWN_MASS));
});

test('newborns swim 1.8× (phases 1–2) or 1.5× (3–4) their old speed (coef · mass^-0.4) and lose half as much with mass', () => {
  for (const [tier, spawn, cap, coef, boost] of [[1, 10, 100, 300, 1.8], [2, 120, 1000, 748, 1.8], [3, 1200, 6000, 3055, 1.5], [4, 6000, 10000, 6318, 1.5]]) {
    expect(speedOf(spawn!, tier) / (coef! * spawn! ** -0.4)).toBeCloseTo(boost!, 1);
    expect(Math.log(speedOf(cap!, tier) / speedOf(spawn!, tier)) / Math.log(cap! / spawn!)).toBeCloseTo(-0.2, 6);
  }
});

test('swim speed follows motility genes and throttle', () => {
  const full = speedOf(SPAWN_MASS);
  expect(swimOf(0, 1, 0)).toBeCloseTo(SWIM_CREEP * full, 6);
  expect(swimOf(pili, 1, 0)).toBeCloseTo(SWIM_PILI * full, 6);
  expect(swimOf(flagellum, 1, 0)).toBeCloseTo(SWIM_FLAGELLUM * full, 6); // heading 0 = pointer: a run
  expect(swimOf(pili, 0.3, 0.4)).toBeCloseTo(SWIM_PILI * full * 0.5, 6);
});

test('inertia: a cell gets up to speed, and glides on after the input stops', () => {
  const target = SWIM_PILI * speedOf(SPAWN_MASS);
  const b = cell();
  stepCell(b, SPAWN_MASS, pili, 1, 0, 0, DT, T);
  expect(b.vx).toBeCloseTo(target * (1 - Math.exp(-DT / INERTIA[1]!)), 10);
  for (let i = 0; i < 100; i++) stepCell(b, SPAWN_MASS, pili, 1, 0, 0, DT, T);
  const cruising = b.vx;
  stepCell(b, SPAWN_MASS, pili, 0, 0, 0, DT, T);
  expect(b.vx).toBeGreaterThan(cruising * 0.8); // still gliding
  expect(b.vx).toBeLessThan(cruising);
});

test('turns are progressive: no body snaps round', () => {
  const b = cell();
  stepCell(b, SPAWN_MASS, pili, -1, 0, 0, DT, T); // straight behind
  expect(Math.abs(b.heading)).toBeCloseTo(PILI_TURN * DT, 10);
  for (let i = 0; i < 40; i++) stepCell(b, SPAWN_MASS, pili, -1, 0, 0, DT, T);
  expect(Math.abs(wrapAngle(b.heading - Math.PI))).toBeLessThan(1e-9);
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
      stepCell(b, SPAWN_MASS, genome, Math.cos(want), Math.sin(want), 0, DT, T);
      expect(b.tumble).toBeGreaterThan(0);
      const stepsToFinish = Math.round(TUMBLE_TIME / DT);
      for (let i = 0; i < stepsToFinish; i++) {
        const before = b.heading;
        stepCell(b, SPAWN_MASS, genome, Math.cos(want), Math.sin(want), 0, DT, T);
        // The cell spins round to its new heading (no jump), except the final settle onto the aim.
        if (b.tumble > 0) expect(Math.abs(wrapAngle(b.heading - before))).toBeLessThanOrEqual(TUMBLE_SPIN * DT + 1e-9);
      }
      expect(b.tumble).toBe(0);
      errors.push(wrapAngle(b.heading - want));
    }
    expect(Math.max(...errors.map(Math.abs))).toBeLessThanOrEqual(bound);
    expect(Math.max(...errors) - Math.min(...errors)).toBeGreaterThan(bound); // genuinely random, both sides
  }
});

test('capsule and thick wall slow swimming', () => {
  const full = swimOf(pili, 1, 0);
  expect(swimOf(pili | GENES.capsule.bit, 1, 0)).toBeCloseTo(full * CAPSULE_SWIM, 6);
  expect(swimOf(pili | GENES.thickWall.bit, 1, 0)).toBeCloseTo(full * WALL_SWIM, 6);
});

test('endospore: dormant (no swim, still drifts) for its duration, then a long cooldown', () => {
  const spore = pili | GENES.endospore.bit;
  const b = cell();
  stepCell(b, SPAWN_MASS, pili, 1, 0, ACTION_SPORE, DT, T); // without the gene: nothing
  expect(b.spore).toBe(0);

  const s = cell();
  const drifted = stepOf(spore, 0, 0, s);
  stepCell(s, SPAWN_MASS, spore, 1, 0, ACTION_SPORE, DT, T);
  expect(s.spore).toBeCloseTo(ENDOSPORE_TIME, 6);
  expect(s.x - 200).toBeCloseTo(drifted.dx, 10); // swim suppressed, drift kept
  expect(s.y + 100).toBeCloseTo(drifted.dy, 10);

  const steps = Math.round(ENDOSPORE_TIME / DT);
  for (let i = 0; i < steps; i++) stepCell(s, SPAWN_MASS, spore, 1, 0, ACTION_SPORE, DT, T);
  expect(s.spore).toBe(0);
  expect(s.sporeCooldown).toBeCloseTo(ENDOSPORE_COOLDOWN - ENDOSPORE_TIME, 6);
  stepCell(s, SPAWN_MASS, spore, 1, 0, ACTION_SPORE, DT, T); // still cooling down: no re-trigger
  expect(s.spore).toBe(0);
});

test('steps are deterministic given the same rng state', () => {
  const a = cell({ rng: 777 });
  const b = cell({ rng: 777 });
  for (let i = 0; i < 50; i++) {
    const dir = [Math.cos(i), Math.sin(i * 1.7)] as const;
    stepCell(a, SPAWN_MASS, flagellum, dir[0], dir[1], 0, DT, T + i * DT);
    stepCell(b, SPAWN_MASS, flagellum, dir[0], dir[1], 0, DT, T + i * DT);
  }
  expect(a).toEqual(b);
});

test('the whole cell stays inside the pool', () => {
  const b = cell({ x: rimAt(0) - 1, y: 0 }); // at the shore (rim.ts)
  stepCell(b, MASS_CAP, flagellum, 1, 0, 0, DT, T);
  expect(Math.hypot(b.x, b.y)).toBeLessThanOrEqual(rimAt(Math.atan2(b.y, b.x)) - radiusOf(MASS_CAP) + 1e-6);
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

test('eukaryotes steer: cilia turn quickly, a lone flagellum turns slowly but swims faster', async () => {
  const { TIER2 } = await import('./eukaryote.ts');
  const { T2_SWIM_CILIA, T2_SWIM_FLAGELLUM, T2_TURN_RATE, T2_SPAWN_MASS, T2_DRIFT } = await import('./constants.ts');
  const step = (genome2: number, dirX: number, dirY: number) => {
    const moved = { ...cell() };
    stepCell(moved, T2_SPAWN_MASS, 0, dirX, dirY, 0, DT, T, 2, genome2);
    return { body: moved };
  };
  const full = speedOf(T2_SPAWN_MASS, 2);
  const cilia = TIER2.GENES.cilia.bit;
  const flagellum = TIER2.GENES.flagellum.bit;
  expect(step(cilia, 0, 1).body.heading).toBeCloseTo(CILIA_TURN * DT, 10); // quick turn
  expect(swimOf(0, 1, 0, 2, cilia)).toBeCloseTo(T2_SWIM_CILIA * full, 6);
  expect(step(flagellum, 0, 1).body.heading).toBeCloseTo(T2_TURN_RATE * DT, 10); // slow turn
  expect(swimOf(0, 1, 0, 2, flagellum)).toBeCloseTo(T2_SWIM_FLAGELLUM * full, 6);
  expect(step(flagellum | cilia, 0, 1).body.heading).toBeCloseTo(CILIA_TURN * DT, 10); // cilia steer the flagellum

  // Tier-1 genes mean nothing to a eukaryote: a 'flagellum' bit in genome doesn't tumble it.
  const b = cell();
  stepCell(b, T2_SPAWN_MASS, GENES.flagellum.bit, 0, -1, 0, DT, T, 2, cilia);
  expect(b.tumble).toBe(0);
  // Big cells drift with less of the current than a geneless bacterium.
  const eu = cell();
  const bac = cell();
  stepCell(eu, T2_SPAWN_MASS, 0, 0, 0, 0, DT, T, 2, 0);
  stepCell(bac, SPAWN_MASS, 0, 0, 0, 0, DT, T);
  expect(eu.x - 200).toBeCloseTo((bac.x - 200) * T2_DRIFT, 6);
});

test('the jet dashes on demand (predicted), then cools down', async () => {
  const { TIER2 } = await import('./eukaryote.ts');
  const { JET_TIME, JET_COOLDOWN, JET_BOOST, T2_SPAWN_MASS, T2_SWIM_CILIA } = await import('./constants.ts');
  const genome2 = TIER2.GENES.cilia.bit | TIER2.GENES.jet.bit;
  const b = cell();
  const calm = cell();
  stepCell(b, T2_SPAWN_MASS, 0, 1, 0, ACTION_SPORE, DT, T, 2, genome2);
  stepCell(calm, T2_SPAWN_MASS, 0, 1, 0, 0, DT, T, 2, genome2);
  expect(b.dashCooldown).toBeCloseTo(JET_COOLDOWN - 0, 6);
  expect(b.dash).toBeCloseTo(JET_TIME, 6);
  expect((b.x - 200) / (calm.x - 200)).toBeGreaterThan(1.5); // faster than a normal stroke
  expect(T2_SWIM_CILIA * JET_BOOST).toBeGreaterThan(2);
  for (let i = 0; i < (JET_TIME / DT) + 1; i++) stepCell(b, T2_SPAWN_MASS, 0, 1, 0, ACTION_SPORE, DT, T, 2, genome2);
  expect(b.dash).toBe(0); // can't chain dashes during the cooldown
  const plain = cell();
  stepCell(plain, T2_SPAWN_MASS, 0, 1, 0, ACTION_SPORE, DT, T, 2, TIER2.GENES.cilia.bit);
  expect(plain.dash).toBe(0); // needs a jet
});

test('shapes: deform and undeform are inverses; a round body is the identity', async () => {
  const { deform, undeform } = await import('./shapes.ts');
  for (const shape of [0, 1, 2]) {
    for (const [x, y] of [[1, 0], [0, 1], [-0.6, 0.3], [0.2, -0.9]] as const) {
      const d = deform(shape, x, y);
      const back = undeform(shape, d.x, d.y);
      expect(back.x).toBeCloseTo(x, 10);
      expect(back.y).toBeCloseTo(y, 10);
    }
  }
  expect(deform(0, 0.3, -0.4, 1.2)).toEqual({ x: 0.3, y: -0.4, angle: 1.2 });
  expect(deform(1, 1, 0).x).toBeGreaterThan(1.4); // a rod is long
});
