// NPC cells: a species genome (shared catalog) plus a behaviour archetype. Bots are ordinary players in
// PoolState, stepped by the same `stepCell`/`stepWorld` rules, so balance numbers transfer to humans.
// Pure functions over PoolState + a brain map: the room and the headless balancing sim both drive them.
// Bots exist at every tier: a species says which, and its genes are names in that tier's catalog.
import {
  ACTION_SPORE, ACTION_TOXIN, BOT_SPECIES, INK, NutrientKind, type Nutrient, type Player, type PoolState,
  type Species, TICK_DT, TICK_RATE, TIER2, TIER3, rimAt, keepInPool, catalogFor, grazes4, hasGene, healthMaxOf, hunts4, isAnimal, massCapOf,
  radiusOf, sanitizeInput, stepCell,
  PYRAMID, isMate,
} from '@panspermia/shared';
import { type PacketGrid, buildGrid, grids, near } from './grid.ts';
import { type Death, spawnPointFor, embody, inInk, mouthYieldOf, secrete, spawnPlayer, squirtInk, swallows, yieldOf } from './world.ts';

export interface Brain {
  species: number; // index into BOT_SPECIES
  born: number; // tick this individual spawned
  phase: number; // spreads thinking over ticks
  wander: number; // heading when there's nothing to do
  dirX: number;
  dirY: number;
  actions: number;
  /** A eukaryote that just swallowed something digests until this tick before hunting again. */
  fedUntil: number;
  /** Energy at its last think (a jump means it just ate). */
  lastMass: number;
  /** A rare visitor leaves the pool at this tick (and isn't reborn if it dies). */
  leaveAt?: number;
  /** Fixed to the shore here (a coral polyp). */
  anchor?: { x: number; y: number };
}
export type Bots = Map<string, Brain>;

const SIGHT = [0, 350, 650, 1100, 1800]; // per tier: bigger bodies sense a bigger world
/** Fear and firing distances grow with the body, per tier. */
const SCALE = [0, 1, 2, 3.5, 5];
const THINK_TICKS = 4; // 5 Hz reactions, and 4× cheaper perception
const PHAGE_DODGE = 90; // keep this far beyond the membrane
/** What loose DNA (a plasmid, a fragment) is worth to a bacterium / a eukaryote, in food terms: DNA is how a species evolves (animals can't take it up). */
const DNA_VALUE = [0, 6, 30];
const TOXIN_RANGE = 55; // fire when a foreigner is this close (+ half its radius)
const PREY_RATIO = 0.7; // bacterial hunters only chase cells clearly smaller than themselves (agar's rule)
const GRAZER_FEAR = 200; // grazers keep this gap from armed cells at least half their size (×tier)
const COWARD_FEAR = 250; // cowards keep this gap from any foreigner (×tier)
/** Hunters stop hunting when this well fed, as a share of their tier's cap (they graze, divide, get hungry again). */
const HUNT_UNTIL = 0.7;
/** Phagocytosis takes time: a eukaryote hunter rests this long after each swallow (caps its kill rate). */
const DIGEST_TICKS = 6 * 20;
/** An animal hunter rests longer after a meal: a few predators must not empty the pool. */
const DIGEST_TICKS_T3 = 15 * 20; // 30 s until 2026-10-19: hunters took 7+ min a generation (the pyramid gives them more prey)
/** Recently hit this many ticks ago or less: fire back in self-defence. */
const DEFEND_TICKS = 20;
/** Round-robin cycle of species indices weighted by archetype: the pool is mostly food, as in agar. Eukaryotes are rarer. */
const SPAWN_WEIGHT = { grazer: 3, coward: 2, swarm: 2, hunter: 1, parasite: 2, drifter: 1, anchored: 1, wall: 1 } as const;
/**
 * Rare visitors (user: each new species seen once every 2–3 games): every rare species drops by on its own random
 * schedule — exponential gaps averaging VISIT_EVERY — stays VISIT_TIME and leaves. Provisional; a game is ~20 min.
 */
