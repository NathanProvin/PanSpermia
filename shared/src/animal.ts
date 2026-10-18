// Tier 3 — small multicellular animals: rotifers, water fleas, worms, larvae. Same pool, several times a
// eukaryote's size. Filter combs sweep up specks (bacteria, algae, dissolved food) like a water flea;
// mandibles bite: they swallow eukaryotes and smaller, and wound tier-3 rivals in front. Paddle legs steer
// precisely, a tail drives fast in wide turns. The body is a chain of segments (P9b makes it editable).
import { bitsOf, makeCatalog } from './genes.ts';

export const TIER3 = makeCatalog({
  paddle: { upkeep: 0.15, price: 20, maxCopies: 3, slot: 'membrane', at: 1.6, label: 'Paddle legs' },
  tail: { upkeep: 0.25, price: 30, maxCopies: 2, slot: 'membrane', at: Math.PI, label: 'Tail' },
  filterComb: { upkeep: 0.1, price: 25, maxCopies: 2, slot: 'membrane', at: 0.5, label: 'Filter combs' },
  mandible: { upkeep: 0.15, price: 30, maxCopies: 3, slot: 'membrane', at: 0, label: 'Mandibles' },
  eye: { upkeep: 0.03, price: 10, maxCopies: 3, slot: 'internal', at: [0.62, 0.22], label: 'Eye' },
  carapace: { upkeep: 0.2, price: 35, maxCopies: 1, slot: 'coat', at: 0, label: 'Carapace' },
  // Richer catalog (user direction: ~15 parts a phase, from microscopic feeding, locomotion and defence). Appended.
  // A rotifer's mastax: grinding jaws, the grazing mouth — plant food, big plants worth more.
  mastax: { upkeep: 0.15, price: 30, maxCopies: 3, slot: 'membrane', at: 0, label: 'Mastax' },
  // A tardigrade's stylets: a spear in a buccal tube and a pharyngeal pump — the parasitic mouth.
  stylet: { upkeep: 0.15, price: 30, maxCopies: 2, slot: 'membrane', at: 0.25, label: 'Stylet' },
  // A nauplius's setose limbs: sieve small plant food and row in jumps and glides.
  oars: { upkeep: 0.15, price: 25, maxCopies: 3, slot: 'membrane', at: 1.3, label: 'Setose oars' },
  // A nematode's body-wall muscles: a strong swimming wave down the body.
  muscles: { upkeep: 0.2, price: 25, maxCopies: 2, slot: 'internal', at: [-0.05, 0], label: 'Body-wall muscles' },
  // A tardigrade's stubby clawed legs: a steady crawl that holds its ground.
  lobopods: { upkeep: 0.1, price: 20, maxCopies: 3, slot: 'membrane', at: 2.0, label: 'Lobopods' },
  // Stinging capsules: a sting cloud around the head on left click.
  nematocysts: { upkeep: 0.2, price: 35, maxCopies: 2, slot: 'internal', at: [0.35, 0.25], label: 'Nematocysts' },
  // Long anti-predator spines: too wide for any mouth but a much bigger one.
  spines: { upkeep: 0.05, price: 25, maxCopies: 3, slot: 'membrane', at: 2.6, label: 'Spines' },
  // Cryptobiosis: on right click, an armoured, dried-out barrel that nothing can harm, for a few seconds.
  tun: { upkeep: 0.1, price: 40, maxCopies: 1, slot: 'internal', at: [-0.3, -0.2], label: 'Tun' },
  // Lipid stores: a lower burn.
  oil: { upkeep: 0, price: 15, maxCopies: 3, slot: 'internal', at: [-0.2, 0.3], label: 'Oil droplets' },
});
export type Gene3 = (typeof TIER3.NAMES)[number];

/** A newly evolved animal: paddles to steer, filter combs to feed, an eye (a water-flea larva). */
export const STARTER_GENOME3 = TIER3.genomeOf(['paddle', 'paddle', 'filterComb', 'eye']);
export const STARTER_LIBRARY3 = bitsOf(TIER3.GENES.paddle.bit, TIER3.GENES.tail.bit, TIER3.GENES.filterComb.bit,
  TIER3.GENES.mandible.bit, TIER3.GENES.eye.bit);

/**
 * Body plans: stations in a chain along a spine (worms, larvae, crustaceans, slugs), or arms around a centre (radial).
 * Tiers 3 and 4 both offer them (user direction: the same rules). Arthropod and Mollusk are older tier-4 plans, kept
 * so old cards still read; a tier-4 body now looks soft (mollusk) or plated (arthropod) by its parts.
 */
