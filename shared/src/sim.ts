// Movement rules shared by the server (authority) and the client (prediction + replay).
// Keep them pure and deterministic: both sides must compute the same step from the same input.
import {
  DRIFT_PILI, FLAGELLUM_STACK, MASS_CAP, MIN_MASS, RADIUS_PER_SQRT_MASS, SPAWN_MASS, T2_DRIFT, T2_MASS_CAP,
  T2_MIN_MASS, T2_SPAWN_MASS, T2_SPEED_COEF, T2_SWIM_CILIA, T2_SWIM_CREEP, T2_SWIM_FLAGELLUM, T2_TURN_RATE, JET_BOOST,
  JET_COOLDOWN, JET_TIME, MITO_SPEED, T3_DRIFT, T3_MASS_CAP, T3_MIN_MASS, T3_SPAWN_MASS, T3_SPEED_COEF, T3_SWIM_CREEP,
  T3_SWIM_PADDLE, T3_SWIM_TAIL, T3_TURN_RATE, EVOLVE_DNA, EVOLVE_DNA_T2, RUN_TURN_RATE, SPEED_COEF, SPEED_EXP, SWIM_CREEP, SWIM_FLAGELLUM, SWIM_PILI,
  TUMBLE_ANGLE, TUMBLE_ERROR, TUMBLE_ERROR_CHEMO, TUMBLE_TIME, TIER_SCALE, WORLD_RADIUS, CILIA_TURN, CREEP_TURN, INERTIA, PADDLE_TURN,
  PILI_TURN, TUMBLE_SPIN,
} from './constants.ts';
import {
  ACTION_MASK, ACTION_SPORE, CAPSULE_SWIM, ENDOSPORE_COOLDOWN, ENDOSPORE_TIME, WALL_SWIM,
} from './combat.ts';
import { currentAt } from './current.ts';
import { TIER3 } from './animal.ts';
import { TIER2 } from './eukaryote.ts';
import { copiesOf, hasGene, stack } from './genes.ts';

/**
 * Clamp a steering input to throttle ≤ 1 keeping its heading; non-finite → no input.
 * The server sanitizes every input with it, so clients must apply it before `send()`:
 * prediction then replays exactly the command the server simulates.
 */
export function clampSteer(input: { dirX: number; dirY: number }) {
  const len = Math.hypot(input.dirX, input.dirY);
  if (!(len < Infinity)) {
    input.dirX = 0;
    input.dirY = 0;
  } else if (len > 1) {
    input.dirX /= len;
    input.dirY /= len;
  }
}

/** The full input contract, applied by the client before `send()` and by the server as its sanitizer. */
export function sanitizeInput(input: { dirX: number; dirY: number; actions: number }) {
  clampSteer(input);
  input.actions &= ACTION_MASK;
}

/** Body radius: grows with √mass, and each tier is drawn and collides at its own scale (TIER_SCALE). */
export const radiusOf = (mass: number, tier = 1) => RADIUS_PER_SQRT_MASS * (TIER_SCALE[tier] ?? 1) * Math.sqrt(mass);
/** Per-tier body scale: newborn size, starvation floor, size that triggers division, speed coefficient. */
const BODY = [
  undefined,
  { spawn: SPAWN_MASS, min: MIN_MASS, cap: MASS_CAP, speed: SPEED_COEF, evolve: EVOLVE_DNA },
  { spawn: T2_SPAWN_MASS, min: T2_MIN_MASS, cap: T2_MASS_CAP, speed: T2_SPEED_COEF, evolve: EVOLVE_DNA_T2 },
  { spawn: T3_SPAWN_MASS, min: T3_MIN_MASS, cap: T3_MASS_CAP, speed: T3_SPEED_COEF, evolve: Infinity },
] as const;
const bodyOf = (tier: number) => BODY[tier] ?? BODY[1];
export const speedOf = (mass: number, tier = 1) => bodyOf(tier).speed * mass ** SPEED_EXP;
export const spawnMassOf = (tier: number) => bodyOf(tier).spawn;
export const minMassOf = (tier: number) => bodyOf(tier).min;
export const massCapOf = (tier: number) => bodyOf(tier).cap;
/** Lifetime DNA a species of this tier needs to evolve to the next. */
export const evolveDnaOf = (tier: number) => bodyOf(tier).evolve;
/** The genome field a cell of its tier reads (each tier has its own catalog and bits). */
export const ownGenome = (p: { tier: number; genome: number; genome2: number; genome3: number }) =>
  p.tier === 3 ? p.genome3 : p.tier === 2 ? p.genome2 : p.genome;

