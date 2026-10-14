import {
  DEBRIS_MASS, DEBRIS_SHARE, EXOENZYME_YIELD, GENES, HEALTH_MAX, MASS_CAP, MIN_MASS, NUTRIENT_LIFETIME, NUTRIENT_MASS,
  NutrientKind, PoolState, SEEP_COUNT, SIDEROPHORE_REACH, SPAWN_MASS, TICK_RATE, TRANSPORTER_YIELD, WORLD_RADIUS, drift,
  radiusOf,
} from '@panspermia/shared';
import { expect, test } from 'vitest';
import { initPool, metabolize, reachOf, spawnNutrient, spawnPlayer, stepWorld, yieldOf } from './world.ts';

const worldWith = (player = spawnPlayer()) => {
  const state = new PoolState();
  state.players.set('p', player);
  return { state, player };
};
/** Place a packet at (x, y) that the next stepWorld will drift by at most ~3.5 units. */
const foodAt = (state: PoolState, x: number, y: number, kind: number = NutrientKind.dissolved) => {
  spawnNutrient(state, x, y, kind);
  return [...state.nutrients.keys()].at(-1)!;
};

test('a fresh pool has seeps and established plumes', () => {
  const state = new PoolState();
  initPool(state);
  expect(state.seeps.length).toBe(SEEP_COUNT);
  expect(state.nutrients.size).toBeGreaterThan(300);
  expect(state.tick).toBe(NUTRIENT_LIFETIME * TICK_RATE);
});

test('server packet positions equal a client rebuild from spawn point and tick', () => {
  const state = new PoolState();
  initPool(state);
  for (const n of state.nutrients.values()) {
    const rebuilt = { x: n.x0, y: n.y0, tick: n.tick0 };
    drift(rebuilt, state.tick);
    expect(rebuilt.x).toBe(n.x);
    expect(rebuilt.y).toBe(n.y);
  }
});

test('packets dissolve with age and against the rock', () => {
  const state = new PoolState();
  const old = foodAt(state, 0, 0);
  const edge = foodAt(state, WORLD_RADIUS + 5, 0);
  stepWorld(state);
  expect(state.nutrients.has(edge)).toBe(false);
  expect(state.nutrients.has(old)).toBe(true);
  for (let i = 0; i < NUTRIENT_LIFETIME * TICK_RATE; i++) stepWorld(state);
  expect(state.nutrients.has(old)).toBe(false);
});

test('cells absorb food within reach only', () => {
  const { state, player } = worldWith();
  const r = radiusOf(player.mass);
  const near = foodAt(state, player.x + r * 0.5, player.y);
  const far = foodAt(state, player.x + r * 3, player.y);
  stepWorld(state);
  expect(state.nutrients.has(near)).toBe(false);
  expect(state.nutrients.has(far)).toBe(true);
  expect(player.mass).toBeGreaterThan(SPAWN_MASS + NUTRIENT_MASS - 0.01);
});

test('feeding works across spatial-grid cell borders', () => {
  const { state, player } = worldWith();
  Object.assign(player, { x: 79.5, y: 79.5 }); // a corner shared by four grid cells (GRID = 80)
  const ids = [[-6, -6], [6, -6], [-6, 6], [6, 6]].map(([dx, dy]) => foodAt(state, player.x + dx!, player.y + dy!));
  stepWorld(state);
  for (const id of ids) expect(state.nutrients.has(id)).toBe(false);
});

test('feeding genes: transporters, siderophores, exoenzymes', () => {
  const { transporters, siderophores, exoenzymes } = GENES;
  expect(yieldOf(NutrientKind.dissolved, transporters.bit)).toBe(NUTRIENT_MASS * TRANSPORTER_YIELD);
  expect(yieldOf(NutrientKind.dissolved, exoenzymes.bit)).toBe(NUTRIENT_MASS);
  expect(yieldOf(NutrientKind.debris, exoenzymes.bit)).toBe(DEBRIS_MASS * EXOENZYME_YIELD);
  expect(yieldOf(NutrientKind.debris, transporters.bit)).toBe(DEBRIS_MASS);
  expect(reachOf(SPAWN_MASS, siderophores.bit)).toBeCloseTo(radiusOf(SPAWN_MASS) * SIDEROPHORE_REACH, 10);

  // End to end: a packet just beyond plain reach is absorbed only with siderophores.
  for (const [genome, eaten] of [[0, false], [siderophores.bit, true]] as const) {
    const { state, player } = worldWith();
    player.genome = genome;
    const id = foodAt(state, player.x + radiusOf(player.mass) * 1.3, player.y);
    stepWorld(state);
    expect(state.nutrients.has(id)).toBe(!eaten);
  }
});

test('mass never exceeds the tier cap', () => {
  const { state, player } = worldWith();
  player.mass = MASS_CAP;
  foodAt(state, player.x, player.y);
  stepWorld(state);
  expect(player.mass).toBeLessThanOrEqual(MASS_CAP);
});

test('metabolism burns mass down to the floor, then starves', () => {
  const p = { mass: SPAWN_MASS, health: HEALTH_MAX, genome: 0 };
  metabolize(p, 1);
  expect(p.mass).toBeLessThan(SPAWN_MASS);
  expect(p.health).toBe(HEALTH_MAX);

  p.mass = MIN_MASS;
  metabolize(p, 1);
  expect(p.mass).toBe(MIN_MASS);
  expect(p.health).toBeLessThan(HEALTH_MAX);

  const starving = p.health;
  p.mass = SPAWN_MASS;
  metabolize(p, 1);
  expect(p.health).toBeGreaterThan(starving);
});

test('every expressed gene costs upkeep', () => {
  const bare = { mass: SPAWN_MASS, health: HEALTH_MAX, genome: 0 };
  const rich = { mass: SPAWN_MASS, health: HEALTH_MAX, genome: GENES.flagellum.bit | GENES.chemoreceptor.bit };
  metabolize(bare, 1);
  metabolize(rich, 1);
  expect(bare.mass - rich.mass).toBeCloseTo(GENES.flagellum.upkeep + GENES.chemoreceptor.upkeep, 10);
});

test('a dead cell bursts into debris and is replaced by a fresh individual', () => {
  const { state, player } = worldWith();
  // Force death at a large mass (combat kills will, P3c) to check the debris share.
  Object.assign(player, { x: 0, y: 0, mass: 40, health: -1 });
  expect(stepWorld(state)).toEqual(['p']);
  const debris = [...state.nutrients.values()].filter((n) => n.kind === NutrientKind.debris);
  expect(debris.length).toBe(Math.floor((player.mass * DEBRIS_SHARE) / DEBRIS_MASS)); // mass at death
  for (const n of debris) expect(Math.hypot(n.x0, n.y0)).toBeLessThanOrEqual(radiusOf(40) + 1e-3);
  const reborn = state.players.get('p')!;
  expect(reborn).not.toBe(player);
  expect(reborn.mass).toBe(SPAWN_MASS);
  expect(reborn.health).toBe(HEALTH_MAX);
});

test('food spawns float32-exact so wire and server agree', () => {
  const state = new PoolState();
  spawnNutrient(state, 0.1, 1234.5678, NutrientKind.dissolved);
  const n = [...state.nutrients.values()][0]!;
  expect(n.x0).toBe(Math.fround(0.1));
  expect(n.x).toBe(n.x0);
});
