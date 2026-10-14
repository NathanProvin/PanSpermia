// Authoritative world rules beyond movement. Pure functions over PoolState, no Room needed,
// so the headless balancing sim (P3) can drive them directly.
import {
  HEALTH_MAX, HEALTH_REGEN, MASS_CAP, METABOLISM_BASE, METABOLISM_RATE, MIN_MASS, NUTRIENT_COUNT,
  NUTRIENT_MASS, Nutrient, Player, type PoolState, SPAWN_MASS, STARVE_DPS, WORLD_RADIUS, radiusOf,
} from '@panspermia/shared';

/** Uniform random point in a disc of radius `r` centred on the origin. */
function randomInDisc(r: number) {
  const angle = Math.random() * 2 * Math.PI;
  const d = r * Math.sqrt(Math.random());
  return { x: d * Math.cos(angle), y: d * Math.sin(angle) };
}

export const spawnPlayer = () =>
  new Player({ ...randomInDisc(WORLD_RADIUS - radiusOf(SPAWN_MASS)), mass: SPAWN_MASS, health: HEALTH_MAX });

let nextNutrientId = 0;
export function topUpNutrients(state: PoolState) {
  while (state.nutrients.size < NUTRIENT_COUNT) {
    state.nutrients.set(String(nextNutrientId++), new Nutrient(randomInDisc(WORLD_RADIUS)));
  }
}

/** Burn mass down to MIN_MASS; starve at the floor, regenerate above it. */
export function metabolize(p: { mass: number; health: number }, dt: number) {
  p.mass = Math.max(MIN_MASS, p.mass - (METABOLISM_BASE + METABOLISM_RATE * p.mass) * dt);
  p.health = p.mass <= MIN_MASS
    ? p.health - STARVE_DPS * dt
    : Math.min(HEALTH_MAX, p.health + HEALTH_REGEN * dt);
}

/**
 * One tick after movement: feeding, metabolism, deaths, nutrient regrowth.
 * Dead players are replaced by a fresh individual (a new instance, so clients rebind).
 * Returns the ids of players that died this tick.
 */
export function stepWorld(state: PoolState, dt: number): string[] {
  const dead: string[] = [];
  const eaten: string[] = [];
  for (const [id, p] of state.players) {
    const r2 = radiusOf(p.mass) ** 2;
    // ponytail: O(players × nutrients) scan, ~30k checks/tick in a full room; spatial grid when P3 plumes raise counts.
    for (const [nid, n] of state.nutrients) {
      if ((n.x - p.x) ** 2 + (n.y - p.y) ** 2 < r2) {
        eaten.push(nid);
        p.mass = Math.min(MASS_CAP, p.mass + NUTRIENT_MASS);
      }
    }
    for (const nid of eaten) state.nutrients.delete(nid);
    eaten.length = 0;

    metabolize(p, dt);
    if (p.health <= 0) dead.push(id);
  }
  for (const id of dead) state.players.set(id, spawnPlayer());
  topUpNutrients(state);
  return dead;
}
