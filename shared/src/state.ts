import { schema, t, type SchemaType } from '@colyseus/schema';

export const Player = schema({
  x: t.number(),
  y: t.number(),
  /** Swim direction, radians. Flagellated cells keep it between tumbles. */
  heading: t.number(),
  /** Seconds left in the current tumble (0 = running). */
  tumble: t.number(),
  /** xorshift32 state: tumble randomness that client prediction replays exactly. */
  rng: t.uint32(),
  mass: t.number(),
  health: t.number(),
  /** Bitmask of GENES. */
  genome: t.uint32(),
}, 'Player');
export type Player = SchemaType<typeof Player>;

export const NutrientKind = { dissolved: 0, debris: 1 } as const;

/**
 * A food packet drifting on the current. Only its spawn point and tick are synced: clients rebuild
 * the path with `drift`. Spawn coordinates are float32 on the wire, so the server stores them
 * pre-rounded (Math.fround) and both sides start from identical numbers.
 */
export const Nutrient = schema({
  x0: t.float32(),
  y0: t.float32(),
  tick0: t.uint32(),
  kind: t.uint8(),
  // Server-side current position, never sent.
  x: t.number().noSync(),
  y: t.number().noSync(),
  tick: t.uint32().noSync(),
}, 'Nutrient');
export type Nutrient = SchemaType<typeof Nutrient>;

/** Where a plume rises from. */
export const Seep = schema({
  x: t.float32(),
  y: t.float32(),
  untilTick: t.uint32().noSync(),
}, 'Seep');
export type Seep = SchemaType<typeof Seep>;

export const PoolState = schema({
  /** Simulation clock in fixed ticks (time = tick · TICK_DT); integer, so exact on every side forever. */
  tick: t.uint32().default(0),
  players: t.map(Player),
  nutrients: t.map(Nutrient),
  seeps: t.array(Seep),
}, 'PoolState');
export type PoolState = SchemaType<typeof PoolState>;

/** One client input per fixed step: desired heading, magnitude = throttle (see clampSteer). */
export const Input = schema({
  dirX: t.float32(),
  dirY: t.float32(),
}, 'Input');
export type Input = SchemaType<typeof Input>;
