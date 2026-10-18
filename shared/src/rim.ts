// The pool's shore (user direction: a bigger pool whose edge is no longer a circle — a rugged, irregular rock wall cut by
// faults where small cells can hide from big filter feeders). One fixed pattern for every game and both sides of the
// wire: periodic value noise around the circle (five octaves) for the shore's irregular line, plus FAULT_COUNT narrow cracks
// running out into the rock, wedge-shaped (a gaussian in angle, so they narrow to nothing at their tip) with jagged
// sides. Tabulated once (RIM_SAMPLES around the circle) and read by linear interpolation; the client draws the bank from
// the same table.
import { WORLD_RADIUS } from './constants.ts';

export const RIM_SAMPLES = 8192;
export const FAULT_COUNT = 12;

/** A fixed hash: the same "random" numbers everywhere, every game. */
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
/** Smooth periodic noise in [0, 1] around the circle, `lattice` knots per turn. */
const ringNoise = (a: number, lattice: number, seed: number) => {
  const t = ((a / (2 * Math.PI)) % 1 + 1) % 1 * lattice;
  const i = Math.floor(t);
  const f = t - i;
  const s = f * f * (3 - 2 * f);
  return hash((i % lattice) + seed) * (1 - s) + hash(((i + 1) % lattice) + seed) * s;
};

/** The faults: where (angle), how deep into the rock (world units) and how wide at the mouth (rad). */
export const FAULTS = Array.from({ length: FAULT_COUNT }, (_, k) => ({
  angle: (2 * Math.PI * (k + 0.15 + 0.7 * hash(k + 100))) / FAULT_COUNT,
  depth: 900 + 1400 * hash(k + 200),
  width: (170 + 130 * hash(k + 300)) / WORLD_RADIUS,
}));

/** The irregular shore without its faults. */
const shoreAt = (a: number) => WORLD_RADIUS * (1 + 0.07 * (ringNoise(a, 7, 11) - 0.5) + 0.04 * (ringNoise(a, 23, 37) - 0.5)
  + 0.016 * (ringNoise(a, 71, 59) - 0.5) + 0.008 * (ringNoise(a, 211, 83) - 0.5) + 0.004 * (ringNoise(a, 613, 97) - 0.5));

const TABLE = new Float32Array(RIM_SAMPLES);
for (let i = 0; i < RIM_SAMPLES; i++) {
  const a = (2 * Math.PI * i) / RIM_SAMPLES;
  let r = shoreAt(a);
  for (const f of FAULTS) {
    const da = Math.atan2(Math.sin(a - f.angle), Math.cos(a - f.angle));
    r += f.depth * Math.exp(-((da / f.width) ** 2)) * (0.85 + 0.3 * ringNoise(a, 900, f.angle * 13)); // jagged sides
  }
  TABLE[i] = r;
}
/** The shore, sampled around the circle (the client's bank texture). */
export const RIM_TABLE: Readonly<Float32Array> = TABLE;
/** The farthest water from the centre (the tip of the deepest fault). */
export const RIM_MAX = Math.max(...TABLE);
export const RIM_MIN = Math.min(...TABLE);

/** Distance from the centre to the shore at angle `a`. */
export function rimAt(a: number) {
  const t = ((a / (2 * Math.PI)) % 1 + 1) % 1 * RIM_SAMPLES;
  const i = Math.floor(t);
  const f = t - i;
  return TABLE[i % RIM_SAMPLES]! * (1 - f) + TABLE[(i + 1) % RIM_SAMPLES]! * f;
}

/** Whether (x, y) is water, `margin` world units from the shore. */
export const insidePool = (x: number, y: number, margin = 0) => Math.hypot(x, y) <= rimAt(Math.atan2(y, x)) - margin;

/**
 * Keep a body of radius `r` in the water: the shore is read across the body's whole width, so a big body can't wedge
 * itself into a fault narrower than it is, while a small one swims right in. Returns the outward unit normal if it
 * was pushed back (to cancel outward velocity), else undefined.
 */
export function keepInPool(b: { x: number; y: number }, r: number): { nx: number; ny: number } | undefined {
  const d = Math.hypot(b.x, b.y);
  if (d < RIM_MIN - r) return undefined; // well inside: the common case
  const a = Math.atan2(b.y, b.x);
  const half = Math.min(Math.PI, r / Math.max(d, 1));
  let rim = Infinity;
  for (let s = -1; s <= 1; s += 0.25) rim = Math.min(rim, rimAt(a + half * s));
  const limit = rim - r;
  if (d <= limit) return undefined;
  const nx = b.x / d;
  const ny = b.y / d;
  b.x = nx * limit;
  b.y = ny * limit;
  return { nx, ny };
}

/** A random point in the water at least `margin` from the shore. */
export function randomInPool(margin = 0, random = Math.random) {
  for (;;) {
    const a = random() * 2 * Math.PI;
    const d = RIM_MAX * Math.sqrt(random());
    const p = { x: d * Math.cos(a), y: d * Math.sin(a) };
    if (insidePool(p.x, p.y, margin)) return p;
  }
}

/** A random spot deep in a fault, where only small cells fit (bacteria are born there more often). */
export function randomInFault(random = Math.random) {
  const f = FAULTS[Math.floor(random() * FAULT_COUNT)]!;
  const a = f.angle + (random() - 0.5) * f.width * 0.4;
  const base = shoreAt(f.angle);
  const d = base + 100 + random() * Math.max(0, f.depth * 0.75 - 100);
  return { x: d * Math.cos(a), y: d * Math.sin(a) };
}
