// Authoritative world rules beyond movement. Pure functions over PoolState, no Room needed,
// so the headless balancing sim (P3f) can drive them directly.
import {
  ADHESIN_DRAIN, ADHESIN_SHARE, GILL_METABOLISM, STYLET_DRAIN, PROBOSCIS_DRAIN, CERATA_REFLECT, MASTAX_YIELD, MAXILLA_YIELD, SPINE_GAPE, LOBOPOD_GRIP, OIL_METABOLISM, PEDUNCLE_DRAIN, PARASITE_SHARE, PALLIUM_RATIO, THECA_ARMOUR, VIRUS_BURST, VIRUS_DPS, VIRUS_LATENT, VIRUS_RATE,
  CHLOROPLAST_RATE, ENDOSYMBIOSIS_CHANCE, MITO_METABOLISM, PHOTO_RATE, SHAPES,
  ELECTRIC_DPS, ELECTRIC_REACH, SHARD_RATE, SHARD_UNLOCK_T4, SPIKE_ARC, SPIKE_DPS, SPIKE_REACH, minMassOf, wrapAngle,
  BITE_DAMAGE, SMALLER_BITE, BITE_INTERVAL, BITE_KNOCK, BITE_REACH, BITE_RECOIL, BOUNCE, BUMP_SPEED, PUSH,
  CARAPACE_ARMOUR, MANDIBLE_ARC, SPILL_MAX, STARTER_GENOME3, STARTER_LIBRARY3, T3_METABOLISM_BASE,
  T3_METABOLISM_RATE, T3_SPAWN_MASS, TIER3, COCOON_TIME, evolveDnaOf, EGG_TIME, MATE_DISTANCE,
  MATE_PREFIX, MATE_SPEED, MATE_TIMEOUT, isMate, DEFAULT_RADII_OF, MAX_SEGMENTS, MIN_SEGMENTS, PLANS_OF, SEGMENT_MAX, SEGMENT_MIN,
  cleanForm, MAX_ARM, RADIAL_ARMS, MAX_BEND, maxPlacedOf, ALGAE_MASS, ALGAE_RATE, CHUNK_MASS, ENGULF_RATIO, ENGULF_SHARE, SEEP_ALGAE, STARTER_GENOME2, STARTER_LIBRARY2,
  T2_METABOLISM_BASE, T2_METABOLISM_RATE, TIER2, MAX_TIER, MAX_MOUTHS, MOUTH_PARTS, VIRUS_SWARM, catalogFor, massCapOf,
  CHILD_PRICE, CYST_TIME, KILL_DNA_SHARE, PLASMID_DNA, Lineage, MAX_CHILDREN, MAX_PARTS, PACKET_DNA, Part,
  STARTER_CHILDREN, STARTER_LIBRARY, cleanName, randomSpeciesName, copiesOf, defaultParts, priceOf, stack, withCopies,
  Cloud, INK, REGEN_DELAY, T6SS_DPS, TOXINS, cloudDps, cloudRadius, contactFactor, healthMaxOf, toxinFactor,
  CAPSULE_PHAGE_BLOCK, GENES, GENE_NAMES, PHAGE_BURST, PHAGE_CLEARANCE, PHAGE_DPS, PHAGE_LATENT, PHAGE_RATE,
  PLASMID_RATE, TRANSFORM_CHANCE, PLASMID_UNLOCK_CHANCE, CYANO_MASS, CYANO_RATE, HYPHA_MASS, HYPHA_RATE, SPIRULINA_MASS, SPIRULINA_RATE, DIATOM_MASS,
  DIATOM_RATE, DINOFLAGELLATE_MASS, DINOFLAGELLATE_RATE, MACROALGA_MASS, MACROALGA_RATE, ALGA_BITES, ALGA_BITE_INTERVAL, PLANT_TIER, BACKGROUND_RATE, DEBRIS_MASS, DEBRIS_SHARE, EXOENZYME_YIELD, HEALTH_MAX,
  HEALTH_REGEN, MASS_CAP, METABOLISM_BASE, METABOLISM_RATE, MIN_MASS, NUTRIENT_CAP, NUTRIENT_LIFETIME, NUTRIENT_MASS, Nutrient, NutrientKind, Player,
  type Gene, type PoolState, SEEP_COUNT, SEEP_LIFETIME, SEEP_RATE, SEEP_SPREAD, SIDEROPHORE_REACH, SPAWN_MASS, STARTER_GENOME,
  EXOSKELETON_ARMOUR, SHELL_ARMOUR, STARTER_GENOME4, STARTER_LIBRARY4, T4_METABOLISM_BASE, T4_METABOLISM_RATE, TIER4,
  GENOME_FIELD, grazes4, hunts4, isAnimal, spawnMassOf,
  FAULT_SPAWN, WALL_ALGA_RATE, RIM_MIN, rimAt, keepInPool, insidePool, randomInPool, randomInFault, MOUTH_OUT, MOUTH_REACH, BOT_SPECIES, DEFAULT_SEGMENTS, animalRim, animalNormal, segmentsOf, EUK_MOUTH, SPAWN_GRACE, STARVE_DPS, Seep, TICK_DT, ownGenome, TICK_RATE, TRANSPORTER_YIELD, WORLD_RADIUS, drift, hasGene, radiusOf, upkeepOf,
  hasBit, withBit, FILTER_YIELD, GEN_DNA, LOCAL_FOOD_RATE, LOCAL_PLASMID_RATE, LOCAL_RING, speedOf,
} from '@panspermia/shared';
import { buildGrid, grids, near } from './grid.ts';

/** Uniform random point in a disc of radius `r` centred on the origin. */
function randomInDisc(r: number) {
  const angle = Math.random() * 2 * Math.PI;
  const d = r * Math.sqrt(Math.random());
  return { x: d * Math.cos(angle), y: d * Math.sin(angle) };
}

/**
 * Where a new individual of a tier appears: anywhere in the water, clear of the shore by its newborn size — and a
 * bacterium, more often than not, deep in one of the shore's faults, out of reach of the big filter feeders (user).
 */
export function spawnPointFor(tier: number) {
  if (tier === 1 && Math.random() < FAULT_SPAWN) return randomInFault();
  return randomInPool(radiusOf(spawnMassOf(tier), tier) + 40);
}
/** A fresh individual; pass the current tick to shield it for SPAWN_GRACE (tests usually don't). */
export const spawnPlayer = (tick?: number) => new Player({
  graceUntil: tick === undefined ? 0 : tick + SPAWN_GRACE * TICK_RATE,
  ...spawnPointFor(1),
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

/**
 * Fights span one tier either way (roadmap rule): the weapons of a cell two or more tiers smaller can't harm a body
 * (a bacterium's toxins, a ciliate's spikes don't pierce a crayfish). Parasites still drain big hosts' energy.
 */
const outranks = (victim: Player, attackerTier: number) => victim.tier - attackerTier >= 2;

/** Dormant cells (endospore, division cyst, cocoon) neither eat, fight, metabolize nor take damage. */
const dormant = (p: Player) => p.spore > 0 || p.cyst > 0 || p.cocoon > 0;

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
      const far = 2 * radiusOf(p.mass, p.tier) + MATE_DISTANCE; // two grown animals touch ~620 apart
      const at = { x: p.x + Math.cos(a) * far, y: p.y + Math.sin(a) * far };
      keepInPool(at, radiusOf(p.mass, p.tier)); // in the water
      state.players.set(mid, new Player({
        name: p.name, shape: p.shape, tier: p.tier, genome3: p.genome3, genome4: p.genome4, mass: p.mass, health: healthMaxOf(0, p.tier),
        x: at.x, y: at.y, heading: a + Math.PI, graceUntil: 0xffffffff, tumble: 0, rng: 1, genome: 0,
      }));
      continue;
    }
    p.call += TICK_DT;
    const dx = p.x - m.x;
    const dy = p.y - m.y;
    const d = Math.hypot(dx, dy);
    if (d < radiusOf(p.mass, p.tier) + radiusOf(m.mass, m.tier) || p.call > MATE_TIMEOUT) {
      gone.push(mid);
      p.call = 0;
      p.cyst = CYST_TIME; // mated: shielded while the player edits the next generation
      earn(state, id, GEN_DNA[p.tier] ?? 0); // a generation raised: the animals' DNA, with kills
      continue;
    }
    const step = Math.min(d, MATE_SPEED * TICK_DT);
    m.x += (dx / d) * step;
    m.y += (dy / d) * step;
    m.heading = Math.atan2(dy, dx);
  }
  for (const id of gone) state.players.delete(id);
}