/** Angle wrapped to (-π, π]. */
export const wrapAngle = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

/** xorshift32 on `body.rng`; uniform in [0, 1). */
function random(body: { rng: number }) {
  let s = body.rng | 0 || 0x9e3779b9;
  s ^= s << 13;
  s ^= s >>> 17;
  s ^= s << 5;
  body.rng = s >>> 0;
  return body.rng / 2 ** 32;
}

export interface CellBody {
  x: number; y: number; heading: number; tumble: number; rng: number; spore: number; sporeCooldown: number;
  dash: number; dashCooldown: number;
  /** Swim velocity (u/s, without the current): eases toward the propulsion (inertia). */
  vx: number; vy: number;
  /** Where a tumble is spinning the cell to (rad). */
  aim: number;
}

/** Turn the heading toward `want` at most `rate`·dt: no body ever snaps round. */
function turnToward(b: CellBody, want: number, rate: number, dt: number) {
  const diff = wrapAngle(want - b.heading);
  b.heading = wrapAngle(b.heading + Math.sign(diff) * Math.min(Math.abs(diff), rate * dt));
}
const flow = { x: 0, y: 0 };

/**
 * Advance a cell one step: sporulate on request, swim per its motility genes (copies stack), drift with
 * the current at `time`, stay in the pool. Real microbes have no inertia; ours do (INERTIA, gameplay feel), and
 * every body turns progressively. Inputs must already be sanitized (throttle = |dir| ≤ 1).
 */
export function stepCell(
  b: CellBody, mass: number, genome: number, dirX: number, dirY: number, actions: number, dt: number, time: number,
  tier = 1, genome2 = 0, genome3 = 0,
) {
  const throttle = Math.hypot(dirX, dirY);
  const want = Math.atan2(dirY, dirX);
  if (tier === 3) return stepAnimal(b, mass, genome3, throttle, want, dt, time);
  if (tier === 2) return stepEukaryote(b, mass, genome2, throttle, want, actions, dt, time);
  let swim = 0;

  // Endospore: a dormant, invulnerable husk that still drifts. Simulated here so it's predicted.
  b.sporeCooldown = Math.max(0, b.sporeCooldown - dt);
  if (b.spore > 0) {
    b.spore = Math.max(0, b.spore - dt - 1e-9);
  } else if (actions & ACTION_SPORE && hasGene(genome, 'endospore') && b.sporeCooldown === 0) {
    b.spore = ENDOSPORE_TIME;
    b.sporeCooldown = ENDOSPORE_COOLDOWN;
  }

  const flagella = copiesOf(genome, 'flagellum');
  if (b.spore > 0) {
    // dormant: no swimming, tumbles frozen
  } else if (flagella) {
    if (b.tumble > 0) {
      b.tumble = Math.max(0, b.tumble - dt - 1e-9); // epsilon: exact 0 after the last step despite float dt
      turnToward(b, b.aim, TUMBLE_SPIN, dt); // the motors reverse: the cell spins round
      if (b.tumble === 0) b.heading = b.aim;
    } else if (throttle > 0) {
      const diff = wrapAngle(want - b.heading);
      if (Math.abs(diff) > TUMBLE_ANGLE) {
        b.tumble = TUMBLE_TIME;
        const chemo = copiesOf(genome, 'chemoreceptor');
        const error = chemo ? TUMBLE_ERROR_CHEMO / stack(chemo) : TUMBLE_ERROR;
        b.aim = wrapAngle(want + (2 * random(b) - 1) * error);
      } else {
        b.heading = wrapAngle(b.heading + Math.sign(diff) * Math.min(Math.abs(diff), RUN_TURN_RATE * dt));
        swim = SWIM_FLAGELLUM * (1 + FLAGELLUM_STACK * (stack(flagella) - 1)) * throttle;
      }
    }
  } else if (throttle > 0) {
    turnToward(b, want, hasGene(genome, 'pili') ? PILI_TURN : CREEP_TURN, dt);
    swim = (hasGene(genome, 'pili') ? SWIM_PILI : SWIM_CREEP) * throttle;
  }

  const v = swim * speedOf(mass)
    * (hasGene(genome, 'capsule') ? CAPSULE_SWIM : 1) * (hasGene(genome, 'thickWall') ? WALL_SWIM : 1);
  const pili = copiesOf(genome, 'pili');
  const drift = pili ? DRIFT_PILI ** stack(pili) : 1;
  move(b, mass, 1, v, drift, dt, time, INERTIA[1]!);
}

