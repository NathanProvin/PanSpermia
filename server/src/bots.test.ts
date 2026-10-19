import { ACTION_TOXIN, BOT_SPECIES, GENES, MASS_CAP, PoolState, SPAWN_MASS, TICK_RATE, MAX_MOUTHS, MOUTH_PARTS, NutrientKind, TIER3, catalogFor, ownGenome, radiusOf, rimAt } from '@panspermia/shared';

const genomeOf = (s: (typeof BOT_SPECIES)[number]) => catalogFor(s.tier).genomeOf(s.genes);
import { expect, test } from 'vitest';
import { type Bots, addBot, divideBots, fillBots, rebirth, stepBots, stepVisitors } from './bots.ts';
import { spawnNutrient, spawnPlayer, stepWorld } from './world.ts';

const species = (name: string) => BOT_SPECIES.findIndex((s) => s.name === name);

/** One bot of `name` at the origin, thinking on the next stepBots. */
const withBot = (name: string, mass = 30) => {
  const state = new PoolState();
  const bots: Bots = new Map();
  const id = addBot(state, bots, species(name));
  const brain = bots.get(id)!;
  brain.phase = 0;
  const bot = state.players.get(id)!;
  Object.assign(bot, { x: 0, y: 0, mass, graceUntil: 0 });
  return { state, bots, id, brain, bot };
};
const other = (state: PoolState, x: number, mass: number, genome: number) => {
  const p = spawnPlayer();
  Object.assign(p, { x, y: 0, mass, genome });
  state.players.set('h', p);
};

test('bots top up and trim to the target, every species represented', () => {
  const state = new PoolState();
  const bots: Bots = new Map();
  fillBots(state, bots, 60); // more than one full spawn cycle of every tier
  expect(new Set([...bots.values()].map((b) => b.species)).size).toBe(BOT_SPECIES.filter((s) => !s.rare).length); // rare species only visit
  for (const [id, b] of bots) {
    const p = state.players.get(id)!;
    expect(p.tier).toBe(BOT_SPECIES[b.species]!.tier);
    expect(ownGenome(p)).toBe(genomeOf(BOT_SPECIES[b.species]!));
  }
  fillBots(state, bots, 3);
  expect(bots.size).toBe(3);
  expect(state.players.size).toBe(3);
});

test('bots fill a population pyramid, humans counted in their tier', () => {
  const state = new PoolState();
  const bots: Bots = new Map();
  for (const [i, tier] of [1, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4].entries()) state.players.set('human' + i, Object.assign(spawnPlayer(), { tier }));
  fillBots(state, bots, 50);
  const count = (t: number) => [...state.players.values()].filter((p) => p.tier === t).length;
  expect([count(1), count(2), count(3), count(4)]).toEqual([28, 16, 10, 1]); // 10 humans overflow tier 3's quota of 6: none displaced
  fillBots(state, bots, 50); // steady: nothing changes
  expect(bots.size).toBe(28 - 1 + 16 - 2);
});

test('a grazer swims to food', () => {
  const { state, bots, brain } = withBot('Nudus errans');
  spawnNutrient(state, 100, 0, 0);
  stepBots(state, bots);
  expect(brain.dirX).toBeGreaterThan(0.9);
});

test('a grazer flees a bigger armed cell', () => {
  const { state, bots, brain } = withBot('Nudus errans');
  other(state, 80, 60, GENES.t6ss.bit);
  stepBots(state, bots);
  expect(brain.dirX).toBeLessThan(-0.9);
});

test('a hunter chases a smaller cell and fires in range', () => {
  const { state, bots, brain } = withBot('Toxicus lentus');
  other(state, 60, 15, 0);
  stepBots(state, bots);
  expect(brain.dirX).toBeGreaterThan(0.9);
  expect(brain.actions & ACTION_TOXIN).toBeTruthy();
  expect(state.clouds.size).toBe(1);
});

test('dead bots are reborn as their own species', () => {
  const { state, bots, id, brain, bot } = withBot('Murus armatus');
  bot.genome |= GENES.capsule.bit; // picked up during its life
  bot.health = -1;
  rebirth(state, bots, stepWorld(state));
  const reborn = state.players.get(id)!;
  expect(reborn).not.toBe(bot);
  expect(reborn.genome).toBe(genomeOf(BOT_SPECIES[brain.species]!));
  expect(reborn.name).toBe('Murus armatus');
  expect(bots.get(id)!.species).toBe(species('Murus armatus'));
});

test('every species design is legal: copies within each part\'s limit', () => {
  for (const s of BOT_SPECIES) {
    const cat = catalogFor(s.tier);
    for (const g of new Set(s.genes)) expect(s.genes.filter((x) => x === g).length).toBeLessThanOrEqual(cat.GENES[g]!.maxCopies);
    expect(s.genes.filter((g) => MOUTH_PARTS[s.tier]?.includes(g)).length, s.name).toBeLessThanOrEqual(MAX_MOUTHS);
  }
});