/**
 * Cells are solid: an overlapping pair pushes apart (the lighter one moves more) and bounces off — unless
 * one can swallow the other (engulfing needs the overlap). Mates and the swallowed pass through.
 * ponytail: O(players²), ~1300 pairs at 50 cells; bucket by grid if counts grow.
 */
function collide(state: PoolState) {
  const cells = [...state.players].filter(([id, p]) => !isMate(id) && !p.engulfedBy).map(([, p]) => p);
  for (let i = 0; i < cells.length; i++) {
    const a = cells[i]!;
    const ra = radiusOf(a.mass, a.tier);
    for (let j = i + 1; j < cells.length; j++) {
      const b = cells[j]!;
      const reach = ra + radiusOf(b.mass, b.tier);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue;
      const d2 = dx * dx + dy * dy;
      if (!(d2 < reach * reach) || (a.tier === 2 && swallows(a, b)) || (b.tier === 2 && swallows(b, a))) continue; // NaN-safe
      const d = Math.sqrt(d2);
      const [nx, ny] = d > 1e-6 ? [dx / d, dy / d] : [1, 0];
      const overlap = reach - d;
      const wa = b.mass / (a.mass + b.mass); // a's share of the response
      const wb = 1 - wa;
      a.x -= nx * overlap * PUSH * wa;
      a.y -= ny * overlap * PUSH * wa;
      b.x += nx * overlap * PUSH * wb;
      b.y += ny * overlap * PUSH * wb;
      // Reflect the closing speed, plus a kick that grows with the overlap: a felt bounce.
      const closing = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      const impulse = (closing < 0 ? -(1 + BOUNCE) * closing : 0) + BUMP_SPEED * Math.min(1, overlap / Math.min(ra, reach - ra));
      a.vx -= nx * impulse * wa;
      a.vy -= ny * impulse * wa;
      b.vx += nx * impulse * wb;
      b.vy += ny * impulse * wb;
    }
  }
}

/** A mouthpart in the world: where it is, how far it takes things in, which gene. */
interface MouthPoint { x: number; y: number; r: number; gene: string }
/** Mouthpart layouts in cell radii (body frame), by design: reused tick after tick. */
const mouthLayouts = new Map<string, { x: number; y: number; reach: number; gene: string }[]>();
/**
 * Where an animal's mouthparts are now: each placed mouthpart on the body's outline, turned with its heading.
 * `sucker`: its parasitic mouth instead (a stylet, a proboscis), which drains only what it touches.
 */
function mouthPointsOf(state: PoolState, id: string, p: Player, sucker = false): MouthPoint[] {
  const cat = catalogFor(p.tier);
  const genome = ownGenome(p);
  const l = state.lineages.get(id);
  const designed = l && l.tier === p.tier && l.genome === genome;
  const bot = !l ? BOT_SPECIES.find((s) => s.tier === p.tier && s.name === p.name) : undefined;
  const key = (sucker ? 's' : '') + (designed
    ? `${p.tier}|${[...l.parts].map((q) => `${q.gene},${q.angle.toFixed(2)},${q.x.toFixed(2)},${q.y.toFixed(2)},${q.scale}`).join(';')}|${l.plan}|${[...l.radii].join(',')}|${[...l.bends].join(',')}|${l.arms}`
    : `${p.tier}|${genome}|${bot?.name ?? ''}`);
  let layout = mouthLayouts.get(key);
  if (!layout) {
    const parts = designed ? [...l.parts].map((q) => ({ gene: cat.NAMES[q.gene]!, x: q.x, y: q.y, angle: q.angle, scale: q.scale })) : cat.defaultParts(genome);
    const segments = designed && l.radii.length ? segmentsOf(l.plan, [...l.radii], [...l.bends], l.arms)
      : bot?.radii ? segmentsOf(bot.plan ?? 0, bot.radii) : DEFAULT_SEGMENTS;
    const isMouth = (gene: string) => (sucker ? gene === PARASITES[p.tier]?.gene : !!MOUTHS[p.tier]?.[gene]);
    layout = parts.filter((q) => isMouth(q.gene)).map((q) => {
      const m: Partial<Mouth> = sucker ? {} : MOUTHS[p.tier]![q.gene]!;
      const reach = (m.reach ?? MOUTH_REACH) * q.scale;
      if (cat.GENES[q.gene]!.slot !== 'membrane') return { x: q.x, y: q.y, reach, gene: q.gene };
      // On the outline, then out along its normal there (where the part is drawn).
      const [rim, normal, out] = [animalRim(q.angle, segments), animalNormal(q.angle, segments), (m.out ?? MOUTH_OUT) * q.scale];
      return { x: Math.cos(q.angle) * rim + Math.cos(normal) * out, y: Math.sin(q.angle) * rim + Math.sin(normal) * out, reach, gene: q.gene };
    });
    if (mouthLayouts.size > 500) mouthLayouts.clear();
    mouthLayouts.set(key, layout);
  }
  const r = radiusOf(p.mass, p.tier);
  const [c, s] = [Math.cos(p.heading), Math.sin(p.heading)];
  return layout.map((m) => ({ x: p.x + (m.x * c - m.y * s) * r, y: p.y + (m.x * s + m.y * c) * r, r: m.reach * r, gene: m.gene }));
}
/** The best a packet is worth to the mouthparts it touches (0: none touches it, or none takes it); filters take `sieve` of it. */
function mouthFood(mouths: MouthPoint[], tier: number, n: { x: number; y: number; kind: number }, sieve: number) {
  let best = 0;
  for (const m of mouths) {
    const mouth = MOUTHS[tier]![m.gene]!;
    if ((n.x - m.x) ** 2 + (n.y - m.y) ** 2 < m.r * m.r) best = Math.max(best, mouth.food(n.kind) * (mouth.filter ? sieve : 1));
  }
  return best;
}
/** What a filter mouth takes now: FILTER_YIELD × the body's own swim speed (current excluded) over its full speed. Idle: nothing. */
export const sieveOf = (p: Player) => FILTER_YIELD * Math.min(1, Math.hypot(p.vx, p.vy) / speedOf(p.mass, p.tier));

const RIM_MIN_2 = RIM_MIN * RIM_MIN;