/**
 * Eukaryotes steer instead of tumbling: cilia give precise, quick turns; a flagellum alone is fast
 * but turns at T2_TURN_RATE; with both you get the flagellum's speed and the cilia's control.
 */
function stepEukaryote(
  b: CellBody, mass: number, genome2: number, throttle: number, want: number, actions: number, dt: number, time: number,
) {
  // Jet: a short predicted dash, like the endospore is for bacteria.
  b.dashCooldown = Math.max(0, b.dashCooldown - dt);
  if (b.dash > 0) b.dash = Math.max(0, b.dash - dt - 1e-9);
  else if (actions & ACTION_SPORE && TIER2.hasGene(genome2, 'jet') && b.dashCooldown === 0) {
    b.dash = JET_TIME;
    b.dashCooldown = JET_COOLDOWN;
  }
  const cilia = TIER2.copiesOf(genome2, 'cilia');
  const flagella = TIER2.copiesOf(genome2, 'flagellum');
  let swim = 0;
  if (throttle > 0) {
    turnToward(b, want, flagella && !cilia ? T2_TURN_RATE : CILIA_TURN, dt);
    swim = flagella ? T2_SWIM_FLAGELLUM * (1 + FLAGELLUM_STACK * (stack(flagella) - 1))
      : cilia ? T2_SWIM_CILIA * (1 + FLAGELLUM_STACK * (stack(cilia) - 1)) : T2_SWIM_CREEP;
  }
  if (b.dash > 0) swim = Math.max(swim, T2_SWIM_CILIA) * JET_BOOST; // the jet pushes even a creeping cell
  swim *= 1 + MITO_SPEED * stack(TIER2.copiesOf(genome2, 'mitochondrion')); // more energy
  move(b, mass, 2, swim * (b.dash > 0 ? 1 : throttle) * speedOf(mass, 2), T2_DRIFT, dt, time, INERTIA[2]!);
}

/** Animals: paddle legs steer quickly and precisely; a lone tail drives fast but turns wide. */
function stepAnimal(b: CellBody, mass: number, genome3: number, throttle: number, want: number, dt: number, time: number) {
  const paddles = TIER3.copiesOf(genome3, 'paddle');
  const tails = TIER3.copiesOf(genome3, 'tail');
  let swim = 0;
  if (throttle > 0) {
    turnToward(b, want, tails && !paddles ? T3_TURN_RATE : PADDLE_TURN, dt);
    swim = tails ? T3_SWIM_TAIL * (1 + FLAGELLUM_STACK * (stack(tails) - 1))
      : paddles ? T3_SWIM_PADDLE * (1 + FLAGELLUM_STACK * (stack(paddles) - 1)) : T3_SWIM_CREEP;
  }
  move(b, mass, 3, swim * throttle * speedOf(mass, 3), T3_DRIFT, dt, time, INERTIA[3]!);
}

/**
 * Ease the swim velocity toward speed `v` along the heading (time constant `inertia`), drift with a share of
 * the current, stay inside the pool (the rock stops the outward part of the velocity).
 */
function move(b: CellBody, mass: number, tier: number, v: number, drift: number, dt: number, time: number, inertia: number) {
  const k = 1 - Math.exp(-dt / inertia);
  b.vx += (Math.cos(b.heading) * v - b.vx) * k;
  b.vy += (Math.sin(b.heading) * v - b.vy) * k;
  currentAt(b.x, b.y, time, flow);
  b.x += (b.vx + flow.x * drift) * dt;
  b.y += (b.vy + flow.y * drift) * dt;

  const limit = WORLD_RADIUS - radiusOf(mass, tier);
  const d = Math.hypot(b.x, b.y);
  if (d > limit) {
    b.x *= limit / d;
    b.y *= limit / d;
    const out = (b.vx * b.x + b.vy * b.y) / limit;
    if (out > 0) {
      b.vx -= (out * b.x) / limit;
      b.vy -= (out * b.y) / limit;
    }
  }
}
