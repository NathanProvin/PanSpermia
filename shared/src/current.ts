// Pool currents: velocity = curl of a stream function built from slowly drifting waves.
// Divergence-free by construction, so drifting matter swirls and streams but never piles up
// or drains away. Shared: P2 visuals drift plankton with it, P3 gameplay drifts nutrients and cells.

import { TICK_DT } from './constants.ts';

// [kx, ky, ω, phase, amplitude]: wavelength 2π/|k| ≈ 1.2–2.6k units, peak speed ≈ amplitude·|k|.
const MODES = [
  [0.0021, 0.0013, 0.11, 0.0, 9000],
  [-0.0011, 0.0024, 0.07, 1.7, 7000],
  [0.0037, -0.0029, 0.17, 4.1, 2500],
  [-0.0049, -0.0018, 0.23, 2.3, 1500],
] as const;

/** Current velocity (world units/s) at (x, y) and time t (seconds), written into `out`. */
export function currentAt(x: number, y: number, t: number, out = { x: 0, y: 0 }) {
  let u = 0;
  let v = 0;
  for (const [kx, ky, w, phase, amp] of MODES) {
    const c = amp * Math.cos(kx * x + ky * y + w * t + phase);
    u += c * ky; //  ∂ψ/∂y
    v -= c * kx; // -∂ψ/∂x
  }
  out.x = u;
  out.y = v;
  return out;
}

const flow = { x: 0, y: 0 };
/**
 * Passive particles step every DRIFT_TICKS ticks: the current varies slowly, and this halves the cost of
 * thousands of drifting packets (the server's biggest per-tick cost once the pool grew, P8e).
 */
export const DRIFT_TICKS = 2;
/**
 * Carry a passive particle (nutrient, debris) on the current in fixed steps of DRIFT_TICKS ticks, from
 * `p.tick` up to `untilTick` (it may stop up to DRIFT_TICKS − 1 ticks short). Integer ticks make the path
 * identical wherever it is computed: the server, and every client reconstructing it from the spawn point
 * alone (so positions never need syncing).
 */
export function drift(p: { x: number; y: number; tick: number }, untilTick: number) {
  for (; p.tick + DRIFT_TICKS <= untilTick; p.tick += DRIFT_TICKS) {
    currentAt(p.x, p.y, p.tick * TICK_DT, flow);
    p.x += flow.x * TICK_DT * DRIFT_TICKS;
    p.y += flow.y * TICK_DT * DRIFT_TICKS;
  }
}