/** Parasitic mouths by tier: the gene, what it may drain (a bigger host, or any of a bigger tier), how fast, what it keeps. */
const PARASITES: Readonly<Record<number, { gene: string; host: (h: Player, p: Player) => boolean; rate: number; share: number }>> = {
  1: { gene: 'adhesin', host: (h) => h.tier >= 2, rate: ADHESIN_DRAIN, share: ADHESIN_SHARE },
  2: { gene: 'peduncle', host: (h, p) => h.tier > 2 || (h.tier === 2 && h.mass > p.mass), rate: PEDUNCLE_DRAIN, share: PARASITE_SHARE },
  3: { gene: 'stylet', host: (h, p) => h.tier > 3 || (h.tier === 3 && h.mass > p.mass), rate: STYLET_DRAIN, share: PARASITE_SHARE },
  4: { gene: 'proboscis', host: (h) => h.tier === 4, rate: PROBOSCIS_DRAIN, share: PARASITE_SHARE },
};

/** A mouth that bites (and swallows): a eukaryote's jaw, an animal's mandibles, an arthropod's claws or a mollusk's beak. */
export const bitesWith = (p: Player) => p.tier === 2 ? TIER2.hasGene(p.genome2, 'jaw') : p.tier === 3 ? TIER3.hasGene(p.genome3, 'mandible')
  : p.tier === 4 && hunts4(p.genome4);
/** Share of a bite's damage that gets through: a carapace, an exoskeleton, a shell; a bacterium's thick wall. */
function armourOf(v: Player) {
  if (v.tier === 2) return TIER2.hasGene(v.genome2, 'theca') ? THECA_ARMOUR : 1;
  if (v.tier === 3) return TIER3.hasGene(v.genome3, 'carapace') ? CARAPACE_ARMOUR : 1;
  if (v.tier === 4) return TIER4.hasGene(v.genome4, 'shell') ? SHELL_ARMOUR : TIER4.hasGene(v.genome4, 'exoskeleton') ? EXOSKELETON_ARMOUR : 1;
  return contactFactor(v.genome);
}

/**
 * Spore-style bites: a jaw (eukaryote), mandibles (animal), claws or a beak (tier 4) bite the nearest cell in front that is too big
 * to swallow, every BITE_INTERVAL: damage, a torn-off chunk of meat, the victim knocked away and the biter
 * recoiling. `bites` counts up so clients can snap the mouthparts.
 */
function bite(state: PoolState, tick: number) {
  for (const [aid, a] of state.players) {
    a.biteCooldown = Math.max(0, a.biteCooldown - TICK_DT);
    if (!bitesWith(a) || a.biteCooldown > 0 || dormant(a) || a.engulfedBy || isMate(aid)) continue;
    const ra = radiusOf(a.mass, a.tier);
    let target: { vid: string; v: Player; d: number; dx: number; dy: number } | undefined;
    for (const [vid, v] of state.players) {
      if (vid === aid || isMate(vid) || dormant(v) || v.engulfedBy || tick < v.graceUntil || swallows(a, v) || outranks(v, a.tier)) continue;
      const dx = v.x - a.x;
      const dy = v.y - a.y;
      const d = Math.hypot(dx, dy);
      if (!(d < ra * (1 + BITE_REACH) + radiusOf(v.mass, v.tier)) || d >= (target?.d ?? Infinity)) continue;
      if (Math.abs(wrapAngle(Math.atan2(dy, dx) - a.heading)) < MANDIBLE_ARC) target = { vid, v, d, dx, dy };
    }
    if (!target) continue;
    const { vid, v, d } = target;
    const nx = d > 1e-6 ? target.dx / d : Math.cos(a.heading);
    const ny = d > 1e-6 ? target.dy / d : Math.sin(a.heading);
    const claws = a.tier === 4 ? Math.max(1, stack(TIER4.copiesOf(a.genome4, 'claw'))) : 1; // a second claw crushes harder
    const small = v.tier > a.tier ? SMALLER_BITE : 1; // small jaws on a bigger body
    const dealt = BITE_DAMAGE[a.tier]! * claws * small * armourOf(v);
    hurt(v, dealt, aid, tick);
    const cerata = v.tier === 4 ? TIER4.copiesOf(v.genome4, 'cerata') : 0; // stolen stinging cells fire back
    if (cerata) hurt(a, dealt * CERATA_REFLECT * stack(cerata), vid, tick);
    // A torn-off bit of the victim, at the wound: food for whoever grabs it first.
    const torn = Math.min(v.tier >= 2 ? CHUNK_MASS : DEBRIS_MASS, v.mass - minMassOf(v.tier));
    if (torn > 0) {
      v.mass -= torn;
      const rv = radiusOf(v.mass, v.tier);
      spawnNutrient(state, v.x - nx * rv * 0.8, v.y - ny * rv * 0.8, v.tier >= 2 ? NutrientKind.chunk : NutrientKind.debris);
    }
    const knock = BITE_KNOCK * Math.min(2, Math.sqrt(a.mass / v.mass));
    const recoil = BITE_RECOIL * Math.min(1, Math.sqrt(v.mass / a.mass));
    const grip = v.tier === 3 && TIER3.hasGene(v.genome3, 'lobopods') ? LOBOPOD_GRIP : 1; // clawed legs hold on
    v.vx += nx * knock * grip;
    v.vy += ny * knock * grip;
    a.vx -= nx * recoil;
    a.vy -= ny * recoil;
    a.bites = (a.bites + 1) & 255;
    a.biteCooldown = BITE_INTERVAL;
  }
}

/** DNA bots would have earned (they have no lineage): the balance sim reads it. Weak: a dead cell is a new Player. */
export const botDna = new WeakMap<Player, number>();
/** A tier-4 grazer bites a macroalga at most once per ALGA_BITE_INTERVAL: the tick of its next bite. */
const nextAlgaBite = new WeakMap<Player, number>();
/** DNA to a lineage (bots have none). */
function earn(state: PoolState, id: string, dna: number) {
  const l = state.lineages.get(id);
  if (!l) {
    const p = state.players.get(id);
    if (p) botDna.set(p, (botDna.get(p) ?? 0) + dna);
    return;
  }
  l.dna += dna;
  l.lifetimeDna += dna;
}

/** Make a fresh individual one of `tier`, expressing `genome` (that tier's catalog), at its newborn size. */
export function embody(p: Player, tier: number, genome: number) {
  if (tier >= 2) Object.assign(p, { tier, genome: 0, mass: spawnMassOf(tier), health: healthMaxOf(0, tier) });
  p[GENOME_FIELD[tier] ?? 'genome'] = genome;
  return p;
}

/** How long a new animal of a tier lies in its egg clutch (plankton) or cocoon (animals) before it moves. */
const incubationOf = (tier: number) => (tier === 3 ? EGG_TIME : tier === 4 ? COCOON_TIME : 0);

/**
 * The lineage's next individual: its tier, design and name — where the parent divided, or anywhere. An animal begins
 * life as eggs or a cocoon (user direction: even the first one, and after a death), unless it is emerging from one now
 * or opening the stage-up editor (`incubate` false).
 */
