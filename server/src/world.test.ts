import {
  DEBRIS_MASS, DEBRIS_SHARE, EXOENZYME_YIELD, GENES, HEALTH_MAX, MASS_CAP, MIN_MASS, NUTRIENT_LIFETIME, NUTRIENT_MASS,
  ALGAE_MASS, CHUNK_MASS, ENGULF_SHARE, STARTER_GENOME2, STARTER_LIBRARY2, T2_MASS_CAP, T2_SPAWN_MASS, TIER2,
  EVOLVE_DNA, EVOLVE_DNA_T2, STARTER_GENOME3, STARTER_LIBRARY3, T3_SPAWN_MASS, TIER3, MANDIBLE_DPS, CARAPACE_ARMOUR, cleanName, randomSpeciesName, CHILD_PRICE, CYST_TIME, DNA_PER_MASS, KILL_DNA_SHARE, MAX_CHILDREN, PACKET_DNA, STARTER_CHILDREN, STARTER_GENOME,
  STARTER_LIBRARY, copiesOf, defaultParts, stack, NutrientKind, type Player, PHAGE_BURST, SPAWN_GRACE, PHAGE_DPS, PHAGE_LATENT, PoolState, REGEN_DELAY, T6SS_DPS, TOXINS, healthMaxOf, SEEP_COUNT, SIDEROPHORE_REACH, SPAWN_MASS, TICK_RATE, TRANSPORTER_YIELD, WORLD_RADIUS, drift,
  radiusOf,
} from '@panspermia/shared';
import { expect, test, vi } from 'vitest';
import {
  PHAGE_KILLER, foundSpecies, hatch, initPool, submitDesign, metabolize, reachOf, secrete, spawnNutrient, spawnPlayer, stepWorld, yieldOf,
} from './world.ts';

/** A human species 'p' with its first individual, unshielded so tests can hurt it. */
const species = () => {
  const state = new PoolState();
  foundSpecies(state, 'p');
  const player = state.players.get('p')!;
  player.graceUntil = 0;
  return { state, player, lineage: state.lineages.get('p')! };
};
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
  // Check on the tick of the death: later ticks, the attacker may eat debris that spilled within its reach.
  let deaths: ReturnType<typeof stepWorld> = [];
  for (let i = 0; i < 4 && !deaths.length; i++) deaths = stepWorld(state);
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
  // Not infected: no phages burst here (wild ones may spawn elsewhere in the pool).
  expect(ofKind(state, NutrientKind.phage).filter((n) => Math.hypot(n.x0, n.y0) < 50)).toEqual([]);
});

