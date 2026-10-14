// Movement rules shared by the server (authority) and the client (prediction + replay).
// Keep them pure and deterministic: both sides must compute the same step from the same input.
import {
  DRIFT_PILI, RADIUS_PER_SQRT_MASS, RUN_TURN_RATE, SPEED_COEF, SPEED_EXP, SWIM_CREEP, SWIM_FLAGELLUM, SWIM_PILI,
  TUMBLE_ANGLE, TUMBLE_ERROR, TUMBLE_ERROR_CHEMO, TUMBLE_TIME, WORLD_RADIUS,
} from './constants.ts';
import { currentAt } from './current.ts';
import { hasGene } from './genes.ts';

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

export const radiusOf = (mass: number) => RADIUS_PER_SQRT_MASS * Math.sqrt(mass);
export const speedOf = (mass: number) => SPEED_COEF * mass ** SPEED_EXP;

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

export interface CellBody { x: number; y: number; heading: number; tumble: number; rng: number }
const flow = { x: 0, y: 0 };

/**
 * Advance a cell one step: swim per its motility genes, drift with the current at `time`, stay in the pool.
 * Microbes live at low Reynolds number: no inertia, velocity follows propulsion instantly.
 * `dirX/dirY` must already be clampSteer'd (throttle = length ≤ 1).
 */
export function stepCell(b: CellBody, mass: number, genome: number, dirX: number, dirY: number, dt: number, time: number) {
  const throttle = Math.hypot(dirX, dirY);
  const want = Math.atan2(dirY, dirX);
  let swim = 0;

  if (hasGene(genome, 'flagellum')) {
    if (b.tumble > 0) {
      b.tumble = Math.max(0, b.tumble - dt - 1e-9); // epsilon: exact 0 after the last step despite float dt
      if (b.tumble === 0) {
        const error = hasGene(genome, 'chemoreceptor') ? TUMBLE_ERROR_CHEMO : TUMBLE_ERROR;
        b.heading = wrapAngle((throttle > 0 ? want : b.heading) + (2 * random(b) - 1) * error);
      }
    } else if (throttle > 0) {
      const diff = wrapAngle(want - b.heading);
      if (Math.abs(diff) > TUMBLE_ANGLE) {
        b.tumble = TUMBLE_TIME;
      } else {
        b.heading = wrapAngle(b.heading + Math.sign(diff) * Math.min(Math.abs(diff), RUN_TURN_RATE * dt));
        swim = SWIM_FLAGELLUM * throttle;
      }
    }
  } else if (throttle > 0) {
    b.heading = want;
    swim = (hasGene(genome, 'pili') ? SWIM_PILI : SWIM_CREEP) * throttle;
  }

  const v = swim * speedOf(mass);
  const drift = hasGene(genome, 'pili') ? DRIFT_PILI : 1;
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