function nextOf(l: Lineage, tick: number, at?: { x: number; y: number; heading: number }, incubate = true) {
  const p = embody(spawnPlayer(tick), l.tier, l.genome);
  p.name = l.name;
  p.shape = l.shape;
  Object.assign(p, spawnPointFor(l.tier), at); // its tier's spawn spot (a bacterium: often a fault), unless placed
  if (incubate) p.cocoon = incubationOf(l.tier);
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

/**
 * Editing done. Cells divide: a child with the lineage's current design takes over where the parent divided.
 * Plankton turn into an egg clutch and animals spin a cocoon: the parent itself, shielded and still, until the new
 * design hatches or emerges. A stage-up cyst (just evolved) hatches as the designed individual — in its eggs or cocoon.
 */
export function hatch(state: PoolState, id: string) {
  const parent = state.players.get(id);
  const l = state.lineages.get(id);
  if (!parent || !l) return;
  drafts.delete(l);
  if (parent.evolving) {
    state.players.set(id, nextOf(l, state.tick, { x: parent.x, y: parent.y, heading: parent.heading }));
    return;
  }
  if (isAnimal(parent.tier) && l.tier === parent.tier) {
    parent.cyst = 0;
    parent.cocoon = incubationOf(parent.tier);
    l.generation++;
    return;
  }
  l.generation++;
  state.players.set(id, nextOf(l, state.tick, { x: parent.x, y: parent.y, heading: parent.heading }));
}

interface Design {
  genome: number; placed: Part[]; hue: number; shape: number; children: number; name: string; evolve: boolean; cost: number;
  /** A sculpted shape (Form), or undefined: keep the current one. */
  form?: { sx: number; sy: number; bend: number };
  /** Animals only: body plan and segment sizes (undefined for other tiers). */
  body?: { plan: number; radii: number[]; bends: number[]; arms: number };
}
/** The latest valid draft per lineage, applied if the cyst times out (server-only, never synced). */
const drafts = new WeakMap<Lineage, Design>();

/**
 * Check an untrusted editor design against the lineage: every field is validated. Price = new
 * copies − old copies (removing parts refunds them, as in Spore) + children. Returns why it's refused.
 */
function parseDesign(l: Lineage, design: unknown): Design | string {
  if (typeof design !== 'object' || design === null) return 'bad design';
  const { parts, hue, children, name: rawName, evolve = false, shape = 0, form: rawForm, plan = l.plan,
    radii = l.radii.length ? [...l.radii] : DEFAULT_RADII_OF[l.plan], bends = [...l.bends], arms = l.arms } = design as Record<string, unknown>; // omitted: the current body
  if (typeof shape !== 'number' || !Number.isInteger(shape) || !SHAPES[shape]) return 'bad shape';
  const form = rawForm === undefined ? undefined : cleanForm(rawForm);
  if (rawForm !== undefined && !form) return 'bad form';
  const name = cleanName(rawName);
  if (!name) return 'bad name';
  if (typeof evolve !== 'boolean') return 'bad evolve';
  if (evolve && l.evolved) return 'already on land';
  if (evolve && l.lifetimeDna < evolveDnaOf(l.tier)) return 'not ready to evolve';
  if (!Array.isArray(parts) || parts.length > MAX_PARTS) return 'bad parts';
  if (typeof hue !== 'number' || !(hue >= 0 && hue < 1)) return 'bad hue';
  if (typeof children !== 'number' || !Number.isInteger(children) || children < 0 || l.children + children > MAX_CHILDREN[l.tier]!) {
    return 'bad children';
  }
  let body: Design['body'];
  if (isAnimal(l.tier)) {
    if (typeof plan !== 'number' || !PLANS_OF[l.tier]!.includes(plan)) return 'bad plan';
    if (!Array.isArray(radii) || radii.length < MIN_SEGMENTS || radii.length > MAX_SEGMENTS
      || !radii.every((r) => typeof r === 'number' && r >= SEGMENT_MIN && r <= SEGMENT_MAX)) return 'bad segments';
    if (!Array.isArray(bends) || bends.length > (radii as number[]).length
      || !bends.every((b) => typeof b === 'number' && Math.abs(b) <= MAX_BEND)) return 'bad bends';
    // A radial body: 3–6 arms, each up to MAX_ARM stations (radii = [centre, arm stations…]).
    if (plan === 1 && (typeof arms !== 'number' || !Number.isInteger(arms) || arms < RADIAL_ARMS[0] || arms > RADIAL_ARMS[1]
      || (radii as number[]).length > 1 + MAX_ARM)) return 'bad arms';
    body = { plan, radii: radii as number[], bends: bends as number[], arms: plan === 1 ? (arms as number) : 0 };
  }
  const cat = catalogFor(l.tier);
  let genome = 0;
  let price = 0;
  const counts = new Map<string, number>();
  const placed: Part[] = [];
  for (const part of parts as unknown[]) {
    const { gene, x, y, angle, scale, group } = (part ?? {}) as Record<string, unknown>;
    if (typeof gene !== 'string' || !Object.hasOwn(cat.GENES, gene)) return 'unknown part';
    const g = cat.GENES[gene]!;
    if (!hasBit(l.library, g.bit)) return 'part not unlocked';
    if (typeof x !== 'number' || typeof y !== 'number' || typeof angle !== 'number' || typeof scale !== 'number'
      || !Number.isFinite(angle) || !(Math.hypot(x, y) <= 1.5) || !(scale >= 0.5 && scale <= 2)
      || typeof group !== 'number' || !Number.isInteger(group) || group < 0 || group > 255) {
      return 'bad placement';
    }
    const n = (counts.get(gene) ?? 0) + 1;
    if (n > maxPlacedOf(gene, g.slot)) return 'too many copies';
    counts.set(gene, n);
    genome = cat.withCopies(genome, gene, Math.min(n, g.maxCopies)); // effect stacks up to maxCopies
    price += g.price; // every placement is paid for
    placed.push(new Part({ gene: g.index, x, y, angle, scale, group }));
  }
  const mouths = MOUTH_PARTS[l.tier] ?? [];
  if (placed.filter((p) => mouths.includes(cat.NAMES[p.gene]!)).length > MAX_MOUTHS) return `at most ${MAX_MOUTHS} mouthparts`;
  // Removing parts refunds them, as in Spore: the price is the new placements' minus the current design's.
  const current = [...l.parts].reduce((sum, p) => sum + (cat.GENES[cat.NAMES[p.gene]!]?.price ?? 0), 0);
  const cost = price - current + children * CHILD_PRICE[l.tier]!;
  if (cost > l.dna) return 'not enough DNA';
  return { genome, placed, hue, shape, form, children, name, evolve, cost, body };
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
  if (!d.evolve) {
    hatch(state, id);
    return undefined;
  }
  if (l.tier >= MAX_TIER) { // an animal walks onto land: the game is won (the client shows it); this one still hatches
    l.evolved = true;
    hatch(state, id);
    return undefined;
  }
  // Evolving: the next individual is of the new tier, born into the editor (still shielded) to design it.
  evolve(l);
  drafts.delete(l); // a draft of the old tier's design means nothing to the new body
  l.generation++;
  state.players.set(id, Object.assign(nextOf(l, state.tick, { x: p.x, y: p.y, heading: p.heading }, false), { cyst: CYST_TIME, evolving: true }));
  return undefined;
}

/** Spore's "Grow legs?": from the next generation on, the species is a nude body of the next tier (its starter parts unlocked). */
function evolve(l: Lineage) {
  const [genome, library] = l.tier === 1 ? [STARTER_GENOME2, STARTER_LIBRARY2] : l.tier === 2 ? [STARTER_GENOME3, STARTER_LIBRARY3]
    : [STARTER_GENOME4, STARTER_LIBRARY4];
  l.tier++;
  const cat = catalogFor(l.tier);
  // The first individual of the new phase is nude — just the body, round, sculpted from scratch (user direction) —
  // and the species gets the old starter design's price to build it with.
  l.genome = 0;
  l.parts.clear();
  l.dna += cat.priceOf(genome);
  Object.assign(l, { shape: 0, sx: 0, sy: 0, bend: 0 });
  l.library = library; // the old tier's parts mean nothing to the new body plan
  if (isAnimal(l.tier)) {
    l.plan = PLANS_OF[l.tier]![0]!;
    l.radii.clear();
    l.radii.push(...DEFAULT_RADII_OF[l.plan]!);
    l.bends.clear();
    l.arms = 0;
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
  if (d.form) Object.assign(l, { sx: d.form.sx, sy: d.form.sy, bend: d.form.bend });
  l.children += d.children;
  if (d.body) {
    l.plan = d.body.plan;
    l.radii.clear();
    l.radii.push(...d.body.radii);
    l.bends.clear();
    l.bends.push(...d.body.bends);
    l.arms = d.body.arms;
  }
}

/** A meteor shard carrying one random tier-2 part (Spore's meteor bits); an animal draws a part of its own tier instead. */
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
  p: { mass: number; health: number; genome: number; genome2?: number; genome3?: number; genome4?: number; tier?: number }, dt: number, regen = true,
) {
  const tier = p.tier ?? 1;
  const genome2 = p.genome2 ?? 0;
  const floor = minMassOf(tier);
  // Mitochondria make metabolism cheaper; thylakoids / chloroplasts make mass from light.
  const burn = tier === 4 ? (T4_METABOLISM_BASE + T4_METABOLISM_RATE * p.mass) * (1 - GILL_METABOLISM * stack(TIER4.copiesOf(p.genome4 ?? 0, 'gills')))
      + TIER4.upkeepOf(p.genome4 ?? 0)
    : tier === 3 ? (T3_METABOLISM_BASE + T3_METABOLISM_RATE * p.mass) * (1 - OIL_METABOLISM * stack(TIER3.copiesOf(p.genome3 ?? 0, 'oil')))
      + TIER3.upkeepOf(p.genome3 ?? 0)
    : tier === 2
      ? (T2_METABOLISM_BASE + T2_METABOLISM_RATE * p.mass) * (1 - MITO_METABOLISM * stack(TIER2.copiesOf(genome2, 'mitochondrion')))
        + TIER2.upkeepOf(genome2)
      : METABOLISM_BASE + METABOLISM_RATE * p.mass + upkeepOf(p.genome);
  const light = tier >= 3 ? 0 : tier === 2 ? CHLOROPLAST_RATE * stack(TIER2.copiesOf(genome2, 'chloroplast'))
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
    if (toxin.tier !== p.tier || kind === INK) continue; // ink comes with the dash (see squirtInk)
    const genome = ownGenome(p);
    const power = stack(catalogFor(p.tier).copiesOf(genome, toxin.gene)); // more copies: stronger cloud, dearer
    if (!power || p.mass - toxin.cost * power < minMassOf(p.tier)) continue;
    p.mass -= toxin.cost * power;
    p.toxinCooldown = Math.max(p.toxinCooldown, toxin.cooldown);
    const ahead = radiusOf(p.mass, p.tier) * toxin.at; // poison is left behind, harpoons shot in front
    const x0 = Math.fround(p.x + Math.cos(p.heading) * ahead);
    const y0 = Math.fround(p.y + Math.sin(p.heading) * ahead);
    state.clouds.set(`c${nextCloudId++}`, new Cloud({ x0, y0, tick0: state.tick, kind, owner: id, power, x: x0, y: y0, tick: state.tick }));
  }
}