export const PLAN_NAMES = ['Spine', 'Radial', 'Arthropod', 'Mollusk'] as const;
export const ARTHROPOD = 2;
export const MOLLUSK = 3;
/** The plans each animal tier offers (PLAN_NAMES indices); the first is a new species' default. */
export const PLANS_OF: Readonly<Record<number, readonly number[]>> = { 3: [0, 1], 4: [0, 1] };
export const MIN_SEGMENTS = 2;
export const MAX_SEGMENTS = 8; // stations along the body: long worms need more than the old 6 segments
/** Relative segment sizes the editor allows (the body is then fitted to the cell, so only proportions matter). */
export const SEGMENT_MIN = 0.3;
export const SEGMENT_MAX = 1;
/** A head, a thorax, an abdomen. */
export const DEFAULT_RADII: readonly number[] = [0.45, 0.75, 0.5];
/** Each plan's starting body: a spine; a radial centre with lobes; a crayfish's head, thorax and tapering tail; a snail's head and body. */
export const DEFAULT_RADII_OF: readonly (readonly number[])[] = [DEFAULT_RADII, [0.6, 0.4], [0.42, 0.6, 0.55, 0.42, 0.3], [0.4, 0.9]];
/**
 * A radial body: arms around a centre, each a little spine of up to MAX_ARM stations (the same width profile and bends
 * for every arm: rotational symmetry). Its radii are [centre, arm station 1, …]; the arm count is Lineage.arms.
 */
export const RADIAL_ARMS = [3, 6] as const;
export const DEFAULT_ARMS = 4;
export const MAX_ARM = 3;
/** The most stations a body has (the shader's arrays): a six-armed body with three stations an arm. */
export const MAX_STATIONS = 1 + RADIAL_ARMS[1] * MAX_ARM;

export type Segment = readonly [x: number, y: number, r: number];

/** The most a spine may turn at one station when sculpted (rad): enough for a comma, or a spiral over 8 stations. */
export const MAX_BEND = 0.9;

/** A laid-out body: its stations, and how many stations each radial arm has (0: a spine). */
export type Body = readonly Segment[] & { readonly arm?: number };
/** Stations per radial arm (0: a spine). */
export const armOf = (segments: Body) => segments.arm ?? 0;
/** The station a link reaches back to: the one before it, or the centre for an arm's first station. */
export const parentOf = (i: number, arm: number) => (arm > 0 && (i - 1) % arm === 0 ? 0 : i - 1);

/**
 * Lay out a body (canonical body frame: x forward, in cell radii), then scale it to span about the cell's circle.
 * Spine: radii[0] is the head, each next station overlaps the one before it toward the back, the spine turning at
 * each station by `bends` (rad; index 0, the head, and the last station turn nothing) — a comma, an S, a spiral; the
 * bounding box is centred. Radial: radii[0] is the centre at the origin, and `arms` arms (from the front, evenly
 * around) each lay out radii[1…] with the same bends — a pinwheel. `arms` 0 on a radial body is the older format
 * (bots, old cards): every radius after the centre is a one-station lobe.
 */
export function segmentsOf(plan: number, radii: readonly number[], bends: readonly number[] = [], arms = 0): Body {
  let segs: [number, number, number][];
  let arm = 0;
  // A chain of stations heading `dir` from the origin (its first one `first` out), each link turning by the bend at the
  // station it leaves. `base`: the radii index of profile[0] (bends are indexed like radii); the head and the centre
  // (index 0) turn nothing.
  const chainOf = (profile: readonly number[], dir: number, first: number, base: number) => {
    let [x, y] = [Math.cos(dir) * first, Math.sin(dir) * first];
    return profile.map((r, i): [number, number, number] => {
      if (i > 0) {
        if (base + i - 1 > 0) dir += bends[base + i - 1] ?? 0;
        const d = 0.75 * (profile[i - 1]! + r);
        x += Math.cos(dir) * d;
        y += Math.sin(dir) * d;
      }
      return [x, y, r];
    });
  };
  if (plan === 1) {
    const [centre = 0.6, ...profile] = radii;
    const n = arms || profile.length;
    const arm1 = arms ? profile : profile.slice(0, 1);
    arm = arm1.length;
    segs = [[0, 0, centre]];
    for (let k = 0; k < n; k++) {
      const one = arms ? arm1 : [profile[k] ?? profile[0]!];
      segs.push(...chainOf(one, (2 * Math.PI * k) / n, centre + one[0]! * 0.35, 1));
    }
  } else {
    segs = chainOf(radii, Math.PI, 0, 0);
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
  return Object.assign(segs.map(([x, y, r]) => [x * k, y * k, r * k] as const), { arm });
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
export function animalSdf(x: number, y: number, segments: Body = DEFAULT_SEGMENTS) {
  const arm = armOf(segments);
  let d = Infinity;
  for (let i = 1; i < segments.length; i++) {
    const [ax, ay, ar] = segments[parentOf(i, arm)]!;
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
export function animalRim(angle: number, segments: Body = DEFAULT_SEGMENTS) {
  let lo = 0;
  let hi = 2;
  for (let i = 0; i < 20; i++) { // bisection: the centre is inside, 2 radii out is outside
    const mid = (lo + hi) / 2;
    if (animalSdf(Math.cos(angle) * mid, Math.sin(angle) * mid, segments) < 0) lo = mid;
    else hi = mid;
  }
  return lo;
}
