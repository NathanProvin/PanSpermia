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
 * Body segments of the default animal (canonical body frame: x forward, cell radii; [x, y, r]): a head,
 * a thorax, an abdomen. P9b lets the editor change them (spine or radial plan).
 */
export const DEFAULT_SEGMENTS: readonly (readonly [number, number, number])[] = [[0.55, 0, 0.45], [0, 0, 0.75], [-0.55, 0, 0.5]];

/** Blend radius (cell radii) of the smooth union that joins segments into one body. */
export const SEGMENT_BLEND = 0.12;

/** Signed distance (cell radii) from a canonical point to the segmented body, < 0 inside (as the body shader). */
export function animalSdf(x: number, y: number, segments = DEFAULT_SEGMENTS) {
  let d = Infinity;
  for (const [sx, sy, r] of segments) {
    const di = Math.hypot(x - sx, y - sy) - r;
    if (d === Infinity) d = di;
    else { // polynomial smooth minimum
      const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (di - d)) / SEGMENT_BLEND));
      d = di * (1 - h) + d * h - SEGMENT_BLEND * h * (1 - h);
    }
  }
  return d;
}

/** Distance from the body centre to the outline along a canonical direction: where membrane parts sit. */
export function animalRim(angle: number, segments = DEFAULT_SEGMENTS) {
  let lo = 0;
  let hi = 2;
  for (let i = 0; i < 20; i++) { // bisection: the centre is inside, 2 radii out is outside
    const mid = (lo + hi) / 2;
    if (animalSdf(Math.cos(angle) * mid, Math.sin(angle) * mid, segments) < 0) lo = mid;
    else hi = mid;
  }
  return lo;
}
