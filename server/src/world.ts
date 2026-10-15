// Authoritative world rules beyond movement. Pure functions over PoolState, no Room needed,
// so the headless balancing sim (P3f) can drive them directly.
import {
  Cloud, REGEN_DELAY, T6SS_DPS, TOXINS, cloudDps, cloudRadius, contactFactor, healthMaxOf, toxinFactor,
  CAPSULE_PHAGE_BLOCK, GENES, GENE_NAMES, PHAGE_BURST, PHAGE_CLEARANCE, PHAGE_DPS, PHAGE_LATENT, PHAGE_RATE,
  PLASMID_RATE, TRANSFORM_CHANCE, BACKGROUND_RATE, DEBRIS_MASS, DEBRIS_SHARE, EXOENZYME_YIELD, HEALTH_MAX,
  HEALTH_REGEN, MASS_CAP, METABOLISM_BASE, METABOLISM_RATE, MIN_MASS, NUTRIENT_CAP, NUTRIENT_LIFETIME, NUTRIENT_MASS, Nutrient, NutrientKind, Player,
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
/** Spawn a packet now. Coordinates are float32-rounded so clients rebuild the exact same path. */
export function spawnNutrient(state: PoolState, x: number, y: number, kind: number, gene = 0) {
  if (state.nutrients.size >= NUTRIENT_CAP) return;
  const x0 = Math.fround(x);
  const y0 = Math.fround(y);
  state.nutrients.set(String(nextNutrientId++), new Nutrient({ x0, y0, tick0: state.tick, kind, gene, x: x0, y: y0, tick: state.tick }));
}

/** A plasmid carrying one random gene of the catalog. */
export function spawnPlasmid(state: PoolState, x: number, y: number) {
  const gene = GENE_NAMES[Math.floor(Math.random() * GENE_NAMES.length)]!;
  spawnNutrient(state, x, y, NutrientKind.plasmid, GENES[gene].bit);
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

/** Burn mass (metabolism + gene upkeep) down to MIN_MASS; starve at the floor, else regenerate if allowed. */
export function metabolize(p: { mass: number; health: number; genome: number }, dt: number, regen = true) {
  p.mass = Math.max(MIN_MASS, p.mass - (METABOLISM_BASE + METABOLISM_RATE * p.mass + upkeepOf(p.genome)) * dt);
  if (p.mass <= MIN_MASS) p.health -= STARVE_DPS * dt;
  else if (regen) p.health = Math.min(healthMaxOf(p.genome), p.health + HEALTH_REGEN * dt);
}

let nextCloudId = 0;
/** Release every toxin this cell's genome makes, if off cooldown and it can afford the mass. */
export function secrete(state: PoolState, id: string) {
  const p = state.players.get(id);
  if (!p || p.spore > 0 || p.toxinCooldown > 0) return;
  for (const [kind, toxin] of TOXINS.entries()) {
    if (!hasGene(p.genome, toxin.gene) || p.mass - toxin.cost < MIN_MASS) continue;
    p.mass -= toxin.cost;
    p.toxinCooldown = Math.max(p.toxinCooldown, toxin.cooldown);
    const x0 = Math.fround(p.x);
    const y0 = Math.fround(p.y);
    state.clouds.set(`c${nextCloudId++}`, new Cloud({ x0, y0, tick0: state.tick, kind, owner: id, x: x0, y: y0, tick: state.tick }));
  }
}

/** Damage `p` and remember who did it (kill attribution, regen delay). */
function hurt(p: Player, amount: number, by: string, tick: number) {
  p.health -= amount;
  p.lastHitBy = by;
  p.lastHitTick = tick;
}

/** Attacker id for phage damage; session ids never contain '~'. */
export const PHAGE_KILLER = '~phage';
export interface Death { id: string; /** killer's id, PHAGE_KILLER, or '' when it starved */ by: string }

/** What one packet is worth to this genome, in mass. DNA and phages aren't food. */
export function yieldOf(kind: number, genome: number) {
  if (kind === NutrientKind.debris) return DEBRIS_MASS * (hasGene(genome, 'exoenzymes') ? EXOENZYME_YIELD : 1);
  if (kind === NutrientKind.dissolved) return NUTRIENT_MASS * (hasGene(genome, 'transporters') ? TRANSPORTER_YIELD : 1);
  return 0;
}

export const reachOf = (mass: number, genome: number) =>
  radiusOf(mass) * (hasGene(genome, 'siderophores') ? SIDEROPHORE_REACH : 1);

// Spatial hash for feeding lookups. Cells are wider than any reach (≈ 64 at cap with siderophores),
// so a 3×3 neighbourhood always covers it.
const GRID = 80;
const cellKey = (ix: number, iy: number) => (ix + 1024) * 2048 + (iy + 1024);

/**
 * One fixed tick after movement: advance the clock, emit and drift food and toxins, feed, fight,
 * metabolize, kill, release debris, respawn. Dead players are replaced by a fresh individual (a new
 * instance, so clients rebind). Endospores neither eat, fight, metabolize nor take damage.
 */
export function stepWorld(state: PoolState): Death[] {
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
  if (Math.random() < PLASMID_RATE * TICK_DT) {
    const at = randomInDisc(WORLD_RADIUS);
    spawnPlasmid(state, at.x, at.y);
  }
  if (Math.random() < PHAGE_RATE * TICK_DT) {
    // ponytail: a crowded pool skips the spawn instead of searching for room; phages still burst from the infected.
    const at = randomInDisc(WORLD_RADIUS);
    const clear = PHAGE_CLEARANCE ** 2;
    if ([...state.players.values()].every((p) => (p.x - at.x) ** 2 + (p.y - at.y) ** 2 > clear)) {
      spawnNutrient(state, at.x, at.y, NutrientKind.phage);
    }
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

  // Toxin clouds drift too, and dissolve when spent.
  const spent: string[] = [];
  for (const [id, c] of state.clouds) {
    drift(c, tick);
    if ((tick - c.tick0) * TICK_DT >= TOXINS[c.kind]!.life) spent.push(id);
  }
  for (const id of spent) state.clouds.delete(id);

  for (const p of state.players.values()) {
    if (p.spore > 0) continue;
    const r = radiusOf(p.mass);
    const reach = reachOf(p.mass, p.genome);
    const ix = Math.floor(p.x / GRID);
    const iy = Math.floor(p.y / GRID);
    for (let gx = ix - 1; gx <= ix + 1; gx++) {
      for (let gy = iy - 1; gy <= iy + 1; gy++) {
        for (const nid of grid.get(cellKey(gx, gy)) ?? []) {
          const n = state.nutrients.get(nid);
          if (!n) continue; // gone: eaten this tick
          const d2 = (n.x - p.x) ** 2 + (n.y - p.y) ** 2;
          if (n.kind === NutrientKind.phage) {
            // Phages bind the cell itself (siderophores don't reach them); a capsule may mask the receptor.
            if (d2 >= r * r) continue;
            if (!(hasGene(p.genome, 'capsule') && Math.random() < CAPSULE_PHAGE_BLOCK)) p.infection += PHAGE_LATENT;
          } else {
            if (d2 >= reach * reach) continue;
            p.mass = Math.min(MASS_CAP, p.mass + yieldOf(n.kind, p.genome));
            // Plasmids always take; fragments only sometimes recombine (transformation).
            if (n.kind === NutrientKind.plasmid || (n.gene && Math.random() < TRANSFORM_CHANCE)) p.genome |= n.gene;
          }
          state.nutrients.delete(nid);
        }
      }
    }
  }

  // Lysis. ponytail: O(players × (clouds + players)), fine at 50; reuse the spatial grid when bots raise counts.
  for (const [id, p] of state.players) {
    if (p.spore > 0) continue; // dormant: the infection waits too
    const r = radiusOf(p.mass);
    if (p.infection > 0) {
      hurt(p, PHAGE_DPS * TICK_DT, PHAGE_KILLER, tick);
      p.infection = Math.max(0, p.infection - TICK_DT - 1e-9);
    }
    for (const c of state.clouds.values()) {
      if (c.owner === id) continue; // producers carry the immunity gene to their own toxin
      const age = (tick - c.tick0) * TICK_DT;
      const reach = cloudRadius(c.kind, age) + r * 0.5;
      if ((c.x - p.x) ** 2 + (c.y - p.y) ** 2 < reach * reach) {
        hurt(p, cloudDps(c.kind, age) * toxinFactor(p.genome, c.kind) * TICK_DT, c.owner, tick);
      }
    }
    for (const [aid, a] of state.players) {
      if (aid === id || a.spore > 0 || !hasGene(a.genome, 't6ss')) continue;
      const touch = radiusOf(a.mass) + r;
      if ((a.x - p.x) ** 2 + (a.y - p.y) ** 2 < touch * touch) {
        hurt(p, T6SS_DPS * contactFactor(p.genome) * TICK_DT, aid, tick);
      }
    }
  }

  const deaths: Death[] = [];
  const dead: Player[] = [];
  for (const [id, p] of state.players) {
    if (p.spore > 0) continue;
    const recentlyHit = p.lastHitBy !== '' && tick - p.lastHitTick <= REGEN_DELAY * TICK_RATE;
    metabolize(p, TICK_DT, !recentlyHit);
    p.toxinCooldown = Math.max(0, p.toxinCooldown - TICK_DT);
    if (p.health <= 0) {
      deaths.push({ id, by: recentlyHit ? p.lastHitBy : '' });
      dead.push(p);
    }
  }

  // The dead burst where they fell into debris, one DNA fragment per gene, and the phages that
  // lysed them if infected; then a fresh individual takes the slot.
  for (const [i, p] of dead.entries()) {
    const r = radiusOf(p.mass);
    const spill = (kind: number, gene = 0) => {
      const at = randomInDisc(r);
      spawnNutrient(state, p.x + at.x, p.y + at.y, kind, gene);
    };
    for (let k = Math.floor((p.mass * DEBRIS_SHARE) / DEBRIS_MASS); k > 0; k--) spill(NutrientKind.debris);
    for (const g of GENE_NAMES) if (hasGene(p.genome, g)) spill(NutrientKind.fragment, GENES[g].bit);
    if (p.infection > 0) for (let k = 0; k < PHAGE_BURST; k++) spill(NutrientKind.phage);
    state.players.set(deaths[i]!.id, spawnPlayer());
  }
  return deaths;
}
