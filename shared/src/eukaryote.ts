// Tier 2 — eukaryotes: Spore's cell stage. Same pool as the bacteria, about 3–10× their size. Mouths set
// the diet (filter: plant food; jaw: meat and whole smaller cells; both: omnivore), cilia and flagella
// steer (no run-and-tumble: eukaryotes turn smoothly). Parts are added as their mechanics land.
import { type Catalog, TIER1, makeCatalog } from './genes.ts';

export const TIER2 = makeCatalog({
  cilia: { upkeep: 0.03, price: 10, maxCopies: 3, slot: 'membrane', at: 2.0, label: 'Cilia' },
  flagellum: { upkeep: 0.05, price: 25, maxCopies: 3, slot: 'membrane', at: Math.PI, label: 'Flagellum' },
  filter: { upkeep: 0.02, price: 15, maxCopies: 1, slot: 'membrane', at: 0.45, label: 'Filter mouth' },
  jaw: { upkeep: 0.03, price: 20, maxCopies: 1, slot: 'membrane', at: 0, label: 'Jaw' },
});
export type Gene2 = (typeof TIER2.NAMES)[number];

/** A newly evolved eukaryote: a little cilia to steer and both mouths (omnivore) until the editor says otherwise. */
export const STARTER_GENOME2 = TIER2.genomeOf(['cilia', 'filter', 'jaw']);
export const STARTER_LIBRARY2 = TIER2.GENES.cilia.bit | TIER2.GENES.flagellum.bit | TIER2.GENES.filter.bit | TIER2.GENES.jaw.bit;

/** The highest tier that exists so far; Evolve is offered below it. */
export const MAX_TIER = 2;
export const TIER_NAMES = ['', 'Bacterium', 'Eukaryote'] as const;
/** The part catalog of a tier: the editor, rendering, validation and cards all go through this. */
export const catalogFor = (tier: number) => (tier === 2 ? TIER2 : TIER1) as unknown as Catalog;