const VISIT_EVERY = 25 * 60; // s
const VISIT_TIME = 5 * 60; // s
const SPAWN_CYCLE = BOT_SPECIES.flatMap((s, i) => (s.rare ? [] : Array<number>(s.tier >= 2 ? 1 : SPAWN_WEIGHT[s.archetype]).fill(i)));

/** Carries a weapon of its tier (what grazers keep away from). */
const armed = (o: Player) => o.tier === 4 ? hunts4(o.genome4) : o.tier === 3 ? TIER3.hasGene(o.genome3, 'mandible') : o.tier === 2
  ? TIER2.hasGene(o.genome2, 'spike') || TIER2.hasGene(o.genome2, 'electric') || TIER2.hasGene(o.genome2, 'poison')
  : hasGene(o.genome, 'bacteriocin') || hasGene(o.genome, 'poreFormer') || hasGene(o.genome, 't6ss');

const brain = (species: number, tick: number): Brain => ({
  species, born: tick, phase: Math.floor(Math.random() * THINK_TICKS), wander: Math.random() * 2 * Math.PI,
  dirX: 0, dirY: 0, actions: 0, fedUntil: 0, lastMass: 0,
});

/** A fresh individual of a species, at its tier's newborn size; anywhere, or at a given spot. */
function incarnate(tick: number, s: Species, at?: { x: number; y: number; heading: number }) {
  const p = embody(spawnPlayer(tick), s.tier, catalogFor(s.tier).genomeOf(s.genes));
  Object.assign(p, spawnPointFor(s.tier), { name: s.name, shape: s.shape }, at);
  return p;
}

let nextBotId = 0;
/** Spawn a bot, species from the weighted cycle unless given. Ids contain no '~' and never collide with session ids. */
export function addBot(state: PoolState, bots: Bots, species = SPAWN_CYCLE[nextBotId % SPAWN_CYCLE.length]!) {
  const id = `bot${nextBotId++}`;
  const b = brain(species, state.tick);
  bots.set(id, b);
  const p = incarnate(state.tick, BOT_SPECIES[species]!);
  const { archetype } = BOT_SPECIES[species]!;
  if (archetype === 'anchored' || archetype === 'wall') { // on the shore, facing the water
    const a = Math.random() * 2 * Math.PI;
    const r = radiusOf(p.mass, p.tier);
    const d = rimAt(a) - r * 1.02;
    Object.assign(p, { x: Math.cos(a) * d, y: Math.sin(a) * d, heading: a + (archetype === 'anchored' ? Math.PI : Math.PI / 2) });
    keepInPool(p, r);
    if (archetype === 'anchored') b.anchor = { x: p.x, y: p.y };
  }
  state.players.set(id, p);
  return id;
}

/** Each tier's resident species, weighted and interleaved (every species once, then the heavier ones again…), so a quota shorter than the cycle still holds every species. */
const CYCLE_OF = [1, 2, 3, 4].map((t) => {
  const own = [...new Set(SPAWN_CYCLE)].filter((i) => BOT_SPECIES[i]!.tier === t);
  const weight = (i: number) => SPAWN_CYCLE.filter((j) => j === i).length;
  return Array.from({ length: Math.max(0, ...own.map(weight)) }, (_, k) => own.filter((i) => weight(i) > k)).flat();
});
/**
 * Top the pool up to `fill` cells as a population pyramid (PYRAMID shares per tier; user, 2026-10-19): each tier's bots
 * fill its quota minus the humans of that tier, surplus bots leave. Humans are never displaced from their tier.
 */
