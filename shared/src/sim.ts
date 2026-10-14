// Movement rules shared by the server (authority) and the client (prediction + replay).
// Keep them pure and deterministic: both sides must compute the same step from the same input.
import { RADIUS_PER_SQRT_MASS, SPEED_COEF, SPEED_EXP, WORLD_RADIUS } from './constants.ts';

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

/**
 * Advance `body` along (dirX, dirY) for `dt` seconds. Microbes live at low Reynolds number:
 * no inertia, velocity follows the input instantly. Throttle = |dir| clamped to 1;
 * zero or non-finite input means no movement. The whole cell stays inside the pool.
 */
export function move(body: { x: number; y: number }, mass: number, dirX: number, dirY: number, dt: number) {
  const len = Math.hypot(dirX, dirY);
  if (!(len > 0 && len < Infinity)) return;
  const k = (speedOf(mass) * dt * Math.min(1, len)) / len;
  body.x += dirX * k;
  body.y += dirY * k;

  const limit = WORLD_RADIUS - radiusOf(mass);
  const d = Math.hypot(body.x, body.y);
  if (d > limit) {
    body.x *= limit / d;
    body.y *= limit / d;
  }
}
