import { ACTION_TOXIN, BOT_SPECIES, GENES, MASS_CAP, PoolState, SPAWN_MASS, catalogFor, ownGenome } from '@panspermia/shared';

const genomeOf = (s: (typeof BOT_SPECIES)[number]) => catalogFor(s.tier).genomeOf(s.genes);
import { expect, test } from 'vitest';
import { type Bots, addBot, divideBots, fillBots, rebirth, stepBots } from './bots.ts';
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
  fillBots(state, bots, 40); // more than one full spawn cycle
  expect(new Set([...bots.values()].map((b) => b.species)).size).toBe(BOT_SPECIES.length);
  for (const [id, b] of bots) {
    const p = state.players.get(id)!;
    expect(p.tier).toBe(BOT_SPECIES[b.species]!.tier);
    expect(ownGenome(p)).toBe(genomeOf(BOT_SPECIES[b.species]!));
  }
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
  expect(reborn.genome).toBe(genomeOf(BOT_SPECIES[brain.species]!));
  expect(reborn.name).toBe('Murus armatus');
  expect(bots.get(id)!.species).toBe(species('Murus armatus'));
});

test('every species design is legal: copies within each part\'s limit', () => {
  for (const s of BOT_SPECIES) {
    const cat = catalogFor(s.tier);
    for (const g of new Set(s.genes)) expect(s.genes.filter((x) => x === g).length).toBeLessThanOrEqual(cat.GENES[g]!.maxCopies);
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
