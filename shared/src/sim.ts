// Movement rules shared by the server (authority) and the client (prediction + replay).
// Keep them pure and deterministic: both sides must compute the same step from the same input.
import {
  DRIFT_PILI, FLAGELLUM_STACK, MASS_CAP, MIN_MASS, RADIUS_PER_SQRT_MASS, SPAWN_MASS, T2_DRIFT, T2_MASS_CAP,
  T2_MIN_MASS, T2_SPAWN_MASS, T2_SPEED_COEF, T2_SWIM_CILIA, T2_SWIM_CREEP, T2_SWIM_FLAGELLUM, T2_TURN_RATE, RUN_TURN_RATE, SPEED_COEF, SPEED_EXP, SWIM_CREEP, SWIM_FLAGELLUM, SWIM_PILI,
  TUMBLE_ANGLE, TUMBLE_ERROR, TUMBLE_ERROR_CHEMO, TUMBLE_TIME, WORLD_RADIUS,
} from './constants.ts';
import {
  ACTION_MASK, ACTION_SPORE, CAPSULE_SWIM, ENDOSPORE_COOLDOWN, ENDOSPORE_TIME, WALL_SWIM,
} from './combat.ts';
import { currentAt } from './current.ts';
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

export const radiusOf = (mass: number) => RADIUS_PER_SQRT_MASS * Math.sqrt(mass);
export const speedOf = (mass: number, tier = 1) => (tier === 2 ? T2_SPEED_COEF : SPEED_COEF) * mass ** SPEED_EXP;
// Per-tier body scale: where a newborn starts, the starvation floor, the size that triggers division.
export const spawnMassOf = (tier: number) => (tier === 2 ? T2_SPAWN_MASS : SPAWN_MASS);
export const minMassOf = (tier: number) => (tier === 2 ? T2_MIN_MASS : MIN_MASS);
export const massCapOf = (tier: number) => (tier === 2 ? T2_MASS_CAP : MASS_CAP);

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
}
const flow = { x: 0, y: 0 };

/**
 * Advance a cell one step: sporulate on request, swim per its motility genes (copies stack), drift with
 * the current at `time`, stay in the pool. Microbes live at low Reynolds number: no inertia, velocity follows
 * propulsion instantly. Inputs must already be sanitized (throttle = |dir| ≤ 1).
 */
export function stepCell(
  b: CellBody, mass: number, genome: number, dirX: number, dirY: number, actions: number, dt: number, time: number,
  tier = 1, genome2 = 0,
) {
  const throttle = Math.hypot(dirX, dirY);
  const want = Math.atan2(dirY, dirX);
  if (tier === 2) return stepEukaryote(b, mass, genome2, throttle, want, dt, time);
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
      if (b.tumble === 0) {
        const chemo = copiesOf(genome, 'chemoreceptor');
        const error = chemo ? TUMBLE_ERROR_CHEMO / stack(chemo) : TUMBLE_ERROR;
        b.heading = wrapAngle((throttle > 0 ? want : b.heading) + (2 * random(b) - 1) * error);
      }
    } else if (throttle > 0) {
      const diff = wrapAngle(want - b.heading);
      if (Math.abs(diff) > TUMBLE_ANGLE) {
        b.tumble = TUMBLE_TIME;
      } else {
        b.heading = wrapAngle(b.heading + Math.sign(diff) * Math.min(Math.abs(diff), RUN_TURN_RATE * dt));
        swim = SWIM_FLAGELLUM * (1 + FLAGELLUM_STACK * (stack(flagella) - 1)) * throttle;
      }
    }
  } else if (throttle > 0) {
    b.heading = want;
    swim = (hasGene(genome, 'pili') ? SWIM_PILI : SWIM_CREEP) * throttle;
  }

  const v = swim * speedOf(mass)
    * (hasGene(genome, 'capsule') ? CAPSULE_SWIM : 1) * (hasGene(genome, 'thickWall') ? WALL_SWIM : 1);
  const pili = copiesOf(genome, 'pili');
  const drift = pili ? DRIFT_PILI ** stack(pili) : 1;
  move(b, mass, v, drift, dt, time);
}

/**
 * Eukaryotes steer instead of tumbling: cilia give precise, instant turns; a flagellum alone is fast
 * but turns at T2_TURN_RATE; with both you get the flagellum's speed and the cilia's control.
 */
function stepEukaryote(b: CellBody, mass: number, genome2: number, throttle: number, want: number, dt: number, time: number) {
  const cilia = TIER2.copiesOf(genome2, 'cilia');
  const flagella = TIER2.copiesOf(genome2, 'flagellum');
  let swim = 0;
  if (throttle > 0) {
    if (flagella && !cilia) {
      const diff = wrapAngle(want - b.heading);
      b.heading = wrapAngle(b.heading + Math.sign(diff) * Math.min(Math.abs(diff), T2_TURN_RATE * dt));
    } else b.heading = want;
    swim = flagella ? T2_SWIM_FLAGELLUM * (1 + FLAGELLUM_STACK * (stack(flagella) - 1))
      : cilia ? T2_SWIM_CILIA * (1 + FLAGELLUM_STACK * (stack(cilia) - 1)) : T2_SWIM_CREEP;
  }
  move(b, mass, swim * throttle * speedOf(mass, 2), T2_DRIFT, dt, time);
}

/** Swim at speed `v` along the heading, drift with a share of the current, stay inside the pool. */
function move(b: CellBody, mass: number, v: number, drift: number, dt: number, time: number) {
  currentAt(b.x, b.y, time, flow);
  b.x += (Math.cos(b.heading) * v + flow.x * drift) * dt;
  b.y += (Math.sin(b.heading) * v + flow.y * drift) * dt;

  const limit = WORLD_RADIUS - radiusOf(mass);
  const d = Math.hypot(b.x, b.y);
  if (d > limit) {
    b.x *= limit / d;
    b.y *= limit / d;
  }
}