export function fillBots(state: PoolState, bots: Bots, fill: number) {
  const total = PYRAMID.reduce((a, b) => a + b, 0);
  let left = fill;
  for (let t = 1; t < PYRAMID.length; t++) {
    const quota = t === PYRAMID.length - 1 || !PYRAMID.slice(t + 1).some(Boolean) ? left : Math.round((fill * PYRAMID[t]!) / total);
    left -= quota;
    const humans = [...state.players].filter(([id, p]) => p.tier === t && !bots.has(id) && !isMate(id)).length;
    const residents = [...bots].filter(([id, b]) => b.leaveAt === undefined && state.players.get(id)?.tier === t); // visitors come and go on their own
    const cycle = CYCLE_OF[t - 1]!;
    for (let n = residents.length; n < quota - humans && cycle.length; n++) addBot(state, bots, cycle[nextBotId % cycle.length]!);
    for (const [id] of residents.slice(Math.max(0, quota - humans))) {
      bots.delete(id);
      state.players.delete(id);
    }
  }
}

/** Dev: every rare species drops by now, near (x, y) — the shore dwellers on the shore nearest it. */
export function callVisitors(state: PoolState, bots: Bots, x: number, y: number) {
  for (const [i, sp] of BOT_SPECIES.entries()) {
    if (!sp.rare) continue;
    const id = addBot(state, bots, i);
    const b = bots.get(id)!;
    b.leaveAt = state.tick + VISIT_TIME * TICK_RATE;
    const p = state.players.get(id)!;
    const r = radiusOf(p.mass, p.tier);
    if (sp.archetype === 'anchored' || sp.archetype === 'wall') {
      const a = Math.atan2(y, x) + (Math.random() - 0.5) * 0.3;
      const d = rimAt(a) - r * 1.02;
      Object.assign(p, { x: Math.cos(a) * d, y: Math.sin(a) * d, heading: a + (sp.archetype === 'anchored' ? Math.PI : Math.PI / 2) });
      keepInPool(p, r);
      if (b.anchor) b.anchor = { x: p.x, y: p.y };
    } else {
      const a = Math.random() * 2 * Math.PI;
      Object.assign(p, { x: x + Math.cos(a) * (r * 3 + 1500), y: y + Math.sin(a) * (r * 3 + 1500) });
      keepInPool(p, r);
    }
  }
}

/** When each rare species next visits, per pool. */
const visits = new WeakMap<PoolState, Map<number, number>>();
const gap = (mean: number) => -Math.log(1 - Math.random()) * mean * TICK_RATE;
/** Rare visitors arrive on their schedules and leave when their stay is over. Call once a tick. */
export function stepVisitors(state: PoolState, bots: Bots) {
  let due = visits.get(state);
  if (!due) visits.set(state, (due = new Map(BOT_SPECIES.flatMap((s, i) => (s.rare ? [[i, state.tick + gap(VISIT_EVERY)] as [number, number]] : [])))));
  for (const [species, at] of due) {
    if (state.tick < at) continue;
    const id = addBot(state, bots, species);
    bots.get(id)!.leaveAt = state.tick + VISIT_TIME * TICK_RATE;
    due.set(species, state.tick + VISIT_TIME * TICK_RATE + gap(VISIT_EVERY));
  }
  for (const [id, b] of bots) {
    if (b.leaveAt !== undefined && state.tick >= b.leaveAt) {
      bots.delete(id);
      state.players.delete(id);
    }
  }
}

/** After stepWorld: dead bots come back as a fresh individual of their own species. */
export function rebirth(state: PoolState, bots: Bots, deaths: Death[]) {
  for (const { id } of deaths) {
    const b = bots.get(id);
    if (!b) continue;
    if (b.leaveAt !== undefined) { // a visitor that died is gone
      bots.delete(id);
      state.players.delete(id);
      continue;
    }
    bots.set(id, brain(b.species, state.tick));
    state.players.set(id, incarnate(state.tick, BOT_SPECIES[b.species]!));
  }
}

/**
 * After stepWorld: bots at their tier's size cap divide like players do, minus the editor — a fresh child
 * of the same design takes over where the parent was. Returns the ids that divided (the sim counts generations).
 */