/** A mollusk's ink squirt: a big harmless cloud around its rear as its dash starts (it jets out of it). */
export function squirtInk(state: PoolState, id: string) {
  const p = state.players.get(id);
  if (!p) return;
  const back = radiusOf(p.mass, p.tier) * 0.3;
  const x0 = Math.fround(p.x - Math.cos(p.heading) * back);
  const y0 = Math.fround(p.y - Math.sin(p.heading) * back);
  state.clouds.set(`c${nextCloudId++}`, new Cloud({ x0, y0, tick0: state.tick, kind: INK, owner: id, x: x0, y: y0, tick: state.tick }));
}

/** Whether a point is hidden inside someone else's ink (bots can't see into it). */
export function inInk(state: PoolState, x: number, y: number, viewer: string) {
  for (const c of state.clouds.values()) {
    if (c.kind !== INK || c.owner === viewer) continue;
    const r = cloudRadius(INK, (state.tick - c.tick0) * TICK_DT);
    if ((c.x - x) ** 2 + (c.y - y) ** 2 < r * r) return true;
  }
  return false;
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
  /** A kill: where the victim died, its size, and what the killer took from it (energy if swallowed, DNA). */
  feast?: { x: number; y: number; r: number; energy: number; dna: number };
}

/** A multiplier gene's effect with `copies` stacked: 1 + (base − 1)·stack(copies). */
const boost = (base: number, copies: number) => 1 + (base - 1) * stack(copies);

/** What one packet is worth to a bacterium with this genome, in mass. DNA, phages and algae aren't its food. */
export function yieldOf(kind: number, genome: number) {
  if (kind === NutrientKind.debris) return DEBRIS_MASS * boost(EXOENZYME_YIELD, copiesOf(genome, 'exoenzymes'));
  if (kind === NutrientKind.chunk) return CHUNK_MASS * boost(EXOENZYME_YIELD, copiesOf(genome, 'exoenzymes')); // decomposers
  if (kind === NutrientKind.dissolved) return NUTRIENT_MASS * boost(TRANSPORTER_YIELD, copiesOf(genome, 'transporters'));
  if (kind === NutrientKind.hypha) return HYPHA_MASS; // the one plant small enough for a bacterium
  return 0;
}

export const reachOf = (mass: number, genome: number) =>
  radiusOf(mass) * boost(SIDEROPHORE_REACH, copiesOf(genome, 'siderophores'));

/** Mass of each plant a plant mouth takes (from PLANT_TIER's phase on). */
const PLANT_MASS: Readonly<Record<number, number>> = {
  [NutrientKind.algae]: ALGAE_MASS, [NutrientKind.cyano]: CYANO_MASS, [NutrientKind.hypha]: HYPHA_MASS,
  [NutrientKind.spirulina]: SPIRULINA_MASS, [NutrientKind.diatom]: DIATOM_MASS,
  [NutrientKind.dinoflagellate]: DINOFLAGELLATE_MASS, [NutrientKind.macroalga]: MACROALGA_MASS, [NutrientKind.wallAlga]: MACROALGA_MASS,
};
/** Plant packets: too big for a bacterium (algae and everything grazed like them). */
const isPlant = (kind: number) => kind in PLANT_MASS;
/**
 * What a packet is worth to a mouth of `tier` that takes plant food (dissolved, algae and the other plants) and/or meat
 * (debris, chunks). A plant too big for the tier is left alone.
 */
function mouthYield(kind: number, plant: boolean, meat: boolean, tier: number) {
  if (plant && isPlant(kind)) return tier >= (PLANT_TIER[kind] ?? 2) ? PLANT_MASS[kind]! : 0;
  if (plant && kind === NutrientKind.dissolved) return NUTRIENT_MASS;
  if (meat && kind === NutrientKind.chunk) return CHUNK_MASS;
  if (meat && kind === NutrientKind.debris) return DEBRIS_MASS;
  return 0;
}
/** The plants a mastax grinds better than any sieve. */
const BIG_PLANTS = new Set<number>([NutrientKind.spirulina, NutrientKind.diatom, NutrientKind.dinoflagellate, NutrientKind.macroalga]);
/** An animal's own plants: the big ones (an animal leaves the floating bits — motes, algae, filaments — to the small). */
/**
 * Each animal mouthpart: what a packet touching it is worth, and the tiers of the cells it can swallow (by mass, see
 * swallows). Plankton: sieves take plant food and filter combs bacteria, a mastax grinds big plants better, mandibles
 * take meat and single cells. Animals (user direction): grazing mouths take the big plants, predators' claws and beaks
 * swallow plankton — never bacteria nor the floating food bits.
 */