test('DNA is not food; plasmids always unlock their part, fragments sometimes do; both pay DNA', () => {
  expect(yieldOf(NutrientKind.fragment, 0)).toBe(0);
  expect(yieldOf(NutrientKind.plasmid, 0)).toBe(0);

  const { state, player, lineage } = species();
  foodAt(state, player.x, player.y, NutrientKind.plasmid, GENES.capsule.bit);
  stepWorld(state);
  expect(lineage.library & GENES.capsule.bit).toBeTruthy();
  expect(player.genome).toBe(STARTER_GENOME); // unlocked for the editor, not expressed
  expect(lineage.dna).toBe(PACKET_DNA);

  // 40 fragments at TRANSFORM_CHANCE 0.5: missing the gene every time is a 1e-12 fluke.
  for (let i = 0; i < 40 && !(lineage.library & GENES.t6ss.bit); i++) {
    foodAt(state, player.x, player.y, NutrientKind.fragment, GENES.t6ss.bit);
    stepWorld(state);
  }
  expect(lineage.library & GENES.t6ss.bit).toBeTruthy();
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

test('new cells are shielded from lysis and phages for the spawn grace', () => {
  const { state, attacker, target } = duel(GENES.t6ss.bit);
  const fresh = spawnPlayer(state.tick);
  Object.assign(fresh, { x: target.x, y: target.y, mass: target.mass, genome: target.genome });
  state.players.set('t', fresh);
  fresh.x = attacker.x + 20;
  foodAt(state, fresh.x, fresh.y, NutrientKind.phage);
  run(state, SPAWN_GRACE - 0.5);
  expect(fresh.health).toBe(healthMaxOf(fresh.genome));
  expect(fresh.infection).toBe(0);
  run(state, 1);
  expect(fresh.health).toBeLessThan(healthMaxOf(fresh.genome));
});

// --- Lineage --------------------------------------------------------------------------------------

test('copies stack with diminishing returns', () => {
  expect([0, 1, 2, 3].map(stack)).toEqual([0, 1, 1.5, 1.75]);
  const two = GENES.transporters.bit * 2; // two copies in the packed genome
  expect(copiesOf(two, 'transporters')).toBe(2);
  expect(yieldOf(NutrientKind.dissolved, two)).toBeCloseTo(NUTRIENT_MASS * (1 + (TRANSPORTER_YIELD - 1) * 1.5), 10);
  const { state, attacker, target } = duel(GENES.t6ss.bit * 2);
  attacker.genome = GENES.t6ss.bit * 2 | GENES.pili.bit;
  target.x = 20;
  stepWorld(state);
  expect(healthMaxOf(target.genome) - target.health).toBeCloseTo((T6SS_DPS * 1.5) / TICK_RATE, 6);
});

test('a new species: starter design, library, reserve; food pays DNA', () => {
  const { state, player, lineage } = species();
  expect([lineage.genome, lineage.library, lineage.children, lineage.generation])
    .toEqual([STARTER_GENOME, STARTER_LIBRARY, STARTER_CHILDREN, 1]);
  expect(lineage.parts.length).toBe(1);
  foodAt(state, player.x, player.y);
  stepWorld(state);
  expect(lineage.dna).toBeCloseTo(NUTRIENT_MASS * DNA_PER_MASS, 10);
  expect(lineage.lifetimeDna).toBe(lineage.dna);
});

test('kills pay the killer DNA; deaths spend a child, then the species goes extinct', () => {
  const { state, player, lineage } = species();
  foundSpecies(state, 'k');
  const killer = state.players.get('k')!;
  Object.assign(killer, { x: player.x + 10, y: player.y, genome: GENES.t6ss.bit, graceUntil: 0 });
  Object.assign(player, { mass: 40, health: 0.1 });
  const deaths = run(state, 0.2);
  expect(deaths).toEqual([{ id: 'p', by: 'k' }]);
  expect(state.lineages.get('k')!.dna).toBeGreaterThan(40 * KILL_DNA_SHARE * 0.99); // the victim burned a little mass first
  expect(lineage.children).toBe(STARTER_CHILDREN - 1);
  expect(state.players.get('p')!.genome).toBe(lineage.genome);

  lineage.children = 0;
  state.players.get('p')!.health = -1;
  expect(stepWorld(state)).toEqual([{ id: 'p', by: '', extinct: true }]);
  expect(state.players.has('p')).toBe(false);
  expect(lineage.extinct).toBe(true);
});

test('reaching the cap starts a shielded division cyst; timing out hatches the old design', () => {
  const { state, player, lineage } = species();
  player.mass = MASS_CAP;
  stepWorld(state);
  expect(player.cyst).toBe(CYST_TIME);
  player.health = 1;
  foodAt(state, player.x, player.y, NutrientKind.phage);
  run(state, CYST_TIME - 1);
  expect(player.health).toBe(1); // dormant: no metabolism, no infection
  expect(player.infection).toBe(0);
  run(state, 1.1);
  const child = state.players.get('p')!;
  expect(child).not.toBe(player);
  expect(child.mass).toBeCloseTo(SPAWN_MASS, 1); // hatched ~0.1 s ago
  expect([child.genome, lineage.generation]).toEqual([STARTER_GENOME, 2]);
});

test('a design submission is validated, priced, refunds removed parts and hatches', () => {
  const { state, player, lineage } = species();
  const part = (gene: string, x = 1) => ({ gene, x, y: 0, angle: 0, scale: 1, group: 0 });
  const design = (parts: unknown[], children = 0, hue = 0.5) => ({ parts, hue, children, name: 'Testus primus' });
  expect(submitDesign(state, 'p', design([]))).toBe('not dividing');
  player.cyst = CYST_TIME;
  lineage.dna = 50;
  expect(submitDesign(state, 'p', null)).toBe('bad design');
  expect(submitDesign(state, 'p', design([part('capsule')]))).toBe('part not unlocked');
  expect(submitDesign(state, 'p', design([part('nope')]))).toBe('unknown part');
  expect(submitDesign(state, 'p', design([part('pili', 9)]))).toBe('bad placement');
  expect(submitDesign(state, 'p', design([{ ...part('pili'), scale: Number.NaN }]))).toBe('bad placement');
  expect(submitDesign(state, 'p', design([{ ...part('pili'), group: 256 }]))).toBe('bad placement');
  expect(submitDesign(state, 'p', design(Array(4).fill(part('pili'))))).toBe('too many copies');
  expect(submitDesign(state, 'p', design([], MAX_CHILDREN))).toBe('bad children');
  expect(submitDesign(state, 'p', design([], 0.5))).toBe('bad children');
  expect(submitDesign(state, 'p', design([], 0, 1))).toBe('bad hue');
  // Two flagella (2 × 20) + one child (30) = 70, minus the refunded pili (8) = 62 > 50.
  const twoFlagella = [part('flagellum'), part('flagellum', -1)];
  expect(submitDesign(state, 'p', design(twoFlagella, 1))).toBe('not enough DNA');
  expect(submitDesign(state, 'p', design(twoFlagella))).toBeUndefined();
  expect(lineage.dna).toBe(50 - (2 * GENES.flagellum.price - GENES.pili.price));
  expect(lineage.genome).toBe(GENES.flagellum.bit * 2);
  expect(lineage.parts.length).toBe(2);
  const child = state.players.get('p')!;
  expect(child).not.toBe(player);
  expect([child.genome, child.cyst, lineage.generation]).toEqual([GENES.flagellum.bit * 2, 0, 2]);

  child.cyst = CYST_TIME;
  lineage.dna = CHILD_PRICE;
  expect(submitDesign(state, 'p', design(twoFlagella, 1))).toBeUndefined();
  expect([lineage.dna, lineage.children]).toEqual([0, STARTER_CHILDREN + 1]);
});

test('default layouts place exactly the genome\'s copies', () => {
  const genome = GENES.flagellum.bit * 3 | GENES.pili.bit | GENES.capsule.bit | GENES.exoenzymes.bit * 2;
  const parts = defaultParts(genome);
  for (const g of Object.keys(GENES) as (keyof typeof GENES)[]) {
    expect(parts.filter((p) => p.gene === g).length).toBe(copiesOf(genome, g));
  }
  for (const p of parts) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(1.5);
});

test('a timed-out cyst hatches with the latest valid draft', () => {
  const { state, player, lineage } = species();
  player.cyst = CYST_TIME;
  lineage.dna = 100;
  const draft = { parts: [{ gene: 'flagellum', x: -1, y: 0, angle: Math.PI, scale: 1, group: 0 }], hue: 0.2, children: 1, name: 'Draftus' };
  expect(submitDesign(state, 'p', draft, false)).toBeUndefined();
  expect(submitDesign(state, 'p', { ...draft, children: 99 }, false)).toBe('bad children'); // keeps the valid one
  expect(state.players.get('p')).toBe(player); // a draft doesn't hatch
  // Step exactly until the hatch: afterwards the child may eat, which would move the DNA asserted below.
  for (let i = 0; i < (CYST_TIME + 1) * TICK_RATE && lineage.generation === 1; i++) stepWorld(state);
  expect([lineage.genome, lineage.hue, lineage.children, lineage.generation])
    .toEqual([GENES.flagellum.bit, 0.2, STARTER_CHILDREN + 1, 2]);
  expect(lineage.dna).toBe(100 - (GENES.flagellum.price - GENES.pili.price) - CHILD_PRICE);
});

// --- Names, kills, evolution ----------------------------------------------------------------------

test('species names: generated, validated, carried by every individual', () => {
  expect(cleanName('  Vibrio   magnus ')).toBe('Vibrio magnus');
  expect(cleanName("Ö'stra-lis")).toBe("Ö'stra-lis");
  for (const bad of ['x', '<script>', 'a'.repeat(29), '1abc', 42, null, 'ab\u0000c']) expect(cleanName(bad)).toBeUndefined();
  for (let i = 0; i < 500; i++) expect(cleanName(randomSpeciesName())).toBeDefined();

  const { state, player, lineage } = species();
  expect(player.name).toBe(lineage.name);
  player.cyst = CYST_TIME;
  const keep = lineage.parts.map((p) => ({ ...p.toJSON(), gene: Object.keys(GENES)[p.gene] }));
  expect(submitDesign(state, 'p', { parts: keep, hue: 0.1, children: 0, name: '<b>' })).toBe('bad name');
  expect(submitDesign(state, 'p', { parts: keep, hue: 0.1, children: 0, name: 'Nova gens' })).toBeUndefined();
  expect([lineage.name, state.players.get('p')!.name]).toEqual(['Nova gens', 'Nova gens']);
});

test('kills are counted for the killer species', () => {
  const { state, player, lineage } = species();
  foundSpecies(state, 'k');
  Object.assign(state.players.get('k')!, { x: player.x + 10, y: player.y, genome: GENES.t6ss.bit, graceUntil: 0 });
  player.health = 0.1;
  run(state, 0.2);
  expect(state.lineages.get('k')!.kills).toBe(1);
  expect(lineage.kills).toBe(0);
});

test('evolving needs the lifetime DNA, then the next generation hatches as a eukaryote, then an animal', () => {
  const { state, player, lineage } = species();
  player.cyst = CYST_TIME;
  const keep = lineage.parts.map((p) => ({ ...p.toJSON(), gene: Object.keys(GENES)[p.gene] }));
  const evolve = { parts: keep, hue: 0.1, children: 0, name: lineage.name, evolve: true };
  lineage.lifetimeDna = EVOLVE_DNA - 1;
  expect(submitDesign(state, 'p', evolve)).toBe('not ready to evolve');
  submitDesign(state, 'p', evolve, false); // a draft never evolves on timeout
  lineage.lifetimeDna = EVOLVE_DNA;
  Object.assign(player, { x: 321, y: -45 });
  expect(submitDesign(state, 'p', evolve)).toBeUndefined();
  const eu = state.players.get('p')!;
  expect([eu.tier, eu.genome, eu.genome2, eu.mass, eu.x]).toEqual([2, 0, STARTER_GENOME2, T2_SPAWN_MASS, 321]);
  expect(healthMaxOf(eu.genome, eu.tier)).toBe(eu.health);
  expect([lineage.tier, lineage.genome, lineage.library]).toEqual([2, STARTER_GENOME2, STARTER_LIBRARY2]);
  eu.cyst = CYST_TIME;
  const parts = lineage.parts.map((p) => ({ ...p.toJSON(), gene: TIER2.NAMES[p.gene] }));
  expect(submitDesign(state, 'p', { ...evolve, parts })).toBe('not ready to evolve'); // a eukaryote needs far more
  expect(submitDesign(state, 'p', { ...evolve, parts: keep, evolve: false })).toBe('unknown part'); // tier-1 'pili' isn't a eukaryote part
  expect(submitDesign(state, 'p', { ...evolve, parts, evolve: false })).toBeUndefined(); // tier-2 parts validate
  expect(state.players.get('p')!.tier).toBe(2);
  state.players.get('p')!.cyst = CYST_TIME;
  lineage.lifetimeDna = EVOLVE_DNA_T2;
  expect(submitDesign(state, 'p', { ...evolve, parts })).toBeUndefined();
  const animal = state.players.get('p')!;
  expect([animal.tier, animal.genome2, animal.genome3, animal.mass]).toEqual([3, 0, STARTER_GENOME3, T3_SPAWN_MASS]);
  expect([lineage.tier, lineage.genome, lineage.library]).toEqual([3, STARTER_GENOME3, STARTER_LIBRARY3]);
  animal.cyst = CYST_TIME;
  const parts3 = lineage.parts.map((q) => ({ ...q.toJSON(), gene: TIER3.NAMES[q.gene] }));
  expect(submitDesign(state, 'p', { ...evolve, parts: parts3 })).toBe('cannot evolve further yet');
});

test('animals: filter combs sweep up bacteria, mandibles swallow eukaryotes and bite rivals in front', () => {
  const state = new PoolState();
  const animal = (genes: (typeof TIER3.NAMES)[number][], x: number, heading = 0) => {
    const a = spawnPlayer();
    Object.assign(a, { tier: 3, genome: 0, genome3: TIER3.genomeOf(genes), mass: 2000, health: 1200, x, y: 0, heading });
    return a;
  };
  const filterer = animal(['filterComb'], 0);
  state.players.set('f', filterer);
  const bug = spawnPlayer();
  const eu = spawnPlayer();
  Object.assign(bug, { x: 10, y: 0, graceUntil: 0 });
  Object.assign(eu, { tier: 2, genome: 0, genome2: 0, mass: 300, health: 300, x: -10, y: 0, graceUntil: 0 });
  state.players.set('b', bug);
  state.players.set('e', eu);
  stepWorld(state);
  expect([bug.engulfedBy, eu.engulfedBy]).toEqual(['f', '']); // combs take bacteria, not eukaryotes
  filterer.genome3 = TIER3.genomeOf(['mandible']);
  stepWorld(state);
  expect(eu.engulfedBy).toBe('f');
  // Two mandibled animals face to face bite each other; a carapace turns part of the bite.
  const s2 = new PoolState();
  const a = animal(['mandible'], 0, 0);
  const b = animal(['mandible', 'carapace'], 2 * radiusOf(2000), Math.PI);
  s2.players.set('a', a);
  s2.players.set('b', b);
  stepWorld(s2);
  expect(1200 - b.health).toBeCloseTo(MANDIBLE_DPS * CARAPACE_ARMOUR / TICK_RATE, 1);
  expect(1200 - a.health).toBeCloseTo(MANDIBLE_DPS / TICK_RATE, 1);
  expect([a.engulfedBy, b.engulfedBy]).toEqual(['', '']); // rivals of a size are bitten, not swallowed
});

// --- Tier 2: eukaryotes ---------------------------------------------------------------------------

/** A tier-2 eukaryote 'e' (unshielded) with the given parts, in an otherwise empty pool. */
const eukaryote = (genome2 = STARTER_GENOME2, mass = 300) => {
  const state = new PoolState();
  const e = spawnPlayer();
  Object.assign(e, { tier: 2, genome: 0, genome2, mass, health: 300, x: 0, y: 0 });
  state.players.set('e', e);
  return { state, e };
};

test('mouths set the diet: filter takes plant food, jaw takes meat, bacteria leave algae alone', () => {
  const filter = TIER2.GENES.filter.bit;
  const jaw = TIER2.GENES.jaw.bit;
  for (const [genome2, kind, eaten] of [
    [filter, NutrientKind.algae, true], [filter, NutrientKind.dissolved, true], [filter, NutrientKind.chunk, false],
    [jaw, NutrientKind.chunk, true], [jaw, NutrientKind.debris, true], [jaw, NutrientKind.algae, false],
    [jaw, NutrientKind.phage, false], [jaw | filter, NutrientKind.plasmid, false],
  ] as const) {
    const { state, e } = eukaryote(genome2);
    const id = foodAt(state, 5, 5, kind);
    stepWorld(state);
    expect(state.nutrients.has(id)).toBe(!eaten);
    expect(e.infection).toBe(0); // phages are bacteria-only viruses
  }
  const { state, e } = eukaryote(filter);
  const before = e.mass;
  foodAt(state, 0, 0, NutrientKind.algae);
  stepWorld(state);
  expect(e.mass).toBeGreaterThan(before + ALGAE_MASS - 1);

  const { state: s2, player } = worldWith();
  const algae = foodAt(s2, player.x, player.y, NutrientKind.algae);
  stepWorld(s2);
  expect(s2.nutrients.has(algae)).toBe(true);
});

test('a jaw engulfs smaller cells whole; spores, newborns and big cells escape', () => {
  const { state, e } = eukaryote(TIER2.GENES.jaw.bit);
  const prey = (id: string, over: Partial<Player>) => {
    const b = spawnPlayer();
    Object.assign(b, { x: 10, y: 0, mass: 30, ...over });
    state.players.set(id, b);
    return b;
  };
  const snack = prey('snack', {});
  prey('spore', { spore: 5 });
  prey('newborn', { graceUntil: 10_000 });
  prey('far', { x: 200 });
  const big = spawnPlayer();
  Object.assign(big, { tier: 2, genome: 0, genome2: 0, mass: 200, health: 300, x: -10, y: 0 }); // > half the eater
  state.players.set('big', big);
  const before = e.mass;
  const deaths = stepWorld(state);
  expect(deaths).toEqual([{ id: 'snack', by: 'e' }]);
  expect(e.mass).toBeCloseTo(before + snack.mass * ENGULF_SHARE, 0);
  expect(ofKind(state, NutrientKind.debris).filter((n) => Math.hypot(n.x0 - 10, n.y0) < 30)).toEqual([]); // swallowed whole
  for (const id of ['spore', 'newborn', 'far', 'big']) expect(state.players.get(id)!.health).toBeGreaterThan(0);
});

test('a dead eukaryote falls apart into meat chunks; tier-2 cells divide at the tier-2 cap', () => {
  const { state, e } = eukaryote(STARTER_GENOME2, 401); // metabolism trims a little before death
  e.health = -1;
  stepWorld(state);
  const chunks = ofKind(state, NutrientKind.chunk);
  expect(chunks.filter((n) => !n.gene).length).toBe(Math.floor((400 * 0.5) / CHUNK_MASS));
  expect(chunks.filter((n) => n.gene).length).toBe(3); // one per part it wore: cilia, filter, jaw
  expect(ofKind(state, NutrientKind.debris).filter((n) => Math.hypot(n.x0, n.y0) < 80)).toEqual([]);

  const { state: s2, player, lineage } = species();
  lineage.tier = 2;
  Object.assign(player, { tier: 2, genome: 0, genome2: STARTER_GENOME2, mass: T2_MASS_CAP, health: 300 });
  stepWorld(s2);
  expect(player.cyst).toBe(CYST_TIME);
});

// --- Tier 2: weapons and part discovery (P8c) ---------------------------------------------------

/** Two eukaryotes facing each other along x: 'e' at the origin heading +x, 'v' in front of it. */
const face = (genome2: number, gap = 0) => {
  const { state, e } = eukaryote(genome2 | TIER2.GENES.cilia.bit);
  e.heading = 0;
  const v = spawnPlayer();
  Object.assign(v, { tier: 2, genome: 0, genome2: TIER2.GENES.cilia.bit, mass: 300, health: 300, x: 2 * radiusOf(300) + gap, y: 0 });
  state.players.set('v', v);
  return { state, e, v };
};

test('spikes stab only where they point', () => {
  const spike = TIER2.GENES.spike.bit; // default spot: the front (angle 0.3)
  const ahead = face(spike);
  stepWorld(ahead.state);
  expect(ahead.v.health).toBeLessThan(300);
  expect(ahead.e.health).toBe(300); // the victim has no weapon
  const behind = face(spike);
  behind.e.heading = Math.PI; // spike now points away from v
  stepWorld(behind.state);
  expect(behind.v.health).toBe(300);
});

test('the electric organ shocks anything close, bacteria included', () => {
  const { state, e, v } = face(TIER2.GENES.electric.bit, radiusOf(300) * 0.2);
  e.heading = Math.PI; // direction doesn't matter
  const bug = spawnPlayer();
  Object.assign(bug, { x: 0, y: radiusOf(300) * 1.1, mass: 70 }); // too big to engulf, inside the field
  state.players.set('bug', bug);
  stepWorld(state);
  expect(v.health).toBeLessThan(300);
  expect(bug.health).toBeLessThan(100);
});

test('poison is left behind a eukaryote, and its maker is immune', () => {
  const { state, e } = eukaryote(TIER2.GENES.poison.bit);
  e.heading = 0;
  secrete(state, 'e');
  const cloud = [...state.clouds.values()][0]!;
  expect(TOXINS[cloud.kind]!.gene).toBe('poison');
  expect(cloud.x0).toBeLessThan(-radiusOf(e.mass)); // behind
  run(state, 1);
  expect(e.health).toBe(300);
  // A bacterium can't secrete tier-2 poison, a eukaryote can't secrete bacteriocin.
  const { state: s2, player } = worldWith();
  player.genome = TIER2.GENES.poison.bit; // the same bits mean another tier-1 gene: not poison
  secrete(s2, 'p');
  expect([...s2.clouds.values()].every((c) => TOXINS[c.kind]!.tier === 1)).toBe(true);
});

test('meteor shards unlock tier-2 parts on touch; eaten chunks may carry the dead cell\'s parts', () => {
  const { state, player, lineage } = species();
  lineage.tier = 2;
  lineage.library = STARTER_LIBRARY2;
  Object.assign(player, { tier: 2, genome: 0, genome2: STARTER_GENOME2, mass: 300, health: 300 });
  foodAt(state, player.x, player.y, NutrientKind.shard, TIER2.GENES.spike.bit);
  stepWorld(state);
  expect(lineage.library & TIER2.GENES.spike.bit).toBeTruthy();
  for (let i = 0; i < 40 && !(lineage.library & TIER2.GENES.poison.bit); i++) {
    foodAt(state, player.x, player.y, NutrientKind.chunk, TIER2.GENES.poison.bit);
    stepWorld(state);
  }
  expect(lineage.library & TIER2.GENES.poison.bit).toBeTruthy();

  // Bacteria eat such a chunk as food, but a tier-2 part never lands in a tier-1 library.
  const s2 = species();
  const before = s2.lineage.library;
  foodAt(s2.state, s2.player.x, s2.player.y, NutrientKind.chunk, TIER2.GENES.electric.bit);
  stepWorld(s2.state);
  expect(s2.lineage.library).toBe(before);
});

// --- Photosynthesis, endosymbiosis, shapes (P8d) --------------------------------------------------

test('thylakoids feed a bacterium from light; chloroplasts a eukaryote; mitochondria cut metabolism', () => {
  const dark = { mass: 30, health: 100, genome: 0 };
  const lit = { mass: 30, health: 100, genome: GENES.thylakoid.bit * 2 };
  metabolize(dark, 1);
  metabolize(lit, 1);
  expect(lit.mass - dark.mass).toBeCloseTo(0.08 * 1.5 - 2 * GENES.thylakoid.upkeep, 6);

  const eu = (genome2: number) => ({ mass: 300, health: 300, genome: 0, genome2, tier: 2 });
  const plain = eu(0);
  const green = eu(TIER2.GENES.chloroplast.bit);
  const mito = eu(TIER2.GENES.mitochondrion.bit);
  for (const p of [plain, green, mito]) metabolize(p, 1);
  expect(green.mass - plain.mass).toBeCloseTo(0.35, 6);
  expect(mito.mass).toBeGreaterThan(plain.mass);
});

test('swallowing the right bacteria may adopt them as organelles', () => {
  const { state, player, lineage } = species();
  lineage.tier = 2;
  lineage.library = STARTER_LIBRARY2;
  Object.assign(player, { tier: 2, genome: 0, genome2: STARTER_GENOME2, mass: 600, health: 300, x: 0, y: 0 });
  for (let i = 0; i < 40 && !(lineage.library & TIER2.GENES.chloroplast.bit && lineage.library & TIER2.GENES.mitochondrion.bit); i++) {
    player.mass = 600; // stay below the cap: a dividing cell is dormant and swallows nothing
    for (const [id, genome] of [['cyano', GENES.thylakoid.bit], ['resp', GENES.transporters.bit]] as const) {
      const b = spawnPlayer();
      Object.assign(b, { x: 5, y: 0, mass: 20, genome });
      state.players.set(id + i, b);
    }
    stepWorld(state);
  }
  expect(lineage.library & TIER2.GENES.chloroplast.bit).toBeTruthy();
  expect(lineage.library & TIER2.GENES.mitochondrion.bit).toBeTruthy();
});

test('a design body shape is validated and worn by the next individual', () => {
  const { state, player, lineage } = species();
  player.cyst = CYST_TIME;
  const keep = lineage.parts.map((p) => ({ ...p.toJSON(), gene: Object.keys(GENES)[p.gene] }));
  const design = { parts: keep, hue: 0.1, children: 0, name: lineage.name };
  expect(submitDesign(state, 'p', { ...design, shape: 7 })).toBe('bad shape');
  expect(submitDesign(state, 'p', { ...design, shape: 2 })).toBeUndefined();
  expect([lineage.shape, state.players.get('p')!.shape]).toEqual([2, 2]);
});

// --- Hazards of eukaryotes (P8f) -----------------------------------------------------------------

test('giant viruses infect eukaryotes only, and burst out of the dead', () => {
  const { state, e } = eukaryote();
  foodAt(state, 0, 0, NutrientKind.virus);
  stepWorld(state);
  expect(e.infection).toBeGreaterThan(5);
  e.health = 0.1;
  run(state, 0.5);
  expect(ofKind(state, NutrientKind.virus).length).toBeGreaterThanOrEqual(6);

  const bug = worldWith();
  const v = foodAt(bug.state, bug.player.x, bug.player.y, NutrientKind.virus);
  stepWorld(bug.state);
  expect(bug.state.nutrients.has(v)).toBe(true); // bacteria are immune to eukaryote viruses
  expect(bug.player.infection).toBe(0);
});

test('a bacterium with adhesins drains the eukaryote it clings to', () => {
  const { state, e } = eukaryote(TIER2.GENES.cilia.bit, 400);
  const par = spawnPlayer();
  Object.assign(par, { x: radiusOf(400) + 2, y: 0, mass: 20, genome: GENES.adhesin.bit * 2 });
  state.players.set('par', par);
  const host0 = e.mass;
  const par0 = par.mass;
  run(state, 2);
  expect(host0 - e.mass).toBeGreaterThan(2 * 2 * 1.5 * 0.9); // drained beyond its own metabolism
  expect(par.mass).toBeGreaterThan(par0);
  // Out of reach, nothing happens.
  par.x = 2000;
  const host1 = e.mass;
  run(state, 1);
  expect(host1 - e.mass).toBeLessThan(1);
});