export function divideBots(state: PoolState, bots: Bots) {
  const divided: string[] = [];
  for (const [id, b] of bots) {
    const p = state.players.get(id);
    if (!p || p.mass < massCapOf(p.tier) - 1) continue;
    state.players.set(id, incarnate(state.tick, BOT_SPECIES[b.species]!, { x: p.x, y: p.y, heading: p.heading }));
    bots.set(id, brain(b.species, state.tick));
    divided.push(id);
  }
  return divided;
}

/** Decide where to swim and what to fire, from what the bot can see. */
function think(state: PoolState, bots: Bots, grid: PacketGrid, id: string, p: Player, b: Brain) {
  const { archetype } = BOT_SPECIES[b.species]!;
  if (archetype === 'anchored') { // a polyp waits: its crown catches what brushes against it
    Object.assign(b, { dirX: 0, dirY: 0, actions: 0 });
    return;
  }
  if (archetype === 'drifter') { // a jellyfish drifts, pulsing gently now and then
    if (Math.random() < 0.02) b.wander += (Math.random() - 0.5) * 1.5;
    const pulse = Math.sin(state.tick * TICK_DT * 1.3) > 0.4 ? 0.5 : 0.1;
    Object.assign(b, { dirX: Math.cos(b.wander) * pulse, dirY: Math.sin(b.wander) * pulse, actions: 0 });
    return;
  }
  if (archetype === 'wall') { // a snail creeps along the shore, a little way in, grazing what grows there
    const a = Math.atan2(p.y, p.x) + 0.04 * (b.wander > Math.PI ? 1 : -1);
    const d = rimAt(a) - radiusOf(p.mass, p.tier) * 1.1;
    const tx = Math.cos(a) * d - p.x;
    const ty = Math.sin(a) * d - p.y;
    const len = Math.hypot(tx, ty) || 1;
    Object.assign(b, { dirX: (tx / len) * 0.6, dirY: (ty / len) * 0.6, actions: 0 });
    return;
  }
  const t2 = p.tier >= 2; // eukaryotes and animals: eat by mouth, swallow prey, no bacterial toxins
  const sight = SIGHT[p.tier]!;
  const scale = SCALE[p.tier]!;
  const r = radiusOf(p.mass, p.tier);
  let sx = 0;
  let sy = 0;
  let actions = 0;

  // Food (best value per distance) and, for bacteria, phages (dodge).
  let best = 0;
  let fx = 0;
  let fy = 0;
  near(grid, p.x, p.y, sight, (n) => {
    const dx = n.x - p.x;
    const dy = n.y - p.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > sight * sight) return;
    const d = Math.sqrt(d2) || 1;
    if (n.kind === NutrientKind.phage || n.kind === NutrientKind.virus) {
      // Dodge the viruses of its own tier: phages for bacteria, giant viruses for eukaryotes (animals ignore both).
      if (isAnimal(p.tier) || (n.kind === NutrientKind.virus) !== t2) return;
      const close = r + PHAGE_DODGE * (t2 ? 2 : 1);
      if (d < close) {
        sx -= (dx / d) * 3 * (1 - d / close);
        sy -= (dy / d) * 3 * (1 - d / close);
      }
      return;
    }
    const value = n.kind === NutrientKind.fragment || n.kind === NutrientKind.plasmid ? (DNA_VALUE[p.tier] ?? 0)
      : t2 ? mouthYieldOf(n.kind, p) : yieldOf(n.kind, p.genome);
    const score = value / (d + 30);
    if (score > best) {
      best = score;
      fx = dx / d;
      fy = dy / d;
    }
  });
  sx += fx;
  sy += fy;

  // Other cells: prey, threats, kin.
  let prey: { d: number; x: number; y: number } | undefined;
  let fleeing = false;
  let kinX = 0;
  let kinY = 0;
  let kin = 0;
  // Hunters that can also graze stop hunting when well fed; a pure carnivore (a jaw, no filter) can only
  // reach its division size by hunting, so it hunts on, resting to digest after each swallow.
  if (t2 && p.mass > b.lastMass * 1.04 && b.lastMass > 0) b.fedUntil = state.tick + (isAnimal(p.tier) ? DIGEST_TICKS_T3 : DIGEST_TICKS);
  b.lastMass = p.mass;
  const grazes = p.tier === 4 ? grazes4(p.genome4) : p.tier === 3 ? TIER3.hasGene(p.genome3, 'filterComb') : !t2 || TIER2.hasGene(p.genome2, 'filter');
  const fed = state.tick < b.fedUntil;
  // Animals always digest after a meal; grazing eukaryotes and bacteria hunt until well fed.
  const hungry = isAnimal(p.tier) ? !fed && p.mass < massCapOf(p.tier) * HUNT_UNTIL : grazes ? p.mass < massCapOf(p.tier) * HUNT_UNTIL : !fed;
  let swallowerClose = false;
  const inked = [...state.clouds.values()].some((c) => c.kind === INK); // rare: skip the per-cell check otherwise
  let host: { d: number; dx: number; dy: number; r: number } | undefined; // a parasite's target
  let clingers = 0; // parasites hanging on to this eukaryote
  for (const [oid, o] of state.players) {
    if (oid === id || (inked && inInk(state, o.x, o.y, id))) continue; // ink hides whoever is in it
    const dx = o.x - p.x;
    const dy = o.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d > sight) continue;
    if (bots.get(oid)?.species === b.species) {
      kinX += dx;
      kinY += dy;
      kin++;
      continue;
    }
    const gap = d - r - radiusOf(o.mass, o.tier);
    if (archetype === 'parasite' && o.tier >= 2 && !oid.startsWith('~') && o.spore === 0 && o.cyst === 0 && o.cocoon === 0 && d < (host?.d ?? Infinity)) {
      host = { d, dx, dy, r: radiusOf(o.mass, o.tier) };
    }
    if (t2 && o.tier === 1 && hasGene(o.genome, 'adhesin') && gap < 0) clingers++;
    // Eukaryote and animal hunters chase what their mouth can swallow; bacterial hunters what's clearly smaller.
    // Animals only chase eukaryotes and smaller animals: bacteria are swept up in passing, not hunted.
    const catchable = t2 ? swallows(p, o) && (!isAnimal(p.tier) || o.tier >= 2) : o.mass < p.mass * PREY_RATIO;
    const isPrey = archetype === 'hunter' && hungry && catchable && o.spore === 0 && o.cyst === 0 && o.cocoon === 0 && state.tick >= o.graceUntil;
    if (isPrey && d < (prey?.d ?? Infinity)) prey = { d, x: dx / d, y: dy / d };
    // Everyone flees a jawed eukaryote or an animal big enough to swallow them.
    const swallower = swallows(o, p);
    // A eukaryote coward fears other eukaryotes, not the bacteria it towers over.
    // A parasite is reckless: it rides the very cells that could swallow it.
    const fear = archetype === 'parasite' ? 0 : ((archetype === 'coward' && (!t2 || o.tier >= 2)) || swallower ? COWARD_FEAR
      : archetype === 'grazer' && armed(o) && o.mass > p.mass * 0.5 ? GRAZER_FEAR : 0) * scale;
    if (fear > 0 && gap < fear) { // fear 0 would divide by zero when overlapping: NaN steering
      const w = 2 * (1 - gap / fear);
      sx -= (dx / d) * w;
      sy -= (dy / d) * w;
      if (gap < fear * 0.5) fleeing = true;
      if (swallower && gap < fear * 0.3) swallowerClose = true;
    }
    if (t2) continue; // eukaryotes fire poison and jet below, from the whole picture
    // Swarms defend their patch from any foreigner; hunters fire at prey, or back at whoever hit them.
    const target = archetype === 'swarm' || isPrey || (archetype === 'hunter' && state.tick - p.lastHitTick <= DEFEND_TICKS);
    if (target && d < TOXIN_RANGE + r + radiusOf(o.mass, o.tier) * 0.5) actions |= ACTION_TOXIN;
  }
  if (prey) {
    sx += prey.x * 2.5;
    sy += prey.y * 2.5;
  }
  if (host) {
    // Hold station on the host's rim: touching it (to drain), outside its jaw's reach (centre).
    const want = host.r + r * 0.4;
    const k = (host.d - want) / host.d; // > 0: close in, < 0: back off
    sx += host.dx * k * 0.05;
    sy += host.dy * k * 0.05;
  }
  if (kin && Math.hypot(kinX / kin, kinY / kin) > 60 * scale) {
    const k = Math.hypot(kinX, kinY);
    sx += (kinX / k) * 0.4;
    sy += (kinY / k) * 0.4;
  }

  // Stay off the rock (a bacterium may linger in a fault: it fits).
  const fromCentre = Math.hypot(p.x, p.y);
  if (fromCentre > rimAt(Math.atan2(p.y, p.x)) - radiusOf(p.mass, p.tier) * (p.tier === 1 ? 2 : 4) - 300) {
    sx -= (p.x / fromCentre) * 1.5;
    sy -= (p.y / fromCentre) * 1.5;
  }

  if (p.tier === 4 && fleeing) actions |= ACTION_SPORE; // a mollusk inks and jets away (if it has an ink sac)
  if (p.tier === 2) {
    // A fleeing eukaryote leaves poison behind it; the jet gets it out of trouble or onto close prey.
    if (fleeing) actions |= ACTION_TOXIN;
    if (fleeing || clingers > 0 || (prey && prey.d < r * 3)) actions |= ACTION_SPORE; // the jet shakes parasites off
  } else if (hasGene(p.genome, 'endospore')
    && (swallowerClose || (p.health < healthMaxOf(p.genome) * 0.4 && state.tick - p.lastHitTick < 20))) {
    // A spore can't be digested: the bacterial answer to a jaw closing in, or to losing a fight.
    actions |= ACTION_SPORE;
  }

  const len = Math.hypot(sx, sy);
  if (len < 0.05) {
    b.wander += (Math.random() - 0.5) * 0.6;
    b.dirX = Math.cos(b.wander) * 0.6;
    b.dirY = Math.sin(b.wander) * 0.6;
  } else {
    b.dirX = sx / len;
    b.dirY = sy / len;
  }
  b.actions = actions;
}