/** `out`, `reach`: where the mouth sits beyond the outline and how far it takes things in (cell radii; MOUTH_OUT, MOUTH_REACH). */
interface Mouth { food: (kind: number) => number; swallows: readonly number[]; out?: number; reach?: number; filter?: true }
const plant3 = (kind: number) => mouthYield(kind, true, false, 3);
const MAXILLA_PLANTS = new Set<number>([NutrientKind.diatom, NutrientKind.dinoflagellate]);
const RADULA_PLANTS = new Set<number>([NutrientKind.diatom, NutrientKind.macroalga, NutrientKind.wallAlga]);
const grazeOn = (plants: ReadonlySet<number>) => (kind: number) => (plants.has(kind) ? PLANT_MASS[kind]! : 0);
export const MOUTHS: Readonly<Record<number, Readonly<Record<string, Mouth>>>> = {
  3: {
    filterComb: { food: plant3, swallows: [1], filter: true },
    oars: { food: plant3, swallows: [], filter: true },
    mastax: { food: (k) => plant3(k) * (BIG_PLANTS.has(k) ? MASTAX_YIELD : 1), swallows: [] },
    mandible: { food: (k) => mouthYield(k, false, true, 3), swallows: [1, 2] },
  },
  4: {
    // Two grazers, two diets (user direction): maxillae nibble the drifting single cells, a radula rasps seaweed (and diatoms).
    maxillae: { food: (k) => grazeOn(MAXILLA_PLANTS)(k) * MAXILLA_YIELD, swallows: [] },
    radula: { food: grazeOn(RADULA_PLANTS), swallows: [] },
    claw: { food: () => 0, swallows: [3] },
    beak: { food: () => 0, swallows: [3] },
    // Tentacles reach far: a jellyfish's filter for the eukaryotes drifting in, a polyp's stinging crown for plankton too.
    filterTentacles: { food: () => 0, swallows: [2], out: 0.5, reach: 0.7, filter: true },
    polypTentacles: { food: () => 0, swallows: [2, 3], out: 0.4, reach: 0.55 },
  },
};
/** The mouths a design carries, memoized by tier and genome (asked per packet and per pair: the hot path). */
const mouthMemo = [0, 1, 2, 3, 4].map(() => new Map<number, Mouth[]>()); // per tier, by genome (genomes reach 2^52)
const mouthsIn = (tier: number, genome: number) => {
  const memo = mouthMemo[tier] ?? new Map<number, Mouth[]>();
  let m = memo.get(genome);
  if (!m) memo.set(genome, (m = Object.entries(MOUTHS[tier] ?? {}).filter(([g]) => catalogFor(tier).copiesOf(genome, g) > 0).map(([, x]) => x)));
  return m;
};
/** What one packet is worth to an animal: the best of its mouthparts. */
export const yield3Of = (kind: number, genome3: number) => Math.max(0, ...mouthsIn(3, genome3).map((m) => m.food(kind)));
export const yield4Of = (kind: number, genome4: number) => Math.max(0, ...mouthsIn(4, genome4).map((m) => m.food(kind)));
/** What one packet is worth to a eukaryote or bigger, by its tier's mouths. */
export const mouthYieldOf = (kind: number, p: Player) =>
  p.tier === 4 ? yield4Of(kind, p.genome4) : p.tier === 3 ? yield3Of(kind, p.genome3) : yield2Of(kind, p.genome2);

/**
 * Whether `e` can swallow `v` whole (by mass; contact is checked by the caller): a eukaryote's jaw or an
 * animal's mandibles take any smaller-tier or rival cell up to ENGULF_RATIO of the eater; filter combs only
 * sweep up bacteria.
 */
export function swallows(e: Player, v: Player) {
  if (v.tier === 3 && TIER3.hasGene(v.genome3, 'spines') && e.mass < v.mass * SPINE_GAPE) return false; // too wide to get down
  const pallium = e.tier === 2 && TIER2.hasGene(e.genome2, 'pallium'); // wraps bigger prey than a jaw
  if (v.mass > e.mass * (pallium ? PALLIUM_RATIO : ENGULF_RATIO)) return false;
  if (e.tier === 2) return pallium || TIER2.hasGene(e.genome2, 'jaw');
  // Animals swallow with the mouthparts that take that tier (MOUTHS); a rival of their own tier is a fight, never a mouthful.
  return isAnimal(e.tier) && mouthsIn(e.tier, ownGenome(e)).some((m) => m.swallows.includes(v.tier));
}

/**
 * What one packet is worth to a eukaryote, by mouth: a filter takes plant food (dissolved, algae), a jaw
 * takes meat (debris, chunks); 0 means it can't take it in.
 */
