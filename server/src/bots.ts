// NPC cells: a species genome (shared catalog) plus a behaviour archetype. Bots are ordinary players in
// PoolState, stepped by the same `stepCell`/`stepWorld` rules, so balance numbers transfer to humans.
// Pure functions over PoolState + a brain map: the room and the headless balancing sim both drive them.
import {
  ACTION_SPORE, ACTION_TOXIN, BOT_SPECIES, MASS_CAP, NutrientKind, type Player, type PoolState, TICK_DT, WORLD_RADIUS,
  genomeOf, hasGene, healthMaxOf, radiusOf, stepCell,
} from '@panspermia/shared';
import { type Death, secrete, spawnPlayer, yieldOf } from './world.ts';

export interface Brain {
  species: number; // index into BOT_SPECIES
  born: number; // tick this individual spawned
  phase: number; // spreads thinking over ticks
  wander: number; // heading when there's nothing to do
  dirX: number;
  dirY: number;
  actions: number;
}
export type Bots = Map<string, Brain>;

const SIGHT = 350;
const THINK_TICKS = 4; // 5 Hz reactions, and 4× cheaper perception
const PHAGE_DODGE = 90; // keep this far beyond the membrane
const GENE_VALUE = 3; // how much a missing gene is worth, in food-mass terms
const TOXIN_RANGE = 55; // fire when a foreigner is this close (+ half its radius)
const PREY_RATIO = 0.7; // hunters only chase cells clearly smaller than themselves (agar's rule)
const GRAZER_FEAR = 200; // grazers keep this gap from armed cells at least half their mass
const HUNT_UNTIL = 70; // hunters stop hunting when this well fed (they graze on, divide, and get hungry again)
/** Recently hit this many ticks ago or less: fire back in self-defence. */
const DEFEND_TICKS = 20;
/** Round-robin cycle of species indices weighted by archetype: the pool is mostly food, as in agar. */
const SPAWN_WEIGHT = { grazer: 3, coward: 2, swarm: 2, hunter: 1 } as const;
const SPAWN_CYCLE = BOT_SPECIES.flatMap((s, i) => Array<number>(SPAWN_WEIGHT[s.archetype]).fill(i));

const armed = (genome: number) =>
  hasGene(genome, 'bacteriocin') || hasGene(genome, 'poreFormer') || hasGene(genome, 't6ss');

const brain = (species: number, tick: number): Brain => ({
  species, born: tick, phase: Math.floor(Math.random() * THINK_TICKS), wander: Math.random() * 2 * Math.PI,
  dirX: 0, dirY: 0, actions: 0,
});

let nextBotId = 0;
/** Spawn a bot, species from the weighted cycle unless given. Ids contain no '~' and never collide with session ids. */
export function addBot(state: PoolState, bots: Bots, species = SPAWN_CYCLE[nextBotId % SPAWN_CYCLE.length]!) {
  const id = `bot${nextBotId++}`;
  bots.set(id, brain(species, state.tick));
  const p = spawnPlayer(state.tick);
  p.genome = genomeOf(BOT_SPECIES[species]!.genes);
  state.players.set(id, p);
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
    state.players.get(id)!.genome = genomeOf(BOT_SPECIES[b.species]!.genes);
  }
}

/**
 * After stepWorld: bots at the size cap divide like players do, minus the editor — a fresh child of the
 * same design takes over where the parent was. Returns the ids that divided (the sim counts generations).
 */
export function divideBots(state: PoolState, bots: Bots) {
  const divided: string[] = [];
  for (const [id, b] of bots) {
    const p = state.players.get(id);
    if (!p || p.mass < MASS_CAP - 1) continue;
    const child = spawnPlayer(state.tick);
    Object.assign(child, { x: p.x, y: p.y, heading: p.heading, genome: p.genome });
    state.players.set(id, child);
    bots.set(id, brain(b.species, state.tick));
    divided.push(id);
  }
  return divided;
}

/** Decide where to swim and what to fire, from what the bot can see. */
function think(state: PoolState, bots: Bots, id: string, p: Player, b: Brain) {
  const { archetype } = BOT_SPECIES[b.species]!;
  const r = radiusOf(p.mass);
  let sx = 0;
  let sy = 0;
  let actions = 0;

  // Food (best value per distance) and phages (dodge).
  let best = 0;
  let fx = 0;
  let fy = 0;
  for (const n of state.nutrients.values()) {
    const dx = n.x - p.x;
    const dy = n.y - p.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > SIGHT * SIGHT) continue;
    const d = Math.sqrt(d2) || 1;
    if (n.kind === NutrientKind.phage) {
      const near = r + PHAGE_DODGE;
      if (d < near) {
        sx -= (dx / d) * 3 * (1 - d / near);
        sy -= (dy / d) * 3 * (1 - d / near);
      }
      continue;
    }
    const value = n.gene ? (p.genome & n.gene ? 0 : GENE_VALUE) : yieldOf(n.kind, p.genome);
    const score = value / (d + 30);
    if (score > best) {
      best = score;
      fx = dx / d;
      fy = dy / d;
    }
  }
  sx += fx;
  sy += fy;

  // Other cells: prey, threats, kin.
  let prey: { d: number; x: number; y: number } | undefined;
  let kinX = 0;
  let kinY = 0;
  let kin = 0;
  for (const [oid, o] of state.players) {
    if (oid === id) continue;
    const dx = o.x - p.x;
    const dy = o.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d > SIGHT) continue;
    if (bots.get(oid)?.species === b.species) {
      kinX += dx;
      kinY += dy;
      kin++;
      continue;
    }
    const gap = d - r - radiusOf(o.mass);
    const isPrey = archetype === 'hunter' && p.mass < HUNT_UNTIL && o.spore === 0 && o.cyst === 0
      && state.tick >= o.graceUntil && o.mass < p.mass * PREY_RATIO;
    if (isPrey && d < (prey?.d ?? Infinity)) prey = { d, x: dx / d, y: dy / d };
    const fear = archetype === 'coward' ? 250 : archetype === 'grazer' && armed(o.genome) && o.mass > p.mass * 0.5 ? GRAZER_FEAR : 0;
    if (gap < fear) {
      const w = 2 * (1 - gap / fear);
      sx -= (dx / d) * w;
      sy -= (dy / d) * w;
    }
    // Swarms defend their patch from any foreigner; hunters fire at prey, or back at whoever hit them.
    const target = archetype === 'swarm' || isPrey || (archetype === 'hunter' && state.tick - p.lastHitTick <= DEFEND_TICKS);
    if (target && d < TOXIN_RANGE + r + radiusOf(o.mass) * 0.5) actions |= ACTION_TOXIN;
  }
  if (prey) {
    sx += prey.x * 2.5;
    sy += prey.y * 2.5;
  }
  if (kin && Math.hypot(kinX / kin, kinY / kin) > 60) {
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

  if (hasGene(p.genome, 'endospore') && p.health < healthMaxOf(p.genome) * 0.4 && state.tick - p.lastHitTick < 20) {
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
  for (const [id, b] of bots) {
    const p = state.players.get(id);
    if (!p) continue;
    if ((state.tick + b.phase) % THINK_TICKS === 0) think(state, bots, id, p, b);
    stepCell(p, p.mass, p.genome, b.dirX, b.dirY, b.actions, TICK_DT, time);
    if (b.actions & ACTION_TOXIN) secrete(state, id);
  }
}