/** The packets as of the room's last tick (the grid stepWorld built), or indexed now before the first tick. */
function packetsOf(state: PoolState) {
  const grid = grids.get(state);
  if (grid) return grid;
  const ids = [...state.nutrients.keys()];
  return buildGrid(ids.map((id) => state.nutrients.get(id)!), ids);
}

/** One fixed tick for every bot: think (every few ticks), swim, secrete. Call before stepWorld. */
export function stepBots(state: PoolState, bots: Bots) {
  const time = state.tick * TICK_DT;
  let grid: PacketGrid | undefined;
  for (const [id, b] of bots) {
    const p = state.players.get(id);
    if (!p) continue;
    if ((state.tick + b.phase) % THINK_TICKS === 0) {
      think(state, bots, (grid ??= packetsOf(state)), id, p, b);
      sanitizeInput(b); // the same contract as human input: a non-finite steer is no steer
    }
    const cooldown = p.dashCooldown;
    stepCell(p, p.mass, p.genome, b.dirX, b.dirY, b.actions, TICK_DT, time, p.tier, p.genome2, p.genome3, p.genome4);
    if (b.anchor) Object.assign(p, { x: b.anchor.x, y: b.anchor.y, vx: 0, vy: 0 }); // fixed to the rock
    if (p.tier === 4 && p.dashCooldown > cooldown) squirtInk(state, id);
    if (b.actions & ACTION_TOXIN) secrete(state, id);
  }
}
