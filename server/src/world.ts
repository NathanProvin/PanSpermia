// Authoritative world rules beyond movement. Pure functions over PoolState, no Room needed,
// so the headless balancing sim (P3f) can drive them directly.
import {
  CHILD_PRICE, CYST_TIME, DNA_PER_MASS, KILL_DNA_SHARE, Lineage, MAX_CHILDREN, MAX_PARTS, PACKET_DNA, Part,
  EVOLVE_DNA, STARTER_CHILDREN, STARTER_LIBRARY, cleanName, randomSpeciesName, copiesOf, defaultParts, priceOf, stack, withCopies,
  Cloud, REGEN_DELAY, T6SS_DPS, TOXINS, cloudDps, cloudRadius, contactFactor, healthMaxOf, toxinFactor,
  CAPSULE_PHAGE_BLOCK, GENES, GENE_NAMES, PHAGE_BURST, PHAGE_CLEARANCE, PHAGE_DPS, PHAGE_LATENT, PHAGE_RATE,
  PLASMID_RATE, TRANSFORM_CHANCE, BACKGROUND_RATE, DEBRIS_MASS, DEBRIS_SHARE, EXOENZYME_YIELD, HEALTH_MAX,
  HEALTH_REGEN, MASS_CAP, METABOLISM_BASE, METABOLISM_RATE, MIN_MASS, NUTRIENT_CAP, NUTRIENT_LIFETIME, NUTRIENT_MASS, Nutrient, NutrientKind, Player,
  type Gene, type PoolState, SEEP_COUNT, SEEP_LIFETIME, SEEP_RATE, SEEP_SPREAD, SIDEROPHORE_REACH, SPAWN_MASS, STARTER_GENOME,
  SPAWN_GRACE, STARVE_DPS, Seep, TICK_DT, TICK_RATE, TRANSPORTER_YIELD, WORLD_RADIUS, drift, hasGene, radiusOf, upkeepOf,
} from '@panspermia/shared';

/** Uniform random point in a disc of radius `r` centred on the origin. */
function randomInDisc(r: number) {
  const angle = Math.random() * 2 * Math.PI;
  const d = r * Math.sqrt(Math.random());
  return { x: d * Math.cos(angle), y: d * Math.sin(angle) };
}

