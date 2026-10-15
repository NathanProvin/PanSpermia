// NPC cells: a species genome (shared catalog) plus a behaviour archetype. Bots are ordinary players in
// PoolState, stepped by the same `stepCell`/`stepWorld` rules, so balance numbers transfer to humans.
// Pure functions over PoolState + a brain map: the room and the headless balancing sim both drive them.
// Bots exist at every tier: a species says which, and its genes are names in that tier's catalog.
import {
  ACTION_SPORE, ACTION_TOXIN, BOT_SPECIES, ENGULF_RATIO, NutrientKind, type Nutrient, type Player, type PoolState,
  type Species, T2_HEALTH_MAX, T2_SPAWN_MASS, TICK_DT, TIER2, WORLD_RADIUS, catalogFor, hasGene, healthMaxOf, massCapOf,
  radiusOf, sanitizeInput, stepCell,
} from '@panspermia/shared';
import { type Death, secrete, spawnPlayer, swallows, yield2Of, yieldOf } from './world.ts';

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
}
export type Bots = Map<string, Brain>;

const SIGHT = [0, 350, 650]; // per tier: a eukaryote's senses span its bigger world
const THINK_TICKS = 4; // 5 Hz reactions, and 4× cheaper perception
const PHAGE_DODGE = 90; // keep this far beyond the membrane
const GENE_VALUE = 3; // how much a missing gene is worth, in food terms
const TOXIN_RANGE = 55; // fire when a foreigner is this close (+ half its radius)
const PREY_RATIO = 0.7; // bacterial hunters only chase cells clearly smaller than themselves (agar's rule)
const GRAZER_FEAR = 200; // grazers keep this gap from armed cells at least half their size (×tier)
const COWARD_FEAR = 250; // cowards keep this gap from any foreigner (×tier)
/** Hunters stop hunting when this well fed, as a share of their tier's cap (they graze, divide, get hungry again). */
const HUNT_UNTIL = 0.7;
/** Phagocytosis takes time: a eukaryote hunter rests this long after each swallow (caps its kill rate). */
const DIGEST_TICKS = 6 * 20;
/** Recently hit this many ticks ago or less: fire back in self-defence. */
const DEFEND_TICKS = 20;
/** Round-robin cycle of species indices weighted by archetype: the pool is mostly food, as in agar. Eukaryotes are rarer. */
const SPAWN_WEIGHT = { grazer: 3, coward: 2, swarm: 2, hunter: 1, parasite: 2 } as const;
const SPAWN_CYCLE = BOT_SPECIES.flatMap((s, i) => Array<number>(s.tier === 2 ? 1 : SPAWN_WEIGHT[s.archetype]).fill(i));

/** Carries a weapon of its tier (what grazers keep away from). */
const armed = (o: Player) => o.tier === 2
  ? TIER2.hasGene(o.genome2, 'spike') || TIER2.hasGene(o.genome2, 'electric') || TIER2.hasGene(o.genome2, 'poison')
  : hasGene(o.genome, 'bacteriocin') || hasGene(o.genome, 'poreFormer') || hasGene(o.genome, 't6ss');

const brain = (species: number, tick: number): Brain => ({
  species, born: tick, phase: Math.floor(Math.random() * THINK_TICKS), wander: Math.random() * 2 * Math.PI,
  dirX: 0, dirY: 0, actions: 0, fedUntil: 0, lastMass: 0,
});

/** A fresh individual of a species, at its tier's newborn size; anywhere, or at a given spot. */
function incarnate(tick: number, s: Species, at?: { x: number; y: number; heading: number }) {
  const p = spawnPlayer(tick);
  const genome = catalogFor(s.tier).genomeOf(s.genes);
  if (s.tier === 2) Object.assign(p, { tier: 2, genome: 0, genome2: genome, mass: T2_SPAWN_MASS, health: T2_HEALTH_MAX });
  else p.genome = genome;
  Object.assign(p, { name: s.name, shape: s.shape }, at);
  return p;
}

let nextBotId = 0;
/** Spawn a bot, species from the weighted cycle unless given. Ids contain no '~' and never collide with session ids. */
export function addBot(state: PoolState, bots: Bots, species = SPAWN_CYCLE[nextBotId % SPAWN_CYCLE.length]!) {
  const id = `bot${nextBotId++}`;
  bots.set(id, brain(species, state.tick));
  state.players.set(id, incarnate(state.tick, BOT_SPECIES[species]!));
  return id;
}

/** Add or remove bots until there are exactly `target`. */
export function fillBots(state: PoolState, bots: Bots, target: number) {
  while (bots.size < target) addBot(state, bots);
  for (const id of bots.keys()) {
    if (bots.size <= target) break;
    bots.delete(id);
    state.players.delete(id);
  }
}