export const yield2Of = (kind: number, genome2: number) => {
  const filters = TIER2.copiesOf(genome2, 'filter');
  const jaws = Math.max(TIER2.copiesOf(genome2, 'jaw'), TIER2.copiesOf(genome2, 'pallium'));
  // More mouths take more of each packet, linearly (stack).
  return Math.max(mouthYield(kind, filters > 0, false, 2) * stack(filters), mouthYield(kind, false, jaws > 0, 2) * stack(jaws));
};


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
    const at = randomInPool();
    spawnNutrient(state, at.x, at.y, NutrientKind.algae);
  }
  if (Math.random() < BACKGROUND_RATE * TICK_DT) {
    const at = randomInPool();
    spawnNutrient(state, at.x, at.y, NutrientKind.dissolved);
  }
  for (const [kind, rate] of [
    [NutrientKind.cyano, CYANO_RATE], [NutrientKind.hypha, HYPHA_RATE], [NutrientKind.spirulina, SPIRULINA_RATE],
    [NutrientKind.diatom, DIATOM_RATE], [NutrientKind.dinoflagellate, DINOFLAGELLATE_RATE], [NutrientKind.macroalga, MACROALGA_RATE],
  ] as const) {
    if (Math.random() < rate * TICK_DT) {
      const at = randomInPool();
      spawnNutrient(state, at.x, at.y, kind);
    }
  }
  if (Math.random() < WALL_ALGA_RATE * TICK_DT) { // seaweed taking hold on the rock, its holdfast at the shore
    const a = Math.random() * 2 * Math.PI;
    const d = rimAt(a) - 120;
    spawnNutrient(state, Math.cos(a) * d, Math.sin(a) * d, NutrientKind.wallAlga);
  }
  if (Math.random() < PLASMID_RATE * TICK_DT) {
    const at = randomInPool();
    spawnPlasmid(state, at.x, at.y);
  }
  if (Math.random() < SHARD_RATE * TICK_DT) {
    const at = randomInPool();
    spawnShard(state, at.x, at.y);
  }
  // Around every bacterium, food and plasmids appear (phase 1 was a void).
  for (const p of state.players.values()) {
    if (p.tier !== 1) continue;
    for (const [rate, plasmid] of [[LOCAL_FOOD_RATE, false], [LOCAL_PLASMID_RATE, true]] as const) {
      if (Math.random() >= rate * TICK_DT) continue;
      const a = Math.random() * 2 * Math.PI;
      const d = LOCAL_RING[0] + Math.random() * (LOCAL_RING[1] - LOCAL_RING[0]);
      const [x, y] = [p.x + Math.cos(a) * d, p.y + Math.sin(a) * d];
      if (!insidePool(x, y)) continue;
      if (plasmid) spawnPlasmid(state, x, y);
      else spawnNutrient(state, x, y, NutrientKind.dissolved);
    }
  }
  // Wild viruses: phages (bacteria) and giant viruses (eukaryotes), never right on top of a cell.
  // ponytail: a crowded pool skips the spawn instead of searching for room; viruses still burst from the infected.
  for (const [kind, rate] of [[NutrientKind.phage, PHAGE_RATE], [NutrientKind.virus, VIRUS_RATE]] as const) {
    if (Math.random() >= rate * TICK_DT) continue;
    const centre = randomInPool();
    const clear = PHAGE_CLEARANCE ** 2;
    const n = VIRUS_SWARM.min + Math.floor(Math.random() * (VIRUS_SWARM.max - VIRUS_SWARM.min + 1));
    for (let k = 0; k < n; k++) { // a swarm (user direction: grouped)
      const a = Math.random() * 2 * Math.PI;
      const r = VIRUS_SWARM.spread * Math.sqrt(Math.random());
      const at = { x: centre.x + Math.cos(a) * r, y: centre.y + Math.sin(a) * r };
      if (!insidePool(at.x, at.y)) continue;
      if ([...state.players.values()].every((p) => (p.x - at.x) ** 2 + (p.y - at.y) ** 2 > clear)) spawnNutrient(state, at.x, at.y, kind);
    }
  }

  // Drift food; it dissolves with age or against the rock.
  const expired: string[] = [];
  const live: Nutrient[] = [];
  const liveIds: string[] = [];
  for (const [id, n] of state.nutrients) {
    drift(n, tick);
    // Against the rock: only a packet past the shore's nearest point needs the (costlier) shore lookup.
    if (tick - n.tick0 > NUTRIENT_LIFETIME * TICK_RATE || (n.x * n.x + n.y * n.y > RIM_MIN_2 && !insidePool(n.x, n.y))) expired.push(id);
    else {
      live.push(n);
      liveIds.push(id);
    }
  }
  for (const id of expired) state.nutrients.delete(id);
  const grid = buildGrid(live, liveIds);
  grids.set(state, grid);
  const eaten = new Set<Nutrient>();

  // Toxin clouds drift too, and dissolve when spent.
  const spent: string[] = [];
  for (const [id, c] of state.clouds) {
    drift(c, tick);
    if ((tick - c.tick0) * TICK_DT >= TOXINS[c.kind]!.life) spent.push(id);
  }
  for (const id of spent) state.clouds.delete(id);

  collide(state);
  stepMates(state);

  for (const [id, p] of state.players) {
    if (dormant(p) || isMate(id)) continue;
    const r = radiusOf(p.mass, p.tier);
    const t2 = p.tier >= 2; // eukaryotes and animals eat by mouth
    const mouths = isAnimal(p.tier) ? mouthPointsOf(state, id, p) : [];
    const body = t2 ? r * 1.05 : reachOf(p.mass, p.genome);
    const reach = isAnimal(p.tier) ? r * (1.1 + MOUTH_OUT + MOUTH_REACH * 2) : body; // the mouthparts reach past the body
    const l = state.lineages.get(id);
    const sieve = isAnimal(p.tier) ? sieveOf(p) : 0;
    near(grid, p.x, p.y, reach, (n, nid) => {
      if (eaten.has(n)) return; // gone: eaten this tick
      const d2 = (n.x - p.x) ** 2 + (n.y - p.y) ** 2;
      if (t2) {
        // Food goes in by a mouth: a eukaryote's body, an animal's mouthparts (DNA and shards just touch the body).
        const dna = n.kind === NutrientKind.plasmid || n.kind === NutrientKind.fragment;
        if (dna && isAnimal(p.tier)) return; // an animal can't take up loose DNA (user: too easy) — its DNA is kills and mating
        const food = n.kind === NutrientKind.virus || n.kind === NutrientKind.shard || dna ? -1
          : isAnimal(p.tier) ? mouthFood(mouths, p.tier, n, sieve) : d2 < body * body ? mouthYieldOf(n.kind, p) : 0;
        if (food === -1 ? d2 >= body * body : food <= 0) return;
        if (n.kind === NutrientKind.virus) { // a giant virus binds the cell itself (not the mouth's reach)
          if (p.tier !== 2) return; // ponytail: animals ignore giant viruses until tier-3 hazards (P9d)
          if (d2 >= r * r || tick < p.graceUntil) return;
          p.infection += VIRUS_LATENT;
        } else if (n.kind === NutrientKind.shard) { // touching a meteor shard takes its part (DNA too, below the animals)
          if (!isAnimal(p.tier)) earn(state, id, PLASMID_DNA);
          if (l?.tier === 2) l.library = withBit(l.library, n.gene);
          if (l && isAnimal(l.tier) && (l.tier < 4 || Math.random() < SHARD_UNLOCK_T4)) { // a random part of its own tier
            const cat = catalogFor(l.tier);
            l.library = withBit(l.library, cat.GENES[cat.NAMES[Math.floor(Math.random() * cat.NAMES.length)]!]!.bit);
          }
        } else if (n.kind === NutrientKind.plasmid || n.kind === NutrientKind.fragment) {
          earn(state, id, n.kind === NutrientKind.plasmid ? PLASMID_DNA : PACKET_DNA); // DNA for every phase
          // A eukaryote's plasmid may carry one of its own undiscovered parts (bacteria get the plasmid's gene).
          if (l?.tier === 2 && p.tier === 2 && n.kind === NutrientKind.plasmid && Math.random() < PLASMID_UNLOCK_CHANCE) {
            const hidden = TIER2.NAMES.filter((g) => !hasBit(l.library, TIER2.GENES[g].bit));
            const gene = hidden[Math.floor(Math.random() * hidden.length)];
            if (gene) l.library = withBit(l.library, TIER2.GENES[gene].bit);
          }
        } else {
          // Eukaryotes and animals eat by mouth; phages (bacteria-only viruses) drift past.
          if (n.kind === NutrientKind.macroalga || n.kind === NutrientKind.wallAlga) { // bitten, not gulped: ALGA_BITES, one per interval
            if (tick < (nextAlgaBite.get(p) ?? 0)) return;
            nextAlgaBite.set(p, tick + ALGA_BITE_INTERVAL * TICK_RATE);
            p.mass = Math.min(massCapOf(p.tier), p.mass + food / ALGA_BITES);
            if (++n.bites < ALGA_BITES) return; // still there for the next bite (anyone's)
          } else p.mass = Math.min(massCapOf(p.tier), p.mass + food);
          // A chunk of a dead eukaryote may carry one of its parts (Spore: eat a creature, get its part).
          if (l?.tier === 2 && p.tier === 2 && n.gene && Math.random() < TRANSFORM_CHANCE) l.library = withBit(l.library, n.gene);
        }
      } else if ((isPlant(n.kind) && n.kind !== NutrientKind.hypha) || n.kind === NutrientKind.shard || n.kind === NutrientKind.virus) {
        return; // too big for a bacterium to take in (algae and every plant but hyphae); not its kind of DNA
      } else if (n.kind === NutrientKind.phage) {
        // Phages bind the cell itself (siderophores don't reach them); a capsule may mask the receptor.
        if (d2 >= r * r || tick < p.graceUntil) return;
        if (!(hasGene(p.genome, 'capsule') && Math.random() < CAPSULE_PHAGE_BLOCK)) p.infection += PHAGE_LATENT;
      } else {
        if (d2 >= reach * reach) return;
        const food = yieldOf(n.kind, p.genome);
        p.mass = Math.min(MASS_CAP, p.mass + food);
        const dna = n.kind === NutrientKind.fragment || n.kind === NutrientKind.plasmid;
        if (dna) earn(state, id, n.kind === NutrientKind.plasmid ? PLASMID_DNA : PACKET_DNA);
        // Gene transfer unlocks the part for the species' editor. Plasmids always take; fragments
        // only sometimes recombine (transformation).
        const take = n.kind === NutrientKind.plasmid ? PLASMID_UNLOCK_CHANCE : TRANSFORM_CHANCE;
        if (l?.tier === 1 && dna && Math.random() < take) l.library = withBit(l.library, n.gene);
      }
      eaten.add(n);
      state.nutrients.delete(nid);
    });
  }

  // Phagocytosis: a jaw (or mandibles, or filter combs for bacteria) swallows any cell at most ENGULF_RATIO
  // of the eater's mass whose centre it covers — bacteria are snacks. A eukaryote engulfs with its whole body;
  // an animal only with its mouth, at the head (else a big animal vacuums up everything it swims over).
  // Endospores resist digestion; cysts and newborns are shielded.
  // ponytail: O(players²) with a cheap distance cut, fine at 100; use a grid when counts rise further.
  for (const [eid, e] of state.players) {
    if (e.tier < 2 || dormant(e) || e.engulfedBy || isMate(eid)) continue;
    const r = radiusOf(e.mass, e.tier);
    const mouth = r * EUK_MOUTH;
    const mouths = isAnimal(e.tier) ? mouthPointsOf(state, eid, e) : [];
    const sieve = isAnimal(e.tier) ? sieveOf(e) : 0;
    const near2 = (r * 3) ** 2; // beyond every mouthpart's reach plus a swallowable victim (≤ ½ the mass: radius < r)
    for (const [vid, v] of state.players) {
      if ((v.x - e.x) ** 2 + (v.y - e.y) ** 2 > near2) continue; // cheap first: 100 bots make this loop 10k pairs a tick
      if (vid === eid || v.engulfedBy || dormant(v) || tick < v.graceUntil || !swallows(e, v)) continue;
      let share = 1;
      if (isAnimal(e.tier)) { // a mouthpart that takes this tier must touch it; a filter only works while swimming
        const rv = radiusOf(v.mass, v.tier) * 0.5;
        share = 0;
        for (const m of mouths) {
          const mouth = MOUTHS[e.tier]![m.gene]!;
          if (mouth.swallows.includes(v.tier) && (v.x - m.x) ** 2 + (v.y - m.y) ** 2 < (m.r + rv) ** 2) share = Math.max(share, mouth.filter ? sieve : 1);
        }
        if (!(share > 0)) continue;
      } else if (!((v.x - e.x) ** 2 + (v.y - e.y) ** 2 < mouth * mouth)) continue; // NaN-safe: never swallow on a bad position
      v.engulfedBy = eid;
      e.bites = (e.bites + 1) & 255; // the mouth snaps on a swallow too
      hurt(v, v.health + 1, eid, tick);
      const food = v.mass * ENGULF_SHARE * share;
      e.mass = Math.min(massCapOf(e.tier), e.mass + food); // its DNA comes as the kill share (the victim dies by eid)
      // Endosymbiosis: a swallowed bacterium may live on inside as an organelle (unlocked for the editor).
      const l = state.lineages.get(eid);
      if (l?.tier === 2 && v.tier === 1) {
        for (const [gene, organelle] of [['transporters', 'mitochondrion'], ['thylakoid', 'chloroplast']] as const) {
          if (hasGene(v.genome, gene) && Math.random() < ENDOSYMBIOSIS_CHANCE) l.library = withBit(l.library, TIER2.GENES[organelle].bit);
        }
      }
    }
  }

  bite(state, tick);

  // Parasitism: a bacterium's adhesins, a eukaryote's peduncle, a plankton's stylet, an animal's proboscis drain the
  // energy of every bigger host they touch.
  for (const [pid, par] of state.players) {
    const kind = PARASITES[par.tier];
    if (!kind || dormant(par) || isMate(pid)) continue;
    const copies = catalogFor(par.tier).copiesOf(ownGenome(par), kind.gene);
    if (!copies) continue;
    const rp = radiusOf(par.mass, par.tier);
    // An animal drains through its stylet or proboscis, where it is placed (user: only from the front), not with any
    // part of its body; smaller cells cling on anywhere.
    const suckers = isAnimal(par.tier) ? mouthPointsOf(state, pid, par, true) : undefined;
    let sucking = false;
    for (const [hid, host] of state.players) {
      if (hid === pid || isMate(hid) || !kind.host(host, par) || dormant(host) || tick < host.graceUntil) continue;
      const touch = (radiusOf(host.mass, host.tier) + rp) * 1.08; // collisions hold cells at touching distance
      if (!((host.x - par.x) ** 2 + (host.y - par.y) ** 2 < touch * touch)) continue;
      const rh = radiusOf(host.mass, host.tier) * 1.05;
      if (suckers && !suckers.some((m) => (host.x - m.x) ** 2 + (host.y - m.y) ** 2 < (m.r + rh) ** 2)) continue;
      const drained = Math.min(kind.rate * stack(copies) * TICK_DT, host.mass - minMassOf(host.tier));
      if (drained <= 0) continue;
      host.mass -= drained;
      par.mass = Math.min(massCapOf(par.tier), par.mass + drained * kind.share);
      sucking = true;
    }
    if (par.sucking !== sucking) par.sucking = sucking; // synced: only the changes go out
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
    const r = radiusOf(p.mass, p.tier);
    if (p.infection > 0) {
      hurt(p, (p.tier === 2 ? VIRUS_DPS : PHAGE_DPS) * TICK_DT, p.tier === 2 ? VIRUS_KILLER : PHAGE_KILLER, tick);
      p.infection = Math.max(0, p.infection - TICK_DT - 1e-9);
    }
    for (const c of state.clouds.values()) {
      // Producers carry the immunity gene to their own toxin; ink is harmless; a toxin two tiers down can't harm it.
      if (c.owner === id || c.kind === INK || outranks(p, TOXINS[c.kind]!.tier)) continue;
      const age = (tick - c.tick0) * TICK_DT;
      const reach = cloudRadius(c.kind, age) + r * 0.5;
      if ((c.x - p.x) ** 2 + (c.y - p.y) ** 2 < reach * reach) {
        hurt(p, cloudDps(c.kind, age) * c.power * toxinFactor(p.genome, c.kind) * TICK_DT, c.owner, tick);
      }
    }
    for (const [aid, a] of state.players) {
      const t6ss = hasGene(a.genome, 't6ss');
      if (!t6ss && a.tier !== 2) continue; // only these hurt by contact: skip the rest before any maths
      if (aid === id || dormant(a) || isMate(aid) || outranks(p, a.tier)) continue;
      const ra = radiusOf(a.mass, a.tier);
      const dx = p.x - a.x;
      const dy = p.y - a.y;
      const d = Math.hypot(dx, dy);
      if (t6ss && d < (ra + r) * 1.08) { // collisions hold cells at touching distance
        hurt(p, T6SS_DPS * stack(copiesOf(a.genome, 't6ss')) * contactFactor(p.genome) * TICK_DT, aid, tick);
      }
      if (a.tier !== 2) continue; // animals fight by biting (see bite)
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
    if (p.cocoon > 0) {
      p.cocoon = Math.max(0, p.cocoon - TICK_DT - 1e-9);
      const l = state.lineages.get(id);
      if (p.cocoon === 0 && l) { // hatched, or metamorphosis done: the new design breaks out where the eggs or cocoon were
        state.players.set(id, nextOf(l, tick, { x: p.x, y: p.y, heading: p.heading }, false));
      }
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
      if (isAnimal(p.tier)) p.call ||= TICK_DT;
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
    const r = radiusOf(p.mass, p.tier);
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
      const dna = p.mass * KILL_DNA_SHARE;
      earn(state, death.by, dna);
      if (state.players.has(death.by)) death.feast = { x: p.x, y: p.y, r, energy: p.engulfedBy ? p.mass * ENGULF_SHARE : 0, dna };
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
