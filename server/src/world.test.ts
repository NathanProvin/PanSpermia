import {
  HEALTH_MAX, MASS_CAP, MIN_MASS, NUTRIENT_COUNT, NUTRIENT_MASS, Nutrient, PoolState, SPAWN_MASS,
} from '@panspermia/shared';
import { expect, test } from 'vitest';
import { metabolize, spawnPlayer, stepWorld, topUpNutrients } from './world.ts';

const DT = 0.05;
const worldWith = (player = spawnPlayer()) => {
  const state = new PoolState();
  state.players.set('p', player);
  return { state, player };
};

test('top-up keeps the pool at NUTRIENT_COUNT', () => {
  const state = new PoolState();
  topUpNutrients(state);
  expect(state.nutrients.size).toBe(NUTRIENT_COUNT);
});

test('a cell eats nutrients under it, and they regrow elsewhere', () => {
  const { state, player } = worldWith();
  state.nutrients.set('food', new Nutrient({ x: player.x, y: player.y }));
  stepWorld(state, DT);
  expect(state.nutrients.has('food')).toBe(false);
  expect(state.nutrients.size).toBe(NUTRIENT_COUNT);
  expect(player.mass).toBeGreaterThan(SPAWN_MASS + NUTRIENT_MASS - 0.01);
});

test('mass never exceeds the tier cap', () => {
  const { state, player } = worldWith();
  player.mass = MASS_CAP;
  state.nutrients.set('food', new Nutrient({ x: player.x, y: player.y }));
  stepWorld(state, DT);
  expect(player.mass).toBeLessThanOrEqual(MASS_CAP);
});

test('metabolism burns mass down to the floor, then starves', () => {
  const p = { mass: SPAWN_MASS, health: HEALTH_MAX };
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

test('a starved cell dies and is replaced by a fresh individual', () => {
  const { state, player } = worldWith();
  player.mass = MIN_MASS;
  player.health = 0.01;
  expect(stepWorld(state, DT)).toEqual(['p']);
  const reborn = state.players.get('p')!;
  expect(reborn).not.toBe(player);
  expect(reborn.mass).toBe(SPAWN_MASS);
  expect(reborn.health).toBe(HEALTH_MAX);
});