/** After stepWorld: dead bots come back as a fresh individual of their own species. */
export function rebirth(state: PoolState, bots: Bots, deaths: Death[]) {
  for (const { id } of deaths) {
    const b = bots.get(id);
    if (!b) continue;
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

// Perception grid: packets bucketed once per tick, so a thinking bot only looks at the cells it can see
// (was: every packet in the pool, for every bot — the main cost once the pool grew).
const CELL = 128;
const cellKey = (ix: number, iy: number) => (ix + 1024) * 2048 + (iy + 1024);
function foodGrid(state: PoolState) {
  const grid = new Map<number, Nutrient[]>();
  for (const n of state.nutrients.values()) {
    const key = cellKey(Math.floor(n.x / CELL), Math.floor(n.y / CELL));
    const bucket = grid.get(key);
    if (bucket) bucket.push(n);
    else grid.set(key, [n]);
  }
  return grid;
}

/** Decide where to swim and what to fire, from what the bot can see. */
function think(state: PoolState, bots: Bots, grid: Map<number, Nutrient[]>, id: string, p: Player, b: Brain) {
  const { archetype } = BOT_SPECIES[b.species]!;
  const t2 = p.tier === 2;
  const sight = SIGHT[p.tier]!;
  const scale = t2 ? 2 : 1; // fear and firing distances grow with the body
  const r = radiusOf(p.mass);
  let sx = 0;
  let sy = 0;
  let actions = 0;

  // Food (best value per distance) and, for bacteria, phages (dodge).
  let best = 0;
  let fx = 0;
  let fy = 0;
  const span = Math.ceil(sight / CELL);
  const ix = Math.floor(p.x / CELL);
  const iy = Math.floor(p.y / CELL);
  for (let gx = ix - span; gx <= ix + span; gx++) {
    for (let gy = iy - span; gy <= iy + span; gy++) {
      for (const n of grid.get(cellKey(gx, gy)) ?? []) {
        const dx = n.x - p.x;
        const dy = n.y - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > sight * sight) continue;
        const d = Math.sqrt(d2) || 1;
        if (n.kind === NutrientKind.phage || n.kind === NutrientKind.virus) {
          // Dodge the viruses of its own tier: phages for bacteria, giant viruses for eukaryotes.
          if ((n.kind === NutrientKind.virus) !== t2) continue;
          const near = r + PHAGE_DODGE * (t2 ? 2 : 1);
          if (d < near) {
            sx -= (dx / d) * 3 * (1 - d / near);
            sy -= (dy / d) * 3 * (1 - d / near);
          }
          continue;
        }
        const value = t2 ? yield2Of(n.kind, p.genome2)
          : n.kind === NutrientKind.fragment || n.kind === NutrientKind.plasmid ? (p.genome & n.gene ? 0 : GENE_VALUE)
          : yieldOf(n.kind, p.genome);
        const score = value / (d + 30);
        if (score > best) {
          best = score;
          fx = dx / d;
          fy = dy / d;
        }
      }
    }
  }
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
  if (t2 && p.mass > b.lastMass * 1.04 && b.lastMass > 0) b.fedUntil = state.tick + DIGEST_TICKS;
  b.lastMass = p.mass;
  const grazes = !t2 || TIER2.hasGene(p.genome2, 'filter');
  const hungry = grazes ? p.mass < massCapOf(p.tier) * HUNT_UNTIL : state.tick >= b.fedUntil;
  let swallowerClose = false;
  let host: { d: number; dx: number; dy: number; r: number } | undefined; // a parasite's target
  let clingers = 0; // parasites hanging on to this eukaryote
  for (const [oid, o] of state.players) {
    if (oid === id) continue;
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
    const gap = d - r - radiusOf(o.mass);
    if (archetype === 'parasite' && o.tier === 2 && o.spore === 0 && o.cyst === 0 && d < (host?.d ?? Infinity)) {
      host = { d, dx, dy, r: radiusOf(o.mass) };
    }
    if (t2 && o.tier === 1 && hasGene(o.genome, 'adhesin') && gap < 0) clingers++;
    // Eukaryote hunters chase what their jaw can swallow; bacterial hunters what's clearly smaller.
    const catchable = t2 ? TIER2.hasGene(p.genome2, 'jaw') && o.mass <= p.mass * ENGULF_RATIO : o.mass < p.mass * PREY_RATIO;
    const isPrey = archetype === 'hunter' && hungry && catchable && o.spore === 0 && o.cyst === 0 && state.tick >= o.graceUntil;
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
    if (target && d < TOXIN_RANGE + r + radiusOf(o.mass) * 0.5) actions |= ACTION_TOXIN;
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

  // Stay off the rock.
  const fromCentre = Math.hypot(p.x, p.y);
  if (fromCentre > WORLD_RADIUS * 0.88) {
    sx -= (p.x / fromCentre) * 1.5;
    sy -= (p.y / fromCentre) * 1.5;
  }

  if (t2) {
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

/** One fixed tick for every bot: think (every few ticks), swim, secrete. Call before stepWorld. */
export function stepBots(state: PoolState, bots: Bots) {
  const time = state.tick * TICK_DT;
  let grid: Map<number, Nutrient[]> | undefined;
  for (const [id, b] of bots) {
    const p = state.players.get(id);
    if (!p) continue;
    if ((state.tick + b.phase) % THINK_TICKS === 0) {
      think(state, bots, (grid ??= foodGrid(state)), id, p, b);
      sanitizeInput(b); // the same contract as human input: a non-finite steer is no steer
    }
    stepCell(p, p.mass, p.genome, b.dirX, b.dirY, b.actions, TICK_DT, time, p.tier, p.genome2, p.genome3);
    if (b.actions & ACTION_TOXIN) secrete(state, id);
  }
}
