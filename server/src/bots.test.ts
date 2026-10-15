import { ACTION_TOXIN, BOT_SPECIES, GENES, MASS_CAP, PoolState, SPAWN_MASS, genomeOf } from '@panspermia/shared';
import { expect, test } from 'vitest';
import { type Bots, divideBots, fillBots, rebirth, stepBots } from './bots.ts';
import { spawnNutrient, spawnPlayer, stepWorld } from './world.ts';

const species = (name: string) => BOT_SPECIES.findIndex((s) => s.name === name);

/** One bot of `name` at the origin, thinking on the next stepBots. */
const withBot = (name: string, mass = 30) => {
  const state = new PoolState();
  const bots: Bots = new Map();
  fillBots(state, bots, 1);
  const [id, brain] = [...bots][0]!;
  brain.species = species(name);
  brain.phase = 0;
  const bot = state.players.get(id)!;
  Object.assign(bot, { x: 0, y: 0, mass, genome: genomeOf(BOT_SPECIES[brain.species]!.genes) });
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
  fillBots(state, bots, 30);
  expect(new Set([...bots.values()].map((b) => b.species)).size).toBe(BOT_SPECIES.length);
  for (const [id, b] of bots) expect(state.players.get(id)!.genome).toBe(genomeOf(BOT_SPECIES[b.species]!.genes));
  fillBots(state, bots, 3);
  expect(bots.size).toBe(3);
  expect(state.players.size).toBe(3);
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
  expect(reborn.genome).toBe(genomeOf(BOT_SPECIES[brain.species]!.genes));
  expect(reborn.name).toBe('Murus armatus');
  expect(bots.get(id)!.species).toBe(species('Murus armatus'));
});

test('every species design is legal: copies within each part\'s limit', () => {
  for (const s of BOT_SPECIES) {
    for (const g of new Set(s.genes)) expect(s.genes.filter((x) => x === g).length).toBeLessThanOrEqual(GENES[g].maxCopies);
  }
});

test('bots at the size cap divide into a fresh child of the same design, where they were', () => {
  const { state, bots, id, bot, brain } = withBot('Vibrio celer', MASS_CAP);
  bot.x = 123;
  expect(divideBots(state, bots)).toEqual([id]);
  const child = state.players.get(id)!;
  expect(child).not.toBe(bot);
  expect([child.x, child.mass, child.genome]).toEqual([123, SPAWN_MASS, genomeOf(BOT_SPECIES[brain.species]!.genes)]);
  expect(divideBots(state, bots)).toEqual([]);
});
