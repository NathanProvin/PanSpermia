import {
  DEBRIS_MASS, DEBRIS_SHARE, EXOENZYME_YIELD, GENES, HEALTH_MAX, MASS_CAP, MIN_MASS, NUTRIENT_LIFETIME, NUTRIENT_MASS,
  NutrientKind, PHAGE_BURST, PHAGE_DPS, PHAGE_LATENT, PoolState, REGEN_DELAY, T6SS_DPS, TOXINS, healthMaxOf, SEEP_COUNT, SIDEROPHORE_REACH, SPAWN_MASS, TICK_RATE, TRANSPORTER_YIELD, WORLD_RADIUS, drift,
  radiusOf,
} from '@panspermia/shared';
import { expect, test, vi } from 'vitest';
import {
  PHAGE_KILLER, initPool, metabolize, reachOf, secrete, spawnNutrient, spawnPlayer, stepWorld, yieldOf,
} from './world.ts';

const worldWith = (player = spawnPlayer()) => {
  const state = new PoolState();
  state.players.set('p', player);
  return { state, player };
};
/** Place a packet at (x, y) that the next stepWorld will drift by at most ~3.5 units. */
const foodAt = (state: PoolState, x: number, y: number, kind: number = NutrientKind.dissolved, gene = 0) => {
  spawnNutrient(state, x, y, kind, gene);
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
  expect(stepWorld(state)).toEqual([{ id: 'p', by: '' }]);
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

// --- Combat ---------------------------------------------------------------------------------------

/** Two cells 30 units apart in calm conditions (pili only, so drift barely moves them). */
const duel = (attackerGenes: number, targetGenes = GENES.pili.bit) => {
  const state = new PoolState();
  const attacker = spawnPlayer();
  const target = spawnPlayer();
  Object.assign(attacker, { x: 0, y: 0, mass: 30, genome: attackerGenes | GENES.pili.bit });
  Object.assign(target, { x: 30, y: 0, mass: 30, genome: targetGenes });
  state.players.set('a', attacker);
  state.players.set('t', target);
  return { state, attacker, target };
};
const run = (state: PoolState, seconds: number) => {
  const deaths = [];
  for (let i = 0; i < seconds * TICK_RATE; i++) deaths.push(...stepWorld(state));
  return deaths;
};

test('secreting needs the gene, costs mass, respects the cooldown', () => {
  const { state, attacker } = duel(0);
  secrete(state, 'a');
  expect(state.clouds.size).toBe(0);

  attacker.genome |= GENES.bacteriocin.bit;
  const before = attacker.mass;
  secrete(state, 'a');
  expect(state.clouds.size).toBe(1);
  expect(attacker.mass).toBeCloseTo(before - TOXINS[0].cost, 10);
  secrete(state, 'a'); // on cooldown
  expect(state.clouds.size).toBe(1);
  run(state, TOXINS[0].cooldown + 0.1);
  secrete(state, 'a');
  expect(state.clouds.size).toBe(2); // off cooldown; the first cloud (4 s life) still lingers
});

test('toxin clouds hurt others, never their producer, and dissolve', () => {
  const { state, attacker, target } = duel(GENES.bacteriocin.bit);
  secrete(state, 'a');
  run(state, 1);
  expect(attacker.health).toBe(healthMaxOf(attacker.genome));
  expect(target.health).toBeLessThan(healthMaxOf(target.genome));
  run(state, TOXINS[0].life);
  expect(state.clouds.size).toBe(0);
});

test('capsule and efflux pumps blunt bacteriocin', () => {
  const damageTo = (targetGenes: number) => {
    const { state, target } = duel(GENES.bacteriocin.bit, targetGenes);
    secrete(state, 'a');
    run(state, 1);
    return healthMaxOf(target.genome) - target.health;
  };
  const bare = damageTo(GENES.pili.bit);
  expect(damageTo(GENES.pili.bit | GENES.capsule.bit)).toBeCloseTo(bare * 0.6, 6);
  expect(damageTo(GENES.pili.bit | GENES.effluxPump.bit)).toBeCloseTo(bare * 0.3, 6);
});

test('T6SS contact damage, thick wall resistance', () => {
  for (const [genes, factor] of [[GENES.pili.bit, 1], [GENES.pili.bit | GENES.thickWall.bit, 0.5]] as const) {
    const { state, target } = duel(GENES.t6ss.bit, genes);
    target.x = 20; // radii ≈ 21.9 each: overlapping
    target.health = healthMaxOf(genes);
    stepWorld(state);
    expect(healthMaxOf(genes) - target.health).toBeCloseTo(T6SS_DPS * factor / TICK_RATE, 6);
  }
  const { state, target } = duel(GENES.t6ss.bit);
  target.x = 200; // apart
  stepWorld(state);
  expect(target.health).toBe(healthMaxOf(target.genome));
});

test('endospores take no damage and do not stab', () => {
  const { state, attacker, target } = duel(GENES.t6ss.bit);
  target.x = 20;
  target.spore = 5;
  stepWorld(state);
  expect(target.health).toBe(healthMaxOf(target.genome));
  target.spore = 0;
  attacker.spore = 5;
  stepWorld(state);
  expect(target.health).toBe(healthMaxOf(target.genome));
});

test('health regenerates only after the regen delay', () => {
  const { state, target } = duel(GENES.t6ss.bit);
  target.x = 20;
  run(state, 1);
  target.x = 300; // escape
  const wounded = target.health;
  run(state, REGEN_DELAY - 0.5);
  expect(target.health).toBeCloseTo(wounded, 6);
  run(state, 1.5);
  expect(target.health).toBeGreaterThan(wounded);
});

test('kills are attributed to the attacker and burst into debris', () => {
  const { state, target } = duel(GENES.t6ss.bit);
  target.x = 20;
  target.health = 0.5;
  const deaths = run(state, 0.2);
  expect(deaths).toEqual([{ id: 't', by: 'a' }]);
  expect([...state.nutrients.values()].some((n) => n.kind === NutrientKind.debris)).toBe(true);
});

// --- Gene transfer --------------------------------------------------------------------------------

const ofKind = (state: PoolState, kind: number) => [...state.nutrients.values()].filter((n) => n.kind === kind);

test('dead cells spill one DNA fragment per expressed gene', () => {
  const { state, player } = worldWith();
  Object.assign(player, { x: 0, y: 0, genome: GENES.flagellum.bit | GENES.t6ss.bit, health: -1 });
  stepWorld(state);
  expect(ofKind(state, NutrientKind.fragment).map((n) => n.gene).sort()).toEqual([GENES.flagellum.bit, GENES.t6ss.bit]);
  expect(ofKind(state, NutrientKind.phage)).toEqual([]); // not infected
});

test('DNA is not food; plasmids always add their gene, fragments sometimes do', () => {
  expect(yieldOf(NutrientKind.fragment, 0)).toBe(0);
  expect(yieldOf(NutrientKind.plasmid, 0)).toBe(0);

  const { state, player } = worldWith();
  player.genome = 0;
  foodAt(state, player.x, player.y, NutrientKind.plasmid, GENES.capsule.bit);
  stepWorld(state);
  expect(player.genome).toBe(GENES.capsule.bit);

  // 40 fragments at TRANSFORM_CHANCE 0.5: missing the gene every time is a 1e-12 fluke.
  for (let i = 0; i < 40 && !(player.genome & GENES.flagellum.bit); i++) {
    foodAt(state, player.x, player.y, NutrientKind.fragment, GENES.flagellum.bit);
    stepWorld(state);
  }
  expect(player.genome).toBe(GENES.capsule.bit | GENES.flagellum.bit);
});

// --- Phages ---------------------------------------------------------------------------------------

test('a phage infects on contact, lyses from inside and bursts out of the dead', () => {
  const { state, player } = worldWith();
  Object.assign(player, { x: 0, y: 0, genome: GENES.pili.bit });
  const phage = foodAt(state, radiusOf(player.mass) * 1.5, 0, NutrientKind.phage);
  stepWorld(state);
  expect(state.nutrients.has(phage)).toBe(true); // binds the body, not the absorption reach
  expect(player.infection).toBe(0);

  foodAt(state, 0, 0, NutrientKind.phage);
  stepWorld(state);
  expect(player.infection).toBeGreaterThan(PHAGE_LATENT - 0.1);
  const health = player.health;
  stepWorld(state);
  expect(health - player.health).toBeCloseTo(PHAGE_DPS / TICK_RATE, 6);

  player.health = 0.1;
  expect(stepWorld(state)).toEqual([{ id: 'p', by: PHAGE_KILLER }]);
  expect(ofKind(state, NutrientKind.phage).length).toBeGreaterThanOrEqual(PHAGE_BURST); // + the one that missed
});

test('an infection runs its course, then the cell heals', () => {
  const { state, player } = worldWith();
  player.infection = PHAGE_LATENT;
  for (let i = 0; i < PHAGE_LATENT * TICK_RATE; i++) stepWorld(state);
  expect(player.infection).toBe(0);
  expect(player.health).toBeCloseTo(HEALTH_MAX - PHAGE_DPS * PHAGE_LATENT, 0);
});

test('endospores and capsules resist phages', () => {
  const dormant = worldWith();
  dormant.player.spore = 5;
  const missed = foodAt(dormant.state, dormant.player.x, dormant.player.y, NutrientKind.phage);
  stepWorld(dormant.state);
  expect(dormant.state.nutrients.has(missed)).toBe(true);
  expect(dormant.player.infection).toBe(0);

  // Math.random() = 0: the capsule always blocks. Background spawns land at the origin, far away.
  const random = vi.spyOn(Math, 'random').mockReturnValue(0);
  try {
    for (const [genome, infected] of [[GENES.capsule.bit, false], [0, true]] as const) {
      const { state, player } = worldWith();
      Object.assign(player, { x: 600, y: 0, genome });
      foodAt(state, player.x, player.y, NutrientKind.phage);
      stepWorld(state);
      expect(player.infection > 0).toBe(infected);
    }
  } finally {
    random.mockRestore();
  }
});
