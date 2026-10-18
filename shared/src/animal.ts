// Tier 3 — small multicellular animals: rotifers, water fleas, worms, larvae. Same pool, several times a
// eukaryote's size. Filter combs sweep up specks (bacteria, algae, dissolved food) like a water flea;
// mandibles bite: they swallow eukaryotes and smaller, and wound tier-3 rivals in front. Paddle legs steer
// precisely, a tail drives fast in wide turns. The body is a chain of segments (P9b makes it editable).
import { makeCatalog } from './genes.ts';

export const TIER3 = makeCatalog({
  paddle: { upkeep: 0.15, price: 20, maxCopies: 3, slot: 'membrane', at: 1.6, label: 'Paddle legs' },
  tail: { upkeep: 0.25, price: 30, maxCopies: 2, slot: 'membrane', at: Math.PI, label: 'Tail' },
  filterComb: { upkeep: 0.1, price: 25, maxCopies: 2, slot: 'membrane', at: 0.5, label: 'Filter combs' },
  mandible: { upkeep: 0.15, price: 30, maxCopies: 1, slot: 'membrane', at: 0, label: 'Mandibles' },
  eye: { upkeep: 0.03, price: 10, maxCopies: 3, slot: 'internal', at: [0.62, 0.22], label: 'Eye' },
  carapace: { upkeep: 0.2, price: 35, maxCopies: 1, slot: 'coat', at: 0, label: 'Carapace' },
});
export type Gene3 = (typeof TIER3.NAMES)[number];

/** A newly evolved animal: paddles to steer, filter combs to feed, an eye (a water-flea larva). */
export const STARTER_GENOME3 = TIER3.genomeOf(['paddle', 'paddle', 'filterComb', 'eye']);
export const STARTER_LIBRARY3 = TIER3.GENES.paddle.bit | TIER3.GENES.tail.bit | TIER3.GENES.filterComb.bit
  | TIER3.GENES.mandible.bit | TIER3.GENES.eye.bit;

/**
 * Body plans. Tier 3: segments in a chain along the spine (worms, larvae), or lobes around a centre. Tier 4: an
 * arthropod (hard segmented plates) or a mollusk (a soft body: a head and a big visceral mass, under a shell if
 * it has one); both lay their segments out along a spine. Only plan 1 (radial) is laid out around a centre.
 */
export const PLAN_NAMES = ['Spine', 'Radial', 'Arthropod', 'Mollusk'] as const;
export const ARTHROPOD = 2;
export const MOLLUSK = 3;
/** The plans each animal tier offers (PLAN_NAMES indices); the first is a new species' default. */
export const PLANS_OF: Readonly<Record<number, readonly number[]>> = { 3: [0, 1], 4: [ARTHROPOD, MOLLUSK] };
export const MIN_SEGMENTS = 2;
export const MAX_SEGMENTS = 8; // stations along the body: long worms need more than the old 6 segments
/** Relative segment sizes the editor allows (the body is then fitted to the cell, so only proportions matter). */
export const SEGMENT_MIN = 0.3;
export const SEGMENT_MAX = 1;
/** A head, a thorax, an abdomen. */
export const DEFAULT_RADII: readonly number[] = [0.45, 0.75, 0.5];
/** Each plan's starting body: a spine; a radial centre with lobes; a crayfish's head, thorax and tapering tail; a snail's head and body. */
export const DEFAULT_RADII_OF: readonly (readonly number[])[] = [DEFAULT_RADII, [0.6, 0.4, 0.4, 0.4, 0.4], [0.42, 0.6, 0.55, 0.42, 0.3], [0.4, 0.9]];

export type Segment = readonly [x: number, y: number, r: number];

/**
 * Lay out a body (canonical body frame: x forward, in cell radii). Spine: radii[0] is the head, each next
 * segment overlaps the one before it toward the back. Radial: radii[0] is the centre, the others are lobes
 * evenly around it from the front. Then centred and scaled so the body spans about the cell's circle.
 */
/** The most a spine may turn at one station when sculpted (rad): enough for a comma, or a spiral over 8 stations. */
export const MAX_BEND = 0.9;

/**
 * `bends` (spine plans): the turn of the spine at each station, rad (index 0, the head, and the last station don't
 * turn anything) — a comma, an S, a spiral. Missing entries are straight.
 */
