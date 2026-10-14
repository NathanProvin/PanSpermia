import { schema, t, type SchemaType } from '@colyseus/schema';

export const Player = schema({
  x: t.number(),
  y: t.number(),
}, 'Player');
export type Player = SchemaType<typeof Player>;

export const PoolState = schema({
  players: t.map(Player),
}, 'PoolState');
export type PoolState = SchemaType<typeof PoolState>;
