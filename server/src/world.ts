// Authoritative world rules beyond movement. Pure functions over PoolState, no Room needed,
// so the headless balancing sim (P3f) can drive them directly.
import {
  BACKGROUND_RATE, DEBRIS_MASS, DEBRIS_SHARE, EXOENZYME_YIELD, HEALTH_MAX, HEALTH_REGEN, MASS_CAP, METABOLISM_BASE,
  METABOLISM_RATE, MIN_MASS, NUTRIENT_CAP, NUTRIENT_LIFETIME, NUTRIENT_MASS, Nutrient, NutrientKind, Player,
  type PoolState, SEEP_COUNT, SEEP_LIFETIME, SEEP_RATE, SEEP_SPREAD, SIDEROPHORE_REACH, SPAWN_MASS, STARTER_GENOME,
  STARVE_DPS, Seep, TICK_DT, TICK_RATE, TRANSPORTER_YIELD, WORLD_RADIUS, drift, hasGene, radiusOf, upkeepOf,
} from '@panspermia/shared';

/** Uniform random point in a disc of radius `r` centred on the origin. */
function randomInDisc(r: number) {
  const angle = Math.random() * 2 * Math.PI;
  const d = r * Math.sqrt(Math.random());
  return { x: d * Math.cos(angle), y: d * Math.sin(angle) };
}

export const spawnPlayer = () => new Player({
  ...randomInDisc(WORLD_RADIUS - radiusOf(SPAWN_MASS)),
  heading: Math.random() * 2 * Math.PI,
  tumble: 0,
  rng: (Math.random() * 2 ** 32) >>> 0 || 1,
  mass: SPAWN_MASS,
  health: HEALTH_MAX,
  genome: STARTER_GENOME,
});

let nextNutrientId = 0;
/** Spawn a food packet now. Coordinates are float32-rounded so clients rebuild the exact same path. */
export function spawnNutrient(state: PoolState, x: number, y: number, kind: number) {
  if (state.nutrients.size >= NUTRIENT_CAP) return;
  const x0 = Math.fround(x);
  const y0 = Math.fround(y);
  state.nutrients.set(String(nextNutrientId++), new Nutrient({ x0, y0, tick0: state.tick, kind, x: x0, y: y0, tick: state.tick }));
}

const seepUntil = (tick: number) =>
  tick + Math.round((SEEP_LIFETIME[0] + Math.random() * (SEEP_LIFETIME[1] - SEEP_LIFETIME[0])) * TICK_RATE);

/** Place the seeps and pre-run a full nutrient lifetime so the first visitors find established plumes. */
export function initPool(state: PoolState) {
  for (let i = 0; i < SEEP_COUNT; i++) {
    state.seeps.push(new Seep({ ...randomInDisc(WORLD_RADIUS * 0.85), untilTick: seepUntil(state.tick) }));
  }
  for (let i = 0; i < NUTRIENT_LIFETIME * TICK_RATE; i++) stepWorld(state);
}

/** Burn mass (metabolism + gene upkeep) down to MIN_MASS; starve at the floor, regenerate above it. */
export function metabolize(p: { mass: number; health: number; genome: number }, dt: number) {
  p.mass = Math.max(MIN_MASS, p.mass - (METABOLISM_BASE + METABOLISM_RATE * p.mass + upkeepOf(p.genome)) * dt);
  p.health = p.mass <= MIN_MASS
    ? p.health - STARVE_DPS * dt
    : Math.min(HEALTH_MAX, p.health + HEALTH_REGEN * dt);
}

/** What one packet is worth to this genome. */
export const yieldOf = (kind: number, genome: number) => kind === NutrientKind.debris
  ? DEBRIS_MASS * (hasGene(genome, 'exoenzymes') ? EXOENZYME_YIELD : 1)
  : NUTRIENT_MASS * (hasGene(genome, 'transporters') ? TRANSPORTER_YIELD : 1);

export const reachOf = (mass: number, genome: number) =>
  radiusOf(mass) * (hasGene(genome, 'siderophores') ? SIDEROPHORE_REACH : 1);

// Spatial hash for feeding lookups. Cells are wider than any reach (≈ 64 at cap with siderophores),
// so a 3×3 neighbourhood always covers it.
const GRID = 80;
const cellKey = (ix: number, iy: number) => (ix + 1024) * 2048 + (iy + 1024);

/**
 * One fixed tick after movement: advance the clock, emit and drift food, feed, metabolize, kill,
 * release debris, respawn. Dead players are replaced by a fresh individual (a new instance, so
 * clients rebind). Returns the ids of players that died this tick.
 */
export function stepWorld(state: PoolState): string[] {
  const tick = ++state.tick;

  // Plumes: each seep emits a jittered stream; seeps dry up and reappear elsewhere.
  for (const seep of state.seeps) {
    if (tick >= seep.untilTick) {
      Object.assign(seep, randomInDisc(WORLD_RADIUS * 0.85));
      seep.untilTick = seepUntil(tick);
    }
    if (Math.random() < SEEP_RATE * TICK_DT) {
      const jitter = randomInDisc(SEEP_SPREAD);
      spawnNutrient(state, seep.x + jitter.x, seep.y + jitter.y, NutrientKind.dissolved);
    }
  }
  if (Math.random() < BACKGROUND_RATE * TICK_DT) {
    const at = randomInDisc(WORLD_RADIUS);
    spawnNutrient(state, at.x, at.y, NutrientKind.dissolved);
  }

  // Drift food; it dissolves with age or against the rock.
  const grid = new Map<number, string[]>();
  const expired: string[] = [];
  for (const [id, n] of state.nutrients) {
    drift(n, tick);
    if (tick - n.tick0 > NUTRIENT_LIFETIME * TICK_RATE || n.x * n.x + n.y * n.y > WORLD_RADIUS * WORLD_RADIUS) {
      expired.push(id);
      continue;
    }
    const key = cellKey(Math.floor(n.x / GRID), Math.floor(n.y / GRID));
    const bucket = grid.get(key);
    if (bucket) bucket.push(id);
    else grid.set(key, [id]);
  }
  for (const id of expired) state.nutrients.delete(id);

  const dead: Player[] = [];
  const deadIds: string[] = [];
  for (const [id, p] of state.players) {
    const reach = reachOf(p.mass, p.genome);
    const ix = Math.floor(p.x / GRID);
    const iy = Math.floor(p.y / GRID);
    for (let gx = ix - 1; gx <= ix + 1; gx++) {
      for (let gy = iy - 1; gy <= iy + 1; gy++) {
        for (const nid of grid.get(cellKey(gx, gy)) ?? []) {
          const n = state.nutrients.get(nid);
          if (!n || (n.x - p.x) ** 2 + (n.y - p.y) ** 2 >= reach * reach) continue; // gone: eaten this tick
          p.mass = Math.min(MASS_CAP, p.mass + yieldOf(n.kind, p.genome));
          state.nutrients.delete(nid);
        }
      }
    }
    metabolize(p, TICK_DT);
    if (p.health <= 0) {
      dead.push(p);
      deadIds.push(id);
    }
  }

  // Lysis: the dead burst into debris where they fell, then a fresh individual takes the slot.
  for (const [i, p] of dead.entries()) {
    const r = radiusOf(p.mass);
    for (let k = Math.floor((p.mass * DEBRIS_SHARE) / DEBRIS_MASS); k > 0; k--) {
      const at = randomInDisc(r);
      spawnNutrient(state, p.x + at.x, p.y + at.y, NutrientKind.debris);
    }
    state.players.set(deadIds[i]!, spawnPlayer());
  }
  return deadIds;
}
