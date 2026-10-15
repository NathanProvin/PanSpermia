// Authoritative world rules beyond movement. Pure functions over PoolState, no Room needed,
// so the headless balancing sim (P3f) can drive them directly.
import {
  ADHESIN_DRAIN, ADHESIN_SHARE, VIRUS_BURST, VIRUS_DPS, VIRUS_LATENT, VIRUS_RATE,
  CHLOROPLAST_RATE, ENDOSYMBIOSIS_CHANCE, MITO_METABOLISM, PHOTO_RATE, SHAPES,
  ELECTRIC_DPS, ELECTRIC_REACH, SHARD_RATE, SPIKE_ARC, SPIKE_DPS, SPIKE_REACH, minMassOf, wrapAngle,
  CARAPACE_ARMOUR, MANDIBLE_ARC, MANDIBLE_DPS, SPILL_MAX, STARTER_GENOME3, STARTER_LIBRARY3, T3_HEALTH_MAX, T3_METABOLISM_BASE,
  T3_METABOLISM_RATE, T3_SPAWN_MASS, TIER3, evolveDnaOf, EGG_EAT_DPS, EGG_HEALTH, EGG_RADIUS, EGG_TIME, Egg, MATE_DISTANCE,
  MATE_PREFIX, MATE_SPEED, MATE_TIMEOUT, isMate, DEFAULT_RADII, MAX_SEGMENTS, MIN_SEGMENTS, PLAN_NAMES, SEGMENT_MAX, SEGMENT_MIN,
  ALGAE_MASS, ALGAE_RATE, CHUNK_MASS, ENGULF_RATIO, ENGULF_SHARE, SEEP_ALGAE, STARTER_GENOME2, STARTER_LIBRARY2, T2_HEALTH_MAX,
  T2_METABOLISM_BASE, T2_METABOLISM_RATE, T2_MIN_MASS, T2_SPAWN_MASS, TIER2, MAX_TIER, catalogFor, massCapOf,
  CHILD_PRICE, CYST_TIME, DNA_PER_MASS, KILL_DNA_SHARE, Lineage, MAX_CHILDREN, MAX_PARTS, PACKET_DNA, Part,
  STARTER_CHILDREN, STARTER_LIBRARY, cleanName, randomSpeciesName, copiesOf, defaultParts, priceOf, stack, withCopies,
  Cloud, REGEN_DELAY, T6SS_DPS, TOXINS, cloudDps, cloudRadius, contactFactor, healthMaxOf, toxinFactor,
  CAPSULE_PHAGE_BLOCK, GENES, GENE_NAMES, PHAGE_BURST, PHAGE_CLEARANCE, PHAGE_DPS, PHAGE_LATENT, PHAGE_RATE,
  PLASMID_RATE, TRANSFORM_CHANCE, BACKGROUND_RATE, DEBRIS_MASS, DEBRIS_SHARE, EXOENZYME_YIELD, HEALTH_MAX,
  HEALTH_REGEN, MASS_CAP, METABOLISM_BASE, METABOLISM_RATE, MIN_MASS, NUTRIENT_CAP, NUTRIENT_LIFETIME, NUTRIENT_MASS, Nutrient, NutrientKind, Player,
  type Gene, type PoolState, SEEP_COUNT, SEEP_LIFETIME, SEEP_RATE, SEEP_SPREAD, SIDEROPHORE_REACH, SPAWN_MASS, STARTER_GENOME,
  SPAWN_GRACE, STARVE_DPS, Seep, TICK_DT, ownGenome, TICK_RATE, TRANSPORTER_YIELD, WORLD_RADIUS, drift, hasGene, radiusOf, upkeepOf,
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

/**
 * Mate calls: each calling animal's mate swims straight in (spawned on the first tick of the call);
 * meeting it — or calling too long — starts the editor (the cyst). Mates of callers that stopped go away.
 */
function stepMates(state: PoolState) {
  const gone: string[] = [];
  for (const [id, p] of state.players) {
    if (isMate(id)) {
      if (!(state.players.get(id.slice(MATE_PREFIX.length))?.call)) gone.push(id);
      continue;
    }
    if (!p.call) continue;
    const mid = MATE_PREFIX + id;
    const m = state.players.get(mid);
    if (!m) {
      const a = Math.random() * 2 * Math.PI;
      const far = 2 * radiusOf(p.mass) + MATE_DISTANCE; // two grown animals touch ~620 apart
      const at = { x: p.x + Math.cos(a) * far, y: p.y + Math.sin(a) * far };
      const k = Math.min(1, (WORLD_RADIUS * 0.95) / Math.hypot(at.x, at.y)); // inside the pool
      state.players.set(mid, new Player({
        name: p.name, shape: p.shape, tier: 3, genome3: p.genome3, mass: p.mass, health: T3_HEALTH_MAX,
        x: at.x * k, y: at.y * k, heading: a + Math.PI, graceUntil: 0xffffffff, tumble: 0, rng: 1, genome: 0,
      }));
      continue;
    }
    p.call += TICK_DT;
    const dx = p.x - m.x;
    const dy = p.y - m.y;
    const d = Math.hypot(dx, dy);
    if (d < radiusOf(p.mass) + radiusOf(m.mass) || p.call > MATE_TIMEOUT) {
      gone.push(mid);
      p.call = 0;
      p.cyst = CYST_TIME; // mated: shielded while the player edits the next generation
      continue;
    }
    const step = Math.min(d, MATE_SPEED * TICK_DT);
    m.x += (dx / d) * step;
    m.y += (dy / d) * step;
    m.heading = Math.atan2(dy, dx);
  }
  for (const id of gone) state.players.delete(id);
}

/** Clutches hatch into the species' next individual, unless eukaryotes or animals eat them first. */
function stepEggs(state: PoolState, tick: number) {
  for (const [eid, egg] of [...state.eggs]) {
    const l = state.lineages.get(egg.owner);
    if (!l || l.extinct) {
      state.eggs.delete(eid);
      continue;
    }
    if (tick >= egg.hatchTick) {
      state.eggs.delete(eid);
      l.generation++;
      state.players.set(egg.owner, nextOf(l, tick, { x: egg.x, y: egg.y, heading: Math.random() * 2 * Math.PI }));
      continue;
    }
    for (const [pid, p] of state.players) {
      if (pid === egg.owner || isMate(pid) || p.tier < 2 || dormant(p)) continue;
      const reach = radiusOf(p.mass) * 1.05 + EGG_RADIUS;
      if (!((p.x - egg.x) ** 2 + (p.y - egg.y) ** 2 < reach * reach)) continue;
      const bite = Math.min(egg.health, EGG_EAT_DPS * TICK_DT);
      egg.health -= bite;
      p.mass = Math.min(massCapOf(p.tier), p.mass + bite);
      earn(state, pid, bite * DNA_PER_MASS);
    }
    if (egg.health <= 0) state.eggs.delete(eid);
  }
}

/** DNA to a lineage (bots have none). */
function earn(state: PoolState, id: string, dna: number) {
  const l = state.lineages.get(id);
  if (!l) return;
  l.dna += dna;
  l.lifetimeDna += dna;
}

/** The lineage's next individual: its tier, design and name — where the parent divided, or anywhere. */
function nextOf(l: Lineage, tick: number, at?: { x: number; y: number; heading: number }) {
  const p = spawnPlayer(tick);
  if (l.tier === 3) Object.assign(p, { tier: 3, genome: 0, genome3: l.genome, mass: T3_SPAWN_MASS, health: T3_HEALTH_MAX });
  else if (l.tier === 2) Object.assign(p, { tier: 2, genome: 0, genome2: l.genome, mass: T2_SPAWN_MASS, health: T2_HEALTH_MAX });
  else p.genome = l.genome;
  p.name = l.name;
  p.shape = l.shape;
  if (at) Object.assign(p, at);
  return p;
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
  state.players.set(id, nextOf(state.lineages.get(id)!, state.tick));
}

let nextEggId = 0;
/**
 * Editing done. Cells divide: a child with the lineage's current design takes over where the parent
 * divided. Animals lay a clutch instead and carry on, spent; the clutch hatches into the new design.
 */
export function hatch(state: PoolState, id: string) {
  const parent = state.players.get(id);
  const l = state.lineages.get(id);
  if (!parent || !l) return;
  drafts.delete(l);
  if (parent.tier === 3 && l.tier === 3) {
    parent.cyst = 0;
    parent.mass = T3_SPAWN_MASS; // the energy went into the eggs
    state.eggs.set(`e${nextEggId++}`, new Egg({
      x: parent.x, y: parent.y, owner: id, hatchTick: state.tick + EGG_TIME * TICK_RATE, health: EGG_HEALTH, count: Math.min(6, 1 + l.children),
    }));
    return;
  }
  l.generation++;
  state.players.set(id, nextOf(l, state.tick, { x: parent.x, y: parent.y, heading: parent.heading }));
}

interface Design {
  genome: number; placed: Part[]; hue: number; shape: number; children: number; name: string; evolve: boolean; cost: number;
  /** Animals only: body plan and segment sizes (undefined for other tiers). */
  body?: { plan: number; radii: number[] };
}
/** The latest valid draft per lineage, applied if the cyst times out (server-only, never synced). */
const drafts = new WeakMap<Lineage, Design>();

/**
 * Check an untrusted editor design against the lineage: every field is validated. Price = new
 * copies − old copies (removing parts refunds them, as in Spore) + children. Returns why it's refused.
 */
function parseDesign(l: Lineage, design: unknown): Design | string {
  if (typeof design !== 'object' || design === null) return 'bad design';
  const { parts, hue, children, name: rawName, evolve = false, shape = 0, plan = 0, radii = DEFAULT_RADII } = design as Record<string, unknown>;
  if (typeof shape !== 'number' || !Number.isInteger(shape) || !SHAPES[shape]) return 'bad shape';
  const name = cleanName(rawName);
  if (!name) return 'bad name';
  if (typeof evolve !== 'boolean') return 'bad evolve';
  if (evolve && l.tier >= MAX_TIER) return 'cannot evolve further yet';
  if (evolve && l.lifetimeDna < evolveDnaOf(l.tier)) return 'not ready to evolve';
  if (!Array.isArray(parts) || parts.length > MAX_PARTS) return 'bad parts';
  if (typeof hue !== 'number' || !(hue >= 0 && hue < 1)) return 'bad hue';
  if (typeof children !== 'number' || !Number.isInteger(children) || children < 0 || l.children + children > MAX_CHILDREN) {
    return 'bad children';
  }
  let body: Design['body'];
  if (l.tier === 3) {
    if (typeof plan !== 'number' || !Number.isInteger(plan) || !PLAN_NAMES[plan]) return 'bad plan';
    if (!Array.isArray(radii) || radii.length < MIN_SEGMENTS || radii.length > MAX_SEGMENTS
      || !radii.every((r) => typeof r === 'number' && r >= SEGMENT_MIN && r <= SEGMENT_MAX)) return 'bad segments';
    body = { plan, radii: radii as number[] };
  }
  const cat = catalogFor(l.tier);
  let genome = 0;
  const placed: Part[] = [];
  for (const part of parts as unknown[]) {
    const { gene, x, y, angle, scale, group } = (part ?? {}) as Record<string, unknown>;
    if (typeof gene !== 'string' || !Object.hasOwn(cat.GENES, gene)) return 'unknown part';
    const g = cat.GENES[gene]!;
    if (!(l.library & g.bit)) return 'part not unlocked';
    if (typeof x !== 'number' || typeof y !== 'number' || typeof angle !== 'number' || typeof scale !== 'number'
      || !Number.isFinite(angle) || !(Math.hypot(x, y) <= 1.5) || !(scale >= 0.5 && scale <= 2)
      || typeof group !== 'number' || !Number.isInteger(group) || group < 0 || group > 255) {
      return 'bad placement';
    }
    const n = cat.copiesOf(genome, gene) + 1;
    if (n > g.maxCopies) return 'too many copies';
    genome = cat.withCopies(genome, gene, n);
    placed.push(new Part({ gene: g.index, x, y, angle, scale, group }));
  }
  const cost = cat.priceOf(genome) - cat.priceOf(l.genome) + children * CHILD_PRICE;
  if (cost > l.dna) return 'not enough DNA';
  return { genome, placed, hue, shape, children, name, evolve, cost, body };
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
  if (d.evolve) evolve(l);
  hatch(state, id);
  return undefined;
}

/** Spore's "Grow legs?": from the next generation on, the species is the next tier's starter. */
function evolve(l: Lineage) {
  const [genome, library] = l.tier === 1 ? [STARTER_GENOME2, STARTER_LIBRARY2] : [STARTER_GENOME3, STARTER_LIBRARY3];
  l.tier++;
  const cat = catalogFor(l.tier);
  l.genome = genome;
  l.parts.clear();
  l.parts.push(...cat.defaultParts(genome).map((p) => new Part({ ...p, gene: cat.GENES[p.gene]!.index })));
  l.library = library; // the old tier's parts mean nothing to the new body plan
  if (l.tier === 3) {
    l.plan = 0;
    l.radii.clear();
    l.radii.push(...DEFAULT_RADII);
  }
}

function apply(l: Lineage, d: Design) {
  l.dna -= d.cost;
  l.genome = d.genome;
  l.parts.clear();
  l.parts.push(...d.placed);
  l.hue = d.hue;
  l.name = d.name;
  l.shape = d.shape;
  l.children += d.children;
  if (d.body) {
    l.plan = d.body.plan;
    l.radii.clear();
    l.radii.push(...d.body.radii);
  }
}

/** A meteor shard carrying one random tier-2 part (Spore's meteor bits); an animal draws a tier-3 part instead. */
export function spawnShard(state: PoolState, x: number, y: number) {
  const gene = TIER2.NAMES[Math.floor(Math.random() * TIER2.NAMES.length)]!;
  spawnNutrient(state, x, y, NutrientKind.shard, TIER2.GENES[gene].bit);
}

/** The parts a tier-2 cell actually wears: its species design, or the default layout (bots, dev cheats). */
function partsOfCell(state: PoolState, id: string, p: Player) {
  const l = state.lineages.get(id);
  if (l && l.tier === p.tier && l.genome === p.genome2) return [...l.parts].map((q) => ({ gene: TIER2.NAMES[q.gene]!, angle: q.angle }));
  return TIER2.defaultParts(p.genome2);
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

/** Burn mass (metabolism + part upkeep, per tier) down to the floor; starve there, else regenerate if allowed. */
export function metabolize(
  p: { mass: number; health: number; genome: number; genome2?: number; genome3?: number; tier?: number }, dt: number, regen = true,
) {
  const tier = p.tier ?? 1;
  const genome2 = p.genome2 ?? 0;
  const floor = minMassOf(tier);
  // Mitochondria make metabolism cheaper; thylakoids / chloroplasts make mass from light.
  const burn = tier === 3 ? T3_METABOLISM_BASE + T3_METABOLISM_RATE * p.mass + TIER3.upkeepOf(p.genome3 ?? 0)
    : tier === 2
      ? (T2_METABOLISM_BASE + T2_METABOLISM_RATE * p.mass) * (1 - MITO_METABOLISM * stack(TIER2.copiesOf(genome2, 'mitochondrion')))
        + TIER2.upkeepOf(genome2)
      : METABOLISM_BASE + METABOLISM_RATE * p.mass + upkeepOf(p.genome);
  const light = tier === 3 ? 0 : tier === 2 ? CHLOROPLAST_RATE * stack(TIER2.copiesOf(genome2, 'chloroplast'))
    : PHOTO_RATE * stack(copiesOf(p.genome, 'thylakoid'));
  p.mass = Math.max(floor, Math.min(massCapOf(tier), p.mass + (light - burn) * dt));
  if (p.mass <= floor) p.health -= STARVE_DPS * dt;
  else if (regen) p.health = Math.min(healthMaxOf(p.genome, p.tier), p.health + HEALTH_REGEN * dt);
}

let nextCloudId = 0;
/** Release every toxin this cell's genome makes, if off cooldown and it can afford the mass. */
export function secrete(state: PoolState, id: string) {
  const p = state.players.get(id);
  if (!p || dormant(p) || p.toxinCooldown > 0) return;
  for (const [kind, toxin] of TOXINS.entries()) {
    if (toxin.tier !== p.tier) continue;
    const genome = ownGenome(p);
    const power = stack(catalogFor(p.tier).copiesOf(genome, toxin.gene)); // more copies: stronger cloud, dearer
    if (!power || p.mass - toxin.cost * power < minMassOf(p.tier)) continue;
    p.mass -= toxin.cost * power;
    p.toxinCooldown = Math.max(p.toxinCooldown, toxin.cooldown);
    const back = p.tier === 2 ? radiusOf(p.mass) * 1.2 : 0; // a eukaryote leaves its poison behind it
    const x0 = Math.fround(p.x - Math.cos(p.heading) * back);
    const y0 = Math.fround(p.y - Math.sin(p.heading) * back);
    state.clouds.set(`c${nextCloudId++}`, new Cloud({ x0, y0, tick0: state.tick, kind, owner: id, power, x: x0, y: y0, tick: state.tick }));
  }
}

/** Damage `p` and remember who did it (kill attribution, regen delay). */
function hurt(p: Player, amount: number, by: string, tick: number) {
  p.health -= amount;
  p.lastHitBy = by;
  p.lastHitTick = tick;
}

/** Attacker ids for virus damage (phages: bacteria, giant viruses: eukaryotes); session ids never contain '~'. */
export const PHAGE_KILLER = '~phage';
export const VIRUS_KILLER = '~virus';
export interface Death {
  id: string;
  /** killer's id, PHAGE_KILLER, or '' when it starved */
  by: string;
  /** The lineage had no child left: the species is extinct. */
  extinct?: boolean;
}

/** A multiplier gene's effect with `copies` stacked: 1 + (base − 1)·stack(copies). */
const boost = (base: number, copies: number) => 1 + (base - 1) * stack(copies);

/** What one packet is worth to a bacterium with this genome, in mass. DNA, phages and algae aren't its food. */
export function yieldOf(kind: number, genome: number) {
  if (kind === NutrientKind.debris) return DEBRIS_MASS * boost(EXOENZYME_YIELD, copiesOf(genome, 'exoenzymes'));
  if (kind === NutrientKind.chunk) return CHUNK_MASS * boost(EXOENZYME_YIELD, copiesOf(genome, 'exoenzymes')); // decomposers
  if (kind === NutrientKind.dissolved) return NUTRIENT_MASS * boost(TRANSPORTER_YIELD, copiesOf(genome, 'transporters'));
  return 0;
}

export const reachOf = (mass: number, genome: number) =>
  radiusOf(mass) * boost(SIDEROPHORE_REACH, copiesOf(genome, 'siderophores'));

/** What one packet is worth to an animal: filter combs sweep up plant food, mandibles take meat. */
export function yield3Of(kind: number, genome3: number) {
  if (TIER3.hasGene(genome3, 'filterComb')) {
    if (kind === NutrientKind.algae) return ALGAE_MASS;
    if (kind === NutrientKind.dissolved) return NUTRIENT_MASS;
  }
  if (TIER3.hasGene(genome3, 'mandible')) {
    if (kind === NutrientKind.chunk) return CHUNK_MASS;
    if (kind === NutrientKind.debris) return DEBRIS_MASS;
  }
  return 0;
}

/**
 * Whether `e` can swallow `v` whole (by mass; contact is checked by the caller): a eukaryote's jaw or an
 * animal's mandibles take any smaller-tier or rival cell up to ENGULF_RATIO of the eater; filter combs only
 * sweep up bacteria.
 */
export function swallows(e: Player, v: Player) {
  if (v.mass > e.mass * ENGULF_RATIO) return false;
  if (e.tier === 2) return TIER2.hasGene(e.genome2, 'jaw');
  if (e.tier === 3) return TIER3.hasGene(e.genome3, 'mandible') || (v.tier === 1 && TIER3.hasGene(e.genome3, 'filterComb'));
  return false;
}

/**
 * What one packet is worth to a eukaryote, by mouth: a filter takes plant food (dissolved, algae), a jaw
 * takes meat (debris, chunks); 0 means it can't take it in.
 */
export function yield2Of(kind: number, genome2: number) {
  if (TIER2.hasGene(genome2, 'filter')) {
    if (kind === NutrientKind.algae) return ALGAE_MASS;
    if (kind === NutrientKind.dissolved) return NUTRIENT_MASS;
  }
  if (TIER2.hasGene(genome2, 'jaw')) {
    if (kind === NutrientKind.chunk) return CHUNK_MASS;
    if (kind === NutrientKind.debris) return DEBRIS_MASS;
  }
  return 0;
}

// Spatial hash for feeding lookups: a reach of r scans ⌈r / GRID⌉ cells around the eater's.
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
    if (Math.random() < SEEP_ALGAE * TICK_DT) { // algae bloom on the seeps' nutrients
      const jitter = randomInDisc(SEEP_SPREAD * 4);
      spawnNutrient(state, seep.x + jitter.x, seep.y + jitter.y, NutrientKind.algae);
    }
  }
  if (Math.random() < ALGAE_RATE * TICK_DT) {
    const at = randomInDisc(WORLD_RADIUS);
    spawnNutrient(state, at.x, at.y, NutrientKind.algae);
  }
  if (Math.random() < BACKGROUND_RATE * TICK_DT) {
    const at = randomInDisc(WORLD_RADIUS);
    spawnNutrient(state, at.x, at.y, NutrientKind.dissolved);
  }
  if (Math.random() < PLASMID_RATE * TICK_DT) {
    const at = randomInDisc(WORLD_RADIUS);
    spawnPlasmid(state, at.x, at.y);
  }
  if (Math.random() < SHARD_RATE * TICK_DT) {
    const at = randomInDisc(WORLD_RADIUS);
    spawnShard(state, at.x, at.y);
  }
  // Wild viruses: phages (bacteria) and giant viruses (eukaryotes), never right on top of a cell.
  // ponytail: a crowded pool skips the spawn instead of searching for room; viruses still burst from the infected.
  for (const [kind, rate] of [[NutrientKind.phage, PHAGE_RATE], [NutrientKind.virus, VIRUS_RATE]] as const) {
    if (Math.random() >= rate * TICK_DT) continue;
    const at = randomInDisc(WORLD_RADIUS);
    const clear = PHAGE_CLEARANCE ** 2;
    if ([...state.players.values()].every((p) => (p.x - at.x) ** 2 + (p.y - at.y) ** 2 > clear)) spawnNutrient(state, at.x, at.y, kind);
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

  stepMates(state);
  stepEggs(state, tick);

  for (const [id, p] of state.players) {
    if (dormant(p) || isMate(id)) continue;
    const r = radiusOf(p.mass);
    const t2 = p.tier >= 2; // eukaryotes and animals eat by mouth
    const reach = t2 ? r * 1.05 : reachOf(p.mass, p.genome);
    const span = Math.ceil(reach / GRID);
    const ix = Math.floor(p.x / GRID);
    const iy = Math.floor(p.y / GRID);
    for (let gx = ix - span; gx <= ix + span; gx++) {
      for (let gy = iy - span; gy <= iy + span; gy++) {
        for (const nid of grid.get(cellKey(gx, gy)) ?? []) {
          const n = state.nutrients.get(nid);
          if (!n) continue; // gone: eaten this tick
          const d2 = (n.x - p.x) ** 2 + (n.y - p.y) ** 2;
          if (t2) {
            if (d2 >= reach * reach) continue;
            const l = state.lineages.get(id);
            if (n.kind === NutrientKind.virus) { // a giant virus binds the cell itself (not the mouth's reach)
              if (p.tier !== 2) continue; // ponytail: animals ignore giant viruses until tier-3 hazards (P9d)
              if (d2 >= r * r || tick < p.graceUntil) continue;
              p.infection += VIRUS_LATENT;
            } else if (n.kind === NutrientKind.shard) { // touching a meteor shard takes its part
              earn(state, id, PACKET_DNA);
              if (l?.tier === 2) l.library |= n.gene;
              if (l?.tier === 3) l.library |= TIER3.GENES[TIER3.NAMES[Math.floor(Math.random() * TIER3.NAMES.length)]!].bit;
            } else {
              // Eukaryotes and animals eat by mouth; phages (bacteria-only viruses) and bacterial DNA drift past.
              const food = p.tier === 3 ? yield3Of(n.kind, p.genome3) : yield2Of(n.kind, p.genome2);
              if (!food) continue;
              p.mass = Math.min(massCapOf(p.tier), p.mass + food);
              earn(state, id, food * DNA_PER_MASS);
              // A chunk of a dead eukaryote may carry one of its parts (Spore: eat a creature, get its part).
              if (l?.tier === 2 && p.tier === 2 && n.gene && Math.random() < TRANSFORM_CHANCE) l.library |= n.gene;
            }
          } else if (n.kind === NutrientKind.algae || n.kind === NutrientKind.shard || n.kind === NutrientKind.virus) {
            continue; // too big for a bacterium to take in; not its kind of DNA
          } else if (n.kind === NutrientKind.phage) {
            // Phages bind the cell itself (siderophores don't reach them); a capsule may mask the receptor.
            if (d2 >= r * r || tick < p.graceUntil) continue;
            if (!(hasGene(p.genome, 'capsule') && Math.random() < CAPSULE_PHAGE_BLOCK)) p.infection += PHAGE_LATENT;
          } else {
            if (d2 >= reach * reach) continue;
            const food = yieldOf(n.kind, p.genome);
            p.mass = Math.min(MASS_CAP, p.mass + food);
            const dna = n.kind === NutrientKind.fragment || n.kind === NutrientKind.plasmid; // bacterial DNA only
            earn(state, id, dna ? PACKET_DNA : food * DNA_PER_MASS);
            // Gene transfer unlocks the part for the species' editor. Plasmids always take; fragments
            // only sometimes recombine (transformation).
            const l = state.lineages.get(id);
            if (l?.tier === 1 && dna && (n.kind === NutrientKind.plasmid || Math.random() < TRANSFORM_CHANCE)) l.library |= n.gene;
          }
          state.nutrients.delete(nid);
        }
      }
    }
  }

  // Phagocytosis: a jaw (or mandibles, or filter combs for bacteria) swallows any cell at most ENGULF_RATIO
  // of the eater's mass whose centre it covers — bacteria are snacks. Endospores resist digestion; cysts and
  // newborns are shielded.
  // ponytail: O(players²), fine at 50; use a grid when tier-2 bots raise counts.
  for (const [eid, e] of state.players) {
    if (e.tier < 2 || dormant(e) || e.engulfedBy || isMate(eid)) continue;
    const mouth = radiusOf(e.mass) * 0.9;
    for (const [vid, v] of state.players) {
      if (vid === eid || v.engulfedBy || dormant(v) || tick < v.graceUntil || !swallows(e, v)) continue;
      if (!((v.x - e.x) ** 2 + (v.y - e.y) ** 2 < mouth * mouth)) continue; // NaN-safe: never swallow on a bad position
      v.engulfedBy = eid;
      hurt(v, v.health + 1, eid, tick);
      const food = v.mass * ENGULF_SHARE;
      e.mass = Math.min(massCapOf(e.tier), e.mass + food);
      earn(state, eid, food * DNA_PER_MASS);
      // Endosymbiosis: a swallowed bacterium may live on inside as an organelle (unlocked for the editor).
      const l = state.lineages.get(eid);
      if (l?.tier === 2 && v.tier === 1) {
        for (const [gene, organelle] of [['transporters', 'mitochondrion'], ['thylakoid', 'chloroplast']] as const) {
          if (hasGene(v.genome, gene) && Math.random() < ENDOSYMBIOSIS_CHANCE) l.library |= TIER2.GENES[organelle].bit;
        }
      }
    }
  }

  // Parasitism: a bacterium with adhesins drains the energy of every eukaryote it clings to.
  for (const [pid, par] of state.players) {
    const hooks = par.tier === 1 && !dormant(par) ? copiesOf(par.genome, 'adhesin') : 0;
    if (!hooks) continue;
    const rp = radiusOf(par.mass);
    for (const host of state.players.values()) {
      if (host.tier < 2 || dormant(host) || tick < host.graceUntil) continue; // eukaryotes and animals
      const touch = radiusOf(host.mass) + rp;
      if (!((host.x - par.x) ** 2 + (host.y - par.y) ** 2 < touch * touch)) continue;
      const drained = Math.min(ADHESIN_DRAIN * stack(hooks) * TICK_DT, host.mass - minMassOf(host.tier));
      if (drained <= 0) continue;
      host.mass -= drained;
      par.mass = Math.min(MASS_CAP, par.mass + drained * ADHESIN_SHARE);
      earn(state, pid, drained * ADHESIN_SHARE * DNA_PER_MASS);
    }
  }

  // Where each spiked eukaryote's spikes point (body frame); spikes only stab in those directions.
  const spikes = new Map<string, number[]>();
  for (const [id, p] of state.players) {
    if (p.tier === 2 && TIER2.hasGene(p.genome2, 'spike')) {
      spikes.set(id, partsOfCell(state, id, p).filter((q) => q.gene === 'spike').map((q) => q.angle));
    }
  }

  // Lysis. ponytail: O(players × (clouds + players)), fine at 50; reuse the spatial grid when bots raise counts.
  for (const [id, p] of state.players) {
    if (dormant(p) || tick < p.graceUntil) continue; // dormant: the infection waits too
    const r = radiusOf(p.mass);
    if (p.infection > 0) {
      hurt(p, (p.tier === 2 ? VIRUS_DPS : PHAGE_DPS) * TICK_DT, p.tier === 2 ? VIRUS_KILLER : PHAGE_KILLER, tick);
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
      if (aid === id || dormant(a) || isMate(aid)) continue;
      const ra = radiusOf(a.mass);
      const dx = p.x - a.x;
      const dy = p.y - a.y;
      const d = Math.hypot(dx, dy);
      if (hasGene(a.genome, 't6ss') && d < ra + r) {
        hurt(p, T6SS_DPS * stack(copiesOf(a.genome, 't6ss')) * contactFactor(p.genome) * TICK_DT, aid, tick);
      }
      if (a.tier === 3) {
        // Mandibles bite a rival animal in front; a carapace turns part of the bite.
        if (p.tier === 3 && TIER3.hasGene(a.genome3, 'mandible') && d < ra * 1.1 + r
          && Math.abs(wrapAngle(Math.atan2(dy, dx) - a.heading)) < MANDIBLE_ARC) {
          hurt(p, MANDIBLE_DPS * (TIER3.hasGene(p.genome3, 'carapace') ? CARAPACE_ARMOUR : 1) * TICK_DT, aid, tick);
        }
        continue;
      }
      if (a.tier !== 2) continue;
      // Electric organ: shocks everything inside its field, all around.
      const organs = TIER2.copiesOf(a.genome2, 'electric');
      if (organs && d < ra * ELECTRIC_REACH + r) hurt(p, ELECTRIC_DPS * stack(organs) * contactFactor(p.genome) * TICK_DT, aid, tick);
      // Spikes stab only what's in front of them.
      const angles = spikes.get(aid);
      if (angles && d < ra * (1 + SPIKE_REACH) + r) {
        const bearing = Math.atan2(dy, dx) - a.heading;
        const facing = angles.filter((s) => Math.abs(wrapAngle(bearing - s)) < SPIKE_ARC).length;
        if (facing) hurt(p, SPIKE_DPS * stack(facing) * contactFactor(p.genome) * TICK_DT, aid, tick);
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
    if (p.spore > 0 || isMate(id)) continue;
    const recentlyHit = p.lastHitBy !== '' && tick - p.lastHitTick <= REGEN_DELAY * TICK_RATE;
    metabolize(p, TICK_DT, !recentlyHit);
    p.toxinCooldown = Math.max(0, p.toxinCooldown - TICK_DT);
    if (p.health <= 0) {
      deaths.push({ id, by: recentlyHit ? p.lastHitBy : '' });
      dead.push(p);
    } else if (p.mass >= massCapOf(p.tier) - 1 && state.lineages.has(id)) {
      // Binary fission: shielded while the player edits the next generation. Animals call a mate first.
      if (p.tier === 3) p.call ||= TICK_DT;
      else p.cyst = CYST_TIME;
    }
  }
  for (const id of hatching) {
    const l = state.lineages.get(id);
    const draft = l && drafts.get(l);
    if (draft && draft.cost <= l.dna) apply(l, draft); // dormant cells don't earn or spend, but stay safe
    hatch(state, id);
  }

  // The dead burst where they fell into debris (a eukaryote falls apart into meat chunks), one DNA
  // fragment per gene, and the phages that lysed them if infected — unless they were swallowed whole.
  // The killer earns DNA; then the next child takes over, or the species ends.
  for (const [i, p] of dead.entries()) {
    const death = deaths[i]!;
    const r = radiusOf(p.mass);
    const spill = (kind: number, gene = 0) => {
      const at = randomInDisc(r);
      spawnNutrient(state, p.x + at.x, p.y + at.y, kind, gene);
    };
    if (!p.engulfedBy) {
      const [kind, size] = p.tier >= 2 ? [NutrientKind.chunk, CHUNK_MASS] : [NutrientKind.debris, DEBRIS_MASS];
      for (let k = Math.min(SPILL_MAX, Math.floor((p.mass * DEBRIS_SHARE) / size)); k > 0; k--) spill(kind);
      for (const g of GENE_NAMES) if (hasGene(p.genome, g)) spill(NutrientKind.fragment, GENES[g].bit);
      for (const g of TIER2.NAMES) if (TIER2.hasGene(p.genome2, g)) spill(NutrientKind.chunk, TIER2.GENES[g].bit);
      if (p.infection > 0) {
        const [virus, burst] = p.tier === 2 ? [NutrientKind.virus, VIRUS_BURST] : [NutrientKind.phage, PHAGE_BURST];
        for (let k = 0; k < burst; k++) spill(virus);
      }
    }
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
    if (l) l.children--;
    state.players.set(death.id, l ? nextOf(l, tick) : spawnPlayer(tick));
  }
  return deaths;
}