/** A fresh individual; pass the current tick to shield it for SPAWN_GRACE (tests usually don't). */
export const spawnPlayer = (tick?: number) => new Player({
  graceUntil: tick === undefined ? 0 : tick + SPAWN_GRACE * TICK_RATE,
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

/** Dormant cells (endospore, division cyst) neither eat, fight, metabolize nor take damage. */
const dormant = (p: Player) => p.spore > 0 || p.cyst > 0;

/** DNA to a lineage (bots have none). */
function earn(state: PoolState, id: string, dna: number) {
  const l = state.lineages.get(id);
  if (!l) return;
  l.dna += dna;
  l.lifetimeDna += dna;
}

/** A player founds a new species: starter design, library and reserve, first individual. */
export function foundSpecies(state: PoolState, id: string) {
  const name = randomSpeciesName();
  state.lineages.set(id, new Lineage({
    name,
    genome: STARTER_GENOME,
    parts: defaultParts(STARTER_GENOME).map((p) => new Part({ ...p, gene: GENES[p.gene].index })),
    hue: Math.random(),
    library: STARTER_LIBRARY,
    dna: 0,
    lifetimeDna: 0,
    children: STARTER_CHILDREN,
  }));
  const first = spawnPlayer(state.tick);
  first.name = name;
  state.players.set(id, first);
}

/** Fission done: a child with the lineage's current design takes over where the parent divided. */
export function hatch(state: PoolState, id: string) {
  const parent = state.players.get(id);
  const l = state.lineages.get(id);
  if (!parent || !l) return;
  drafts.delete(l);
  l.generation++;
  const child = spawnPlayer(state.tick);
  Object.assign(child, { x: parent.x, y: parent.y, heading: parent.heading, genome: l.genome, name: l.name });
  state.players.set(id, child);
}

interface Design { genome: number; placed: Part[]; hue: number; children: number; name: string; evolve: boolean; cost: number }
/** The latest valid draft per lineage, applied if the cyst times out (server-only, never synced). */
const drafts = new WeakMap<Lineage, Design>();

/**
 * Check an untrusted editor design against the lineage: every field is validated. Price = new
 * copies − old copies (removing parts refunds them, as in Spore) + children. Returns why it's refused.
 */
function parseDesign(l: Lineage, design: unknown): Design | string {
  if (typeof design !== 'object' || design === null) return 'bad design';
  const { parts, hue, children, name: rawName, evolve = false } = design as Record<string, unknown>;
  const name = cleanName(rawName);
  if (!name) return 'bad name';
  if (typeof evolve !== 'boolean') return 'bad evolve';
  if (evolve && l.lifetimeDna < EVOLVE_DNA) return 'not ready to evolve';
  if (!Array.isArray(parts) || parts.length > MAX_PARTS) return 'bad parts';
  if (typeof hue !== 'number' || !(hue >= 0 && hue < 1)) return 'bad hue';
  if (typeof children !== 'number' || !Number.isInteger(children) || children < 0 || l.children + children > MAX_CHILDREN) {
    return 'bad children';
  }
  let genome = 0;
  const placed: Part[] = [];
  for (const part of parts as unknown[]) {
    const { gene, x, y, angle, scale, group } = (part ?? {}) as Record<string, unknown>;
    if (typeof gene !== 'string' || !Object.hasOwn(GENES, gene)) return 'unknown part';
    const g = gene as Gene;
    if (!(l.library & GENES[g].bit)) return 'part not unlocked';
    if (typeof x !== 'number' || typeof y !== 'number' || typeof angle !== 'number' || typeof scale !== 'number'
      || !Number.isFinite(angle) || !(Math.hypot(x, y) <= 1.5) || !(scale >= 0.5 && scale <= 2)
      || typeof group !== 'number' || !Number.isInteger(group) || group < 0 || group > 255) {
      return 'bad placement';
    }
    const n = copiesOf(genome, g) + 1;
    if (n > GENES[g].maxCopies) return 'too many copies';
    genome = withCopies(genome, g, n);
    placed.push(new Part({ gene: GENES[g].index, x, y, angle, scale, group }));
  }
  const cost = priceOf(genome) - priceOf(l.genome) + children * CHILD_PRICE;
  if (cost > l.dna) return 'not enough DNA';
  return { genome, placed, hue, children, name, evolve, cost };
}

/**
 * An editor design from a dividing cell. Final: apply it and hatch. Draft: remember it, so a timed-out
 * cyst hatches with the player's latest edits rather than the old design. Returns why it was refused.
 */
export function submitDesign(state: PoolState, id: string, design: unknown, final = true): string | undefined {
  const p = state.players.get(id);
  const l = state.lineages.get(id);
  if (!p || !l || p.cyst <= 0) return 'not dividing';
  const d = parseDesign(l, design);
  if (typeof d === 'string') return d;
  if (!final) {
    drafts.set(l, { ...d, evolve: false }); // evolving is a deliberate click, never a timeout
    return undefined;
  }
  apply(l, d);
  if (d.evolve) {
    // The slice's ending: this design is the species' last tier-1 form; its cells leave the pool.
    l.evolved = true;
    state.players.delete(id);
  } else hatch(state, id);
  return undefined;
}

function apply(l: Lineage, d: Design) {
  l.dna -= d.cost;
  l.genome = d.genome;
  l.parts.clear();
  l.parts.push(...d.placed);
  l.hue = d.hue;
  l.name = d.name;
  l.children += d.children;
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
  if (!p || dormant(p) || p.toxinCooldown > 0) return;
  for (const [kind, toxin] of TOXINS.entries()) {
    const power = stack(copiesOf(p.genome, toxin.gene)); // more copies: stronger cloud, dearer to make
    if (!power || p.mass - toxin.cost * power < MIN_MASS) continue;
    p.mass -= toxin.cost * power;
    p.toxinCooldown = Math.max(p.toxinCooldown, toxin.cooldown);
    const x0 = Math.fround(p.x);
    const y0 = Math.fround(p.y);
    state.clouds.set(`c${nextCloudId++}`, new Cloud({ x0, y0, tick0: state.tick, kind, owner: id, power, x: x0, y: y0, tick: state.tick }));
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
export interface Death {
  id: string;
  /** killer's id, PHAGE_KILLER, or '' when it starved */
  by: string;
  /** The lineage had no child left: the species is extinct. */
  extinct?: boolean;
}

/** A multiplier gene's effect with `copies` stacked: 1 + (base − 1)·stack(copies). */
const boost = (base: number, copies: number) => 1 + (base - 1) * stack(copies);

/** What one packet is worth to this genome, in mass. DNA and phages aren't food. */
export function yieldOf(kind: number, genome: number) {
  if (kind === NutrientKind.debris) return DEBRIS_MASS * boost(EXOENZYME_YIELD, copiesOf(genome, 'exoenzymes'));
  if (kind === NutrientKind.dissolved) return NUTRIENT_MASS * boost(TRANSPORTER_YIELD, copiesOf(genome, 'transporters'));
  return 0;
}

export const reachOf = (mass: number, genome: number) =>
  radiusOf(mass) * boost(SIDEROPHORE_REACH, copiesOf(genome, 'siderophores'));

// Spatial hash for feeding lookups. Cells are wider than any reach (≈ 76 at cap with 2 siderophores),
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

  for (const [id, p] of state.players) {
    if (dormant(p)) continue;
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
            if (d2 >= r * r || tick < p.graceUntil) continue;
            if (!(hasGene(p.genome, 'capsule') && Math.random() < CAPSULE_PHAGE_BLOCK)) p.infection += PHAGE_LATENT;
          } else {
            if (d2 >= reach * reach) continue;
            const food = yieldOf(n.kind, p.genome);
            p.mass = Math.min(MASS_CAP, p.mass + food);
            earn(state, id, n.gene ? PACKET_DNA : food * DNA_PER_MASS);
            // Gene transfer unlocks the part for the species' editor. Plasmids always take; fragments
            // only sometimes recombine (transformation).
            const l = state.lineages.get(id);
            if (l && n.gene && (n.kind === NutrientKind.plasmid || Math.random() < TRANSFORM_CHANCE)) l.library |= n.gene;
          }
          state.nutrients.delete(nid);
        }
      }
    }
  }

  // Lysis. ponytail: O(players × (clouds + players)), fine at 50; reuse the spatial grid when bots raise counts.
  for (const [id, p] of state.players) {
    if (dormant(p) || tick < p.graceUntil) continue; // dormant: the infection waits too
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
        hurt(p, cloudDps(c.kind, age) * c.power * toxinFactor(p.genome, c.kind) * TICK_DT, c.owner, tick);
      }
    }
    for (const [aid, a] of state.players) {
      if (aid === id || dormant(a) || !hasGene(a.genome, 't6ss')) continue;
      const touch = radiusOf(a.mass) + r;
      if ((a.x - p.x) ** 2 + (a.y - p.y) ** 2 < touch * touch) {
        hurt(p, T6SS_DPS * stack(copiesOf(a.genome, 't6ss')) * contactFactor(p.genome) * TICK_DT, aid, tick);
      }
    }
  }

  const deaths: Death[] = [];
  const dead: Player[] = [];
  const hatching: string[] = [];
  for (const [id, p] of state.players) {
    if (p.cyst > 0) {
      p.cyst = Math.max(0, p.cyst - TICK_DT - 1e-9);
      if (p.cyst === 0) hatching.push(id); // editor timed out: hatch with the latest draft, or the old design
      continue;
    }
    if (p.spore > 0) continue;
    const recentlyHit = p.lastHitBy !== '' && tick - p.lastHitTick <= REGEN_DELAY * TICK_RATE;
    metabolize(p, TICK_DT, !recentlyHit);
    p.toxinCooldown = Math.max(0, p.toxinCooldown - TICK_DT);
    if (p.health <= 0) {
      deaths.push({ id, by: recentlyHit ? p.lastHitBy : '' });
      dead.push(p);
    } else if (p.mass >= MASS_CAP - 1 && state.lineages.has(id)) {
      p.cyst = CYST_TIME; // binary fission: shielded while the player edits the next generation
    }
  }
  for (const id of hatching) {
    const l = state.lineages.get(id);
    const draft = l && drafts.get(l);
    if (draft && draft.cost <= l.dna) apply(l, draft); // dormant cells don't earn or spend, but stay safe
    hatch(state, id);
  }

  // The dead burst where they fell into debris, one DNA fragment per gene, and the phages that
  // lysed them if infected; the killer earns DNA; then the next child takes over, or the species ends.
  for (const [i, p] of dead.entries()) {
    const death = deaths[i]!;
    const r = radiusOf(p.mass);
    const spill = (kind: number, gene = 0) => {
      const at = randomInDisc(r);
      spawnNutrient(state, p.x + at.x, p.y + at.y, kind, gene);
    };
    for (let k = Math.floor((p.mass * DEBRIS_SHARE) / DEBRIS_MASS); k > 0; k--) spill(NutrientKind.debris);
    for (const g of GENE_NAMES) if (hasGene(p.genome, g)) spill(NutrientKind.fragment, GENES[g].bit);
    if (p.infection > 0) for (let k = 0; k < PHAGE_BURST; k++) spill(NutrientKind.phage);
    if (death.by) {
      earn(state, death.by, p.mass * KILL_DNA_SHARE);
      const killer = state.lineages.get(death.by);
      if (killer) killer.kills++;
    }
    const l = state.lineages.get(death.id);
    if (l && l.children === 0) {
      l.extinct = death.extinct = true;
      state.players.delete(death.id);
      continue;
    }
    const born = spawnPlayer(tick);
    if (l) {
      l.children--;
      born.genome = l.genome;
      born.name = l.name;
    }
    state.players.set(death.id, born);
  }
  return deaths;
}
