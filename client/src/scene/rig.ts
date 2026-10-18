// Soft rig: client-side secondary motion, visual only (the server's circles and heading stay the truth).
// Chains run in world units, so a whip or a body segment lags behind where the body went, drags through
// the water and springs back; the caller reads the points back in the body frame the meshes draw in.
import { parentOf, wrapAngle } from '@panspermia/shared';

/** 1/s: how fast a chain point loses its own motion in water. */
const WATER_DRAG = 12;
/** 1/s: how hard a whip straightens out from its root (softer toward the tip). */
const WHIP_BEND = 40;
// Animal spine: a kinematic chain of link angles behind the head (lengths exact by construction, so segments
// can never come apart). Each link turns toward its parent's direction at speed / length (the body follows
// its head's path, as a worm's does) plus a slow straightening when still.
/** 1/s: how fast a still body straightens. */
const STRAIGHTEN = 1.5;
/** rad: the most one joint bends, and the most the whole body curls (it never folds onto itself). */
const MAX_JOINT = 0.45;
const MAX_CURL = 1.2;
/** Swimming undulation: a wave running head to tail (rad of bend, rad/s of phase idle → full swim, rad per link). */
const WAVE_AMP = [0.03, 0.22];
const WAVE_RATE = [1.5, 8];
const WAVE_LAG = 1.1;
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
  /** Spines: each link's world direction (segment i → i + 1), and the undulation's phase. */
  a: Float64Array; phase: number;
}

export const chain = (n: number): Chain => ({
  x: new Float64Array(n), y: new Float64Array(n), px: new Float64Array(n), py: new Float64Array(n), live: false, rx: 0, ry: 0, rdir: 0,
  a: new Float64Array(Math.max(0, n - 1)), phase: 0,
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
export function stepWhip(c: Chain, rx: number, ry: number, dir: number, link: number, dt: number, stiff = 1) {
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
      const k = 1 - Math.exp(-h * WHIP_BEND * stiff * (1 - (0.5 * i) / n));
      relax(c, i, c.x[i - 1]! + (dx / d) * link, c.y[i - 1]! + (dy / d) * link, k);
      keep(c, i, i - 1, link);
    }
  }
  [c.rx, c.ry, c.rdir] = [rx, ry, dir];
}

type Point = { readonly x: number; readonly y: number };

/** How far segment i has turned from its rest pose: the angle of its link to its parent, now vs at rest. */
export function segmentTurn(c: Chain, rest: readonly Point[], i: number, arm: number) {
  if (i === 0) return 0;
  const p = parentOf(i, arm);
  return wrapAngle(Math.atan2(c.y[p]! - c.y[i]!, c.x[p]! - c.x[i]!) - Math.atan2(rest[p]!.y - rest[i]!.y, rest[p]!.x - rest[i]!.x));
}

/**
 * An animal body, `rest` = where each segment would be on a rigid body (world). Segment 0 (head, or the
 * radial centre) is pinned there. Spine: a chain of links behind the head that follows its path (`speed`,
 * world u/s), undulating as it swims (`swim` 0..1), bend-limited per joint and overall. Radial: lobes on
 * springs around the centre (they lag and wobble). dt ≤ 0 or a dead chain snaps to rest.
 */
export function stepSpine(c: Chain, rest: readonly Point[], radial: boolean, dt: number, speed = 0, swim = 0, wave = 1) {
  const n = rest.length;
  const restDir = (i: number) => Math.atan2(rest[i + 1]!.y - rest[i]!.y, rest[i + 1]!.x - rest[i]!.x);
  if (!c.live || dt <= 0) {
    for (let i = 0; i < n; i++) place(c, i, rest[i]!.x, rest[i]!.y);
    for (let i = 0; i < n - 1; i++) c.a[i] = restDir(i);
    c.live = true;
    return;
  }
  const steps = substeps(dt);
  const h = dt / steps;
  if (radial) {
    for (let s = 0; s < steps; s++) {
      place(c, 0, rest[0]!.x, rest[0]!.y);
      drift(c, 1, h);
      for (let i = 1; i < n; i++) { // a lobe strays a little from its rest spot, no more
        const len = Math.hypot(rest[i]!.x - rest[0]!.x, rest[i]!.y - rest[0]!.y);
        relax(c, i, rest[i]!.x, rest[i]!.y, 1 - Math.exp(-h * LOBE_PULL));
        const dx = c.x[i]! - rest[i]!.x;
        const dy = c.y[i]! - rest[i]!.y;
        const d = Math.hypot(dx, dy);
        if (d > LOBE_SLACK * len) {
          c.x[i] = rest[i]!.x + (dx / d) * LOBE_SLACK * len;
          c.y[i] = rest[i]!.y + (dy / d) * LOBE_SLACK * len;
        }
      }
    }
    return;
  }
  c.phase += dt * (WAVE_RATE[0]! + (WAVE_RATE[1]! - WAVE_RATE[0]!) * swim);
  const amp = (WAVE_AMP[0]! + (WAVE_AMP[1]! - WAVE_AMP[0]!) * swim) * wave; // × body-wall muscles
  for (let s = 0; s < steps; s++) {
    let curl = 0;
    for (let i = 0; i < n - 1; i++) {
      const len = Math.hypot(rest[i + 1]!.x - rest[i]!.x, rest[i + 1]!.y - rest[i]!.y);
      // Where this link would point on a relaxed body: its parent's direction (the head: the body's own),
      // turned by the rest angle between them, plus the swimming wave.
      const along = i === 0 ? restDir(0) : c.a[i - 1]! + wrapAngle(restDir(i) - restDir(i - 1));
      const target = along + amp * Math.sin(c.phase - i * WAVE_LAG);
      c.a[i]! += wrapAngle(target - c.a[i]!) * (1 - Math.exp(-h * (speed / len + STRAIGHTEN)));
      const room = Math.min(MAX_JOINT, MAX_CURL - curl);
      const bend = Math.max(-room, Math.min(room, wrapAngle(c.a[i]! - along)));
      curl += Math.abs(bend);
      c.a[i] = along + bend;
    }
  }
  place(c, 0, rest[0]!.x, rest[0]!.y);
  for (let i = 0; i < n - 1; i++) {
    const len = Math.hypot(rest[i + 1]!.x - rest[i]!.x, rest[i + 1]!.y - rest[i]!.y);
    place(c, i + 1, c.x[i]! + Math.cos(c.a[i]!) * len, c.y[i]! + Math.sin(c.a[i]!) * len);
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
