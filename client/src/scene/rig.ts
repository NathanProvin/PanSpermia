// Soft rig: client-side secondary motion, visual only (the server's circles and heading stay the truth).
// Chains run in world units, so a whip or a body segment lags behind where the body went, drags through
// the water and springs back; the caller reads the points back in the body frame the meshes draw in.
import { wrapAngle } from '@panspermia/shared';

/** 1/s: how fast a chain point loses its own motion in water. */
const WATER_DRAG = 12;
/** 1/s: how hard a whip straightens out from its root (softer toward the tip). */
const WHIP_BEND = 40;
/** 1/s: how hard a spine straightens; most of the shape comes from following the head. */
const SPINE_BEND = 3;
/** rad: the most a spine joint bends. */
const MAX_BEND = 0.6;
/** 1/s and the most a radial lobe strays from its rest spot (× its distance from the centre). */
const LOBE_PULL = 12;
const LOBE_SLACK = 0.15;
/** Longest physics step (s): big frames are cut into substeps. */
const STEP = 1 / 120;

export interface Chain {
  x: Float64Array; y: Float64Array; px: Float64Array; py: Float64Array;
  /** False until laid out (first frame, a teleport, a reset). */
  live: boolean;
  /** The root (whips) where the last step left it, to sweep it smoothly across substeps. */
  rx: number; ry: number; rdir: number;
}

export const chain = (n: number): Chain => ({
  x: new Float64Array(n), y: new Float64Array(n), px: new Float64Array(n), py: new Float64Array(n), live: false, rx: 0, ry: 0, rdir: 0,
});

const substeps = (dt: number) => Math.min(8, Math.ceil(dt / STEP));

/** Verlet: carry each point's motion (minus water drag) from index `from` on. */
function drift(c: Chain, from: number, h: number) {
  const keep = Math.exp(-h * WATER_DRAG);
  for (let i = from; i < c.x.length; i++) {
    const vx = (c.x[i]! - c.px[i]!) * keep;
    const vy = (c.y[i]! - c.py[i]!) * keep;
    c.px[i] = c.x[i]!;
    c.py[i] = c.y[i]!;
    c.x[i]! += vx;
    c.y[i]! += vy;
  }
}

/** Hold point i at `len` from point j (only i moves: the chain is pulled from its root). */
function keep(c: Chain, i: number, j: number, len: number) {
  const dx = c.x[i]! - c.x[j]!;
  const dy = c.y[i]! - c.y[j]!;
  const d = Math.hypot(dx, dy) || 1;
  c.x[i] = c.x[j]! + (dx / d) * len;
  c.y[i] = c.y[j]! + (dy / d) * len;
}

/**
 * Relax point i a fraction k toward (tx, ty) without giving it speed: in water a bent whip creeps back
 * straight (overdamped). A verlet pull would carry momentum and ring like a pendulum.
 */
function relax(c: Chain, i: number, tx: number, ty: number, k: number) {
  const dx = (tx - c.x[i]!) * k;
  const dy = (ty - c.y[i]!) * k;
  c.x[i]! += dx;
  c.y[i]! += dy;
  c.px[i]! += dx;
  c.py[i]! += dy;
}

function place(c: Chain, i: number, x: number, y: number) {
  c.x[i] = c.px[i] = x;
  c.y[i] = c.py[i] = y;
}

/**
 * A whip (flagellum, tail) rooted at (rx, ry), leaving the body along `dir` (world rad), `link` apart.
 * The first link is held along `dir`; the rest trails through the water and straightens out behind it.
 * dt ≤ 0 or a dead chain lays it out straight (editor, card, first frame).
 */
export function stepWhip(c: Chain, rx: number, ry: number, dir: number, link: number, dt: number) {
  const n = c.x.length;
  if (!c.live || dt <= 0) {
    for (let i = 0; i < n; i++) place(c, i, rx + Math.cos(dir) * link * i, ry + Math.sin(dir) * link * i);
    [c.rx, c.ry, c.rdir, c.live] = [rx, ry, dir, true];
    return;
  }
  const steps = substeps(dt);
  const h = dt / steps;
  const turn = wrapAngle(dir - c.rdir);
  for (let s = 1; s <= steps; s++) {
    const f = s / steps;
    const x0 = c.rx + (rx - c.rx) * f;
    const y0 = c.ry + (ry - c.ry) * f;
    const a = c.rdir + turn * f;
    place(c, 0, x0, y0);
    place(c, 1, x0 + Math.cos(a) * link, y0 + Math.sin(a) * link);
    drift(c, 2, h);
    for (let i = 2; i < n; i++) {
      // Straighten: pull toward the continuation of the link before it.
      const dx = c.x[i - 1]! - c.x[i - 2]!;
      const dy = c.y[i - 1]! - c.y[i - 2]!;
      const d = Math.hypot(dx, dy) || 1;
      const k = 1 - Math.exp(-h * WHIP_BEND * (1 - (0.5 * i) / n));
      relax(c, i, c.x[i - 1]! + (dx / d) * link, c.y[i - 1]! + (dy / d) * link, k);
      keep(c, i, i - 1, link);
    }
  }
  [c.rx, c.ry, c.rdir] = [rx, ry, dir];
}

