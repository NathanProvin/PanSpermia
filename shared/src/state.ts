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
  /** Seconds left dormant as an endospore (0 = active), and until it can sporulate again. */
  spore: t.number().default(0),
  sporeCooldown: t.number().default(0),
  /** Seconds until toxins can be secreted again. */
  toxinCooldown: t.number().default(0),
  /** Seconds left in the division cyst (0 = active). */
  cyst: t.number().default(0),
  /** Seconds of phage lysis left (0 = healthy). */
  infection: t.number().default(0),
  // Server-side kill attribution and regen gating, never sent.
  lastHitBy: t.string().noSync().default(''),
  lastHitTick: t.uint32().noSync().default(0),
  /** Spawn protection lasts until this tick (server-side). */
  graceUntil: t.uint32().noSync().default(0),
}, 'Player');
export type Player = SchemaType<typeof Player>;

/** Everything that drifts passively: food, DNA (fragments, plasmids) and phages. */
export const NutrientKind = { dissolved: 0, debris: 1, fragment: 2, plasmid: 3, phage: 4 } as const;

/**
 * A packet drifting on the current. Only its spawn point and tick are synced: clients rebuild
 * the path with `drift`. Spawn coordinates are float32 on the wire, so the server stores them
 * pre-rounded (Math.fround) and both sides start from identical numbers.
 */
export const Nutrient = schema({
  x0: t.float32(),
  y0: t.float32(),
  tick0: t.uint32(),
  kind: t.uint8(),
  // Server-side: the GENES bit a fragment or plasmid carries, and the current position. Never sent.
  gene: t.uint32().noSync().default(0),
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

/** A drifting toxin cloud; synced like food (spawn only), its owner is immune. */
export const Cloud = schema({
  x0: t.float32(),
  y0: t.float32(),
  tick0: t.uint32(),
  kind: t.uint8(),
  owner: t.string(),
  /** Damage multiplier from the owner's toxin copies (server-side). */
  power: t.number().noSync().default(1),
  x: t.number().noSync(),
  y: t.number().noSync(),
  tick: t.uint32().noSync(),
}, 'Cloud');
export type Cloud = SchemaType<typeof Cloud>;

/** One placed part of a species design: which gene, where on the body (cell radii), how it sits. */
export const Part = schema({
  gene: t.uint8(), // index into GENE_NAMES
  x: t.float32(),
  y: t.float32(),
  angle: t.float32(),
  scale: t.float32(),
}, 'Part');
export type Part = SchemaType<typeof Part>;

/** A human player's species across individuals: design, unlocked parts, DNA, reserve lives. */
export const Lineage = schema({
  /** Copy counts of the current design (what each new individual expresses). */
  genome: t.uint32(),
  parts: t.array(Part),
  hue: t.float32(),
  /** Genes the editor may place (one-copy bits): starters plus gene-transfer finds. */
  library: t.uint32(),
  dna: t.number(),
  lifetimeDna: t.number(),
  children: t.uint8(),
  generation: t.uint16().default(1),
  /** No individual left: the species is extinct (game over until a new species). */
  extinct: t.boolean().default(false),
}, 'Lineage');
export type Lineage = SchemaType<typeof Lineage>;

export const PoolState = schema({
  /** Simulation clock in fixed ticks (time = tick · TICK_DT); integer, so exact on every side forever. */
  tick: t.uint32().default(0),
  players: t.map(Player),
  nutrients: t.map(Nutrient),
  seeps: t.array(Seep),
  clouds: t.map(Cloud),
  /** Keyed by session id; bots have none. */
  lineages: t.map(Lineage),
}, 'PoolState');
export type PoolState = SchemaType<typeof PoolState>;

/** One client input per fixed step: desired heading (magnitude = throttle, see clampSteer) and action bits. */
export const Input = schema({
  dirX: t.float32(),
  dirY: t.float32(),
  actions: t.uint8(),
}, 'Input');
export type Input = SchemaType<typeof Input>;
