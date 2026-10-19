import { TICK_RATE } from '@panspermia/shared';

/**
 * The server's sim time, in ticks, on the local frame clock: it advances with frame time and eases toward the latest
 * tick plus the time since it arrived. Patches come unevenly (Windows timers fire every ~62 ms, so 1 or 2 ticks at a
 * time, plus network jitter): drawing at `tick + sinceArrival` directly saws back and forth — the stutter of drifting
 * packets and remote cells (user report).
 */
export function createTickClock() {
  let at = -Infinity;
  /** `sinceArrival`: seconds since `tick` arrived; `dt`: this frame's seconds. */
  return (tick: number, sinceArrival: number, dt: number) => {
    const latest = tick + Math.min(sinceArrival * TICK_RATE, 3); // a stalled server: don't run off on our own
    at = Math.abs(latest - at) > 10 ? latest : at + dt * TICK_RATE + (latest - at) * Math.min(1, dt * 4);
    return at;
  };
}

/** How far behind the clock remote cells play back, in ticks: a patch carrying two ticks still leaves a pair to lerp. */
export const TRAIL_DELAY = 2.5;
const KEEP = 6;
interface Trail { t: number[]; x: number[]; y: number[]; h: number[] }
type Pose = { x: number; y: number; heading: number };

/**
 * Remote cells drawn by sim tick, not by arrival time: each new tick's synced pose is recorded against that tick and
 * played back TRAIL_DELAY ticks behind the clock, lerped between the bracketing pair (exact sim time, whatever the
 * server's timers or the network do). A new instance (birth, division) starts a new trail.
 */
export function createTrails() {
  const trails = new WeakMap<object, Trail>();
  return {
    record(cells: Iterable<Pose>, tick: number) {
      for (const c of cells) {
        let tr = trails.get(c);
        if (!tr) trails.set(c, (tr = { t: [], x: [], y: [], h: [] }));
        const n = tr.t.length;
        if (n && tr.t[n - 1]! >= tick) continue;
        const prev = n ? tr.h[n - 1]! : c.heading;
        tr.t.push(tick);
        tr.x.push(c.x);
        tr.y.push(c.y);
        tr.h.push(prev + Math.atan2(Math.sin(c.heading - prev), Math.cos(c.heading - prev))); // unwrapped: lerp the short way
        if (n + 1 > KEEP) { tr.t.shift(); tr.x.shift(); tr.y.shift(); tr.h.shift(); }
      }
    },
    /** The cell's pose at `clock − TRAIL_DELAY`; its synced pose before any tick was recorded. */
    pose(c: Pose, clock: number): Pose {
      const tr = trails.get(c);
      if (!tr?.t.length) return c;
      const target = clock - TRAIL_DELAY;
      const { t } = tr;
      let k = t.length - 1;
      while (k > 0 && t[k - 1]! > target) k--; // t[k] is the first sample after target (or the oldest)
      if (k === 0 || target >= t[k]!) return { x: tr.x[k]!, y: tr.y[k]!, heading: tr.h[k]! };
      const u = (target - t[k - 1]!) / (t[k]! - t[k - 1]!);
      const lerp = (a: number[]) => a[k - 1]! + (a[k]! - a[k - 1]!) * u;
      return { x: lerp(tr.x), y: lerp(tr.y), heading: lerp(tr.h) };
    },
  };
}