type Point = { readonly x: number; readonly y: number };

/** How far segment i has turned from its rest pose: the angle of its link to its parent, now vs at rest. */
export function segmentTurn(c: Chain, rest: readonly Point[], i: number, radial: boolean) {
  if (i === 0) return 0;
  const p = radial ? 0 : i - 1;
  return wrapAngle(Math.atan2(c.y[p]! - c.y[i]!, c.x[p]! - c.x[i]!) - Math.atan2(rest[p]!.y - rest[i]!.y, rest[p]!.x - rest[i]!.x));
}

/**
 * An animal body, `rest` = where each segment would be on a rigid body (world). Segment 0 (head, or the
 * radial centre) is pinned there. Spine: each next segment follows the one ahead at its rest distance,
 * bending at most MAX_BEND per joint, so the body curves through a turn. Radial: lobes on springs around
 * the centre (they lag and wobble). dt ≤ 0 or a dead chain snaps to rest.
 */
export function stepSpine(c: Chain, rest: readonly Point[], radial: boolean, dt: number) {
  const n = rest.length;
  if (!c.live || dt <= 0) {
    for (let i = 0; i < n; i++) place(c, i, rest[i]!.x, rest[i]!.y);
    c.live = true;
    return;
  }
  const steps = substeps(dt);
  const h = dt / steps;
  for (let s = 0; s < steps; s++) {
    place(c, 0, rest[0]!.x, rest[0]!.y); // ponytail: the pin jumps once per frame, fine at ≥ 30 fps
    drift(c, 1, h);
    for (let i = 1; i < n; i++) {
      const p = radial ? 0 : i - 1;
      // Where it would sit if the joint were relaxed: its rest offset, turned with its parent.
      const turn = p === 0 ? 0 : segmentTurn(c, rest, p, radial);
      const ox = rest[i]!.x - rest[p]!.x;
      const oy = rest[i]!.y - rest[p]!.y;
      const tx = c.x[p]! + ox * Math.cos(turn) - oy * Math.sin(turn);
      const ty = c.y[p]! + ox * Math.sin(turn) + oy * Math.cos(turn);
      const len = Math.hypot(ox, oy);
      const k = 1 - Math.exp(-h * (radial ? LOBE_PULL : SPINE_BEND));
      relax(c, i, tx, ty, k);
      if (radial) { // a lobe strays a little, no more
        const dx = c.x[i]! - tx;
        const dy = c.y[i]! - ty;
        const d = Math.hypot(dx, dy);
        if (d > LOBE_SLACK * len) {
          c.x[i] = tx + (dx / d) * LOBE_SLACK * len;
          c.y[i] = ty + (dy / d) * LOBE_SLACK * len;
        }
        continue;
      }
      // Spine joint: clamp the bend, then hold the link length.
      const want = Math.atan2(ty - c.y[p]!, tx - c.x[p]!);
      const bend = wrapAngle(Math.atan2(c.y[i]! - c.y[p]!, c.x[i]! - c.x[p]!) - want);
      const a = want + Math.max(-MAX_BEND, Math.min(MAX_BEND, bend));
      c.x[i] = c.x[p]! + Math.cos(a) * len;
      c.y[i] = c.y[p]! + Math.sin(a) * len;
    }
  }
}

/** A damped spring (underdamped: it overshoots a little and settles). */
export interface Spring { v: number; dv: number }
export const spring = (): Spring => ({ v: 0, dv: 0 });

/** Pull `s` toward `target`: stiffness k (1/s²), damping c (1/s). */
export function stepSpring(s: Spring, target: number, k: number, c: number, dt: number) {
  if (dt <= 0) {
    s.v = target;
    s.dv = 0;
    return;
  }
  const steps = substeps(dt);
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    s.dv += (k * (target - s.v) - c * s.dv) * h;
    s.v += s.dv * h;
  }
}
