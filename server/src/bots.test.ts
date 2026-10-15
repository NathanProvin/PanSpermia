import { ACTION_TOXIN, BOT_SPECIES, GENES, PoolState, genomeOf } from '@panspermia/shared';
import { expect, test } from 'vitest';
import { type Bots, fillBots, rebirth, stepBots } from './bots.ts';
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

test('bots top up and trim to the target, species spread round-robin', () => {
  const state = new PoolState();
  const bots: Bots = new Map();
  fillBots(state, bots, BOT_SPECIES.length);
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
  expect(bots.get(id)!.species).toBe(species('Murus armatus'));
});
