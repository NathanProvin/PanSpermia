import { schema, t, type SchemaType } from '@colyseus/schema';

export const Player = schema({
  x: t.number(),
  y: t.number(),
  mass: t.number(),
  health: t.number(),
}, 'Player');
export type Player = SchemaType<typeof Player>;

export const Nutrient = schema({
  x: t.number(),
  y: t.number(),
}, 'Nutrient');
export type Nutrient = SchemaType<typeof Nutrient>;

export const PoolState = schema({
  players: t.map(Player),
  nutrients: t.map(Nutrient),
}, 'PoolState');
export type PoolState = SchemaType<typeof PoolState>;

/** One client input per fixed step: desired heading, magnitude = throttle (clamped to 1 by `move`). */
export const Input = schema({
  dirX: t.float32(),
  dirY: t.float32(),
}, 'Input');
export type Input = SchemaType<typeof Input>;