test('bots at the size cap divide into a fresh child of the same design, where they were', () => {
  const { state, bots, id, bot, brain } = withBot('Vibrio celer', MASS_CAP);
  bot.x = 123;
  expect(divideBots(state, bots)).toEqual([id]);
  const child = state.players.get(id)!;
  expect(child).not.toBe(bot);
  expect([child.x, child.mass, child.genome]).toEqual([123, SPAWN_MASS, genomeOf(BOT_SPECIES[brain.species]!)]);
  expect(divideBots(state, bots)).toEqual([]);
});

test('eukaryote bots: a hungry hunter goes for what its jaw can swallow; bacteria flee it', () => {
  const { state, bots, brain, bot } = withBot('Amoebina vorax', 300);
  expect([bot.tier, bot.genome]).toEqual([2, 0]);
  other(state, 120, 40, 0); // a bacterium: swallowable
  stepBots(state, bots);
  expect(brain.dirX).toBeGreaterThan(0.9);

  const prey = withBot('Nudus errans', 20);
  const eater = addBot(prey.state, prey.bots, species('Amoebina vorax'));
  Object.assign(prey.state.players.get(eater)!, { x: 150, y: 0, mass: 300 });
  stepBots(prey.state, prey.bots);
  expect(prey.brain.dirX).toBeLessThan(-0.5);
});

test('overlapping a cell a bot does not fear never poisons its steering with NaN', () => {
  const { state, bots, brain, bot } = withBot('Didinia ferox', 300);
  other(state, 10, 30, 0); // overlapping, and neither feared nor prey for a sated hunter
  bot.mass = 900; // not hungry
  stepBots(state, bots);
  expect(Number.isFinite(brain.dirX) && Number.isFinite(brain.dirY)).toBe(true);
  expect(Number.isFinite(bot.x)).toBe(true);
});

test('rare species visit on their own schedule, a polyp fixed to the shore, and leave again', () => {
  const state = new PoolState();
  const bots: Bots = new Map();
  stepVisitors(state, bots); // schedules the first visits
  expect(bots.size).toBe(0);
  state.tick += 10 * 3600 * TICK_RATE; // ten hours on: every rare species is due
  stepVisitors(state, bots);
  const visitors = [...bots.values()];
  expect(visitors.length).toBe(BOT_SPECIES.filter((s) => s.rare).length);
  expect(visitors.every((b) => BOT_SPECIES[b.species]!.rare && b.leaveAt !== undefined)).toBe(true);
  const [polypId, polyp] = [...bots].find(([, b]) => BOT_SPECIES[b.species]!.archetype === 'anchored')!;
  const p = state.players.get(polypId)!;
  expect(Math.hypot(p.x, p.y)).toBeGreaterThan(rimAt(Math.atan2(p.y, p.x)) - radiusOf(p.mass, p.tier) * 1.5); // on the shore
  expect(polyp.anchor).toBeDefined();
  fillBots(state, bots, 2); // visitors don't count toward the standing population
  expect([...bots.values()].filter((b) => b.leaveAt === undefined).length).toBe(2);
  state.tick = Math.max(...visitors.map((b) => b.leaveAt!));
  stepVisitors(state, bots);
  expect([...bots.values()].filter((b) => b.leaveAt !== undefined && b.leaveAt <= state.tick).length).toBe(0);
});

test('a plankton hunter goes for a rival of its tier it can bite, not only for what it can swallow', () => {
  const { state, bots, brain } = withBot('Cyclops furax', 3000);
  const rival = Object.assign(spawnPlayer(), { tier: 3, genome: 0, genome3: TIER3.genomeOf(['filterComb', 'paddle']), mass: 2500, x: 1000, y: 0, graceUntil: 0 });
  state.players.set('rival', rival);
  stepBots(state, bots);
  expect(brain.dirX).toBeGreaterThan(0.9);
});

test('an animal reckons food from its head: what lies under its body beside the head is left (bots spun on the spot)', () => {
  const { state, bots, brain, bot } = withBot('Daphnia errans', 3000);
  bot.heading = 0;
  const r = radiusOf(bot.mass, bot.tier);
  spawnNutrient(state, 0, r * 0.6, NutrientKind.diatom); // closest, but under the body beside its head: out of the mouths' reach
  spawnNutrient(state, r * 1.8, -r * 0.5, NutrientKind.diatom); // ahead (within sight)
  stepBots(state, bots);
  expect(brain.dirX).toBeGreaterThan(0.5);
  expect(brain.dirY).toBeLessThan(0);
});