export function segmentsOf(plan: number, radii: readonly number[], bends: readonly number[] = []): Segment[] {
  let segs: [number, number, number][];
  if (plan === 1) {
    const [centre = 0.6, ...lobes] = radii;
    segs = [[0, 0, centre], ...lobes.map((r, k): [number, number, number] => {
      const a = (2 * Math.PI * k) / lobes.length;
      const d = centre + r * 0.35;
      return [Math.cos(a) * d, Math.sin(a) * d, r];
    })];
  } else {
    // Back from the head, each link turning by the bend at the station it leaves from.
    let [x, y, dir] = [0, 0, Math.PI];
    segs = radii.map((r, i): [number, number, number] => {
      if (i > 0) {
        if (i > 1) dir += bends[i - 1] ?? 0;
        const d = 0.75 * (radii[i - 1]! + r);
        x += Math.cos(dir) * d;
        y += Math.sin(dir) * d;
      }
      return [x, y, r];
    });
    // Centre the body's bounding box on the cell (a straight body: as before).
    const lo = [Math.min(...segs.map(([sx, , r]) => sx - r)), Math.min(...segs.map(([, sy, r]) => sy - r))];
    const hi = [Math.max(...segs.map(([sx, , r]) => sx + r)), Math.max(...segs.map(([, sy, r]) => sy + r))];
    for (const seg of segs) {
      seg[0] -= (lo[0]! + hi[0]!) / 2;
      seg[1] -= (lo[1]! + hi[1]!) / 2;
    }
  }
  const extent = Math.max(...segs.map(([x, y, r]) => Math.max(Math.abs(x), Math.abs(y)) + r));
  const k = (plan === 1 ? 1.05 : 1.3) / extent;
  return segs.map(([x, y, r]) => [x * k, y * k, r * k] as const);
}

/** The default animal body (bots, a newly evolved species). */
export const DEFAULT_SEGMENTS = segmentsOf(0, DEFAULT_RADII);

/**
 * Id prefix of an answering mate: a server-driven Player of the caller's species (the caller's id follows).
 * Session ids never contain '~'. Mates are inert: they neither eat, fight, metabolize nor take damage.
 */
export const MATE_PREFIX = '~mate:';
export const isMate = (id: string) => id.startsWith(MATE_PREFIX);

/** Blend radius (cell radii) of the smooth union that joins the tube's links into one body. */
export const SEGMENT_BLEND = 0.08;

/**
 * Signed distance (cell radii) from a canonical point to the animal's body, < 0 inside (as the body shader). The body
 * is one continuous tube (polish: clay, not bubbles): each link between consecutive stations (a spine) — or from the
 * centre to each lobe (radial) — is a cone whose radius goes linearly from one station's to the next's, with round
 * caps, the links smoothly joined. Only a radial body's centre sits exactly at the origin (segmentsOf).
 */
export function animalSdf(x: number, y: number, segments: readonly Segment[] = DEFAULT_SEGMENTS) {
  const radial = segments[0]![0] === 0 && segments[0]![1] === 0;
  let d = Infinity;
  for (let i = 1; i < segments.length; i++) {
    const [ax, ay, ar] = segments[radial ? 0 : i - 1]!;
    const [bx, by, br] = segments[i]!;
    const abx = bx - ax;
    const aby = by - ay;
    const h = Math.max(0, Math.min(1, ((x - ax) * abx + (y - ay) * aby) / Math.max(abx * abx + aby * aby, 1e-9)));
    const di = Math.hypot(x - ax - abx * h, y - ay - aby * h) - (ar + (br - ar) * h);
    if (d === Infinity) d = di;
    else { // polynomial smooth minimum
      const k = Math.max(0, Math.min(1, 0.5 + (0.5 * (di - d)) / SEGMENT_BLEND));
      d = di * (1 - k) + d * k - SEGMENT_BLEND * k * (1 - k);
    }
  }
  return d;
}

/** Distance from the body centre to the outline along a canonical direction: where membrane parts sit. */
export function animalRim(angle: number, segments: readonly Segment[] = DEFAULT_SEGMENTS) {
  let lo = 0;
  let hi = 2;
  for (let i = 0; i < 20; i++) { // bisection: the centre is inside, 2 radii out is outside
    const mid = (lo + hi) / 2;
    if (animalSdf(Math.cos(angle) * mid, Math.sin(angle) * mid, segments) < 0) lo = mid;
    else hi = mid;
  }
  return lo;
}
