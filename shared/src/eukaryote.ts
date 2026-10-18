// Tier 2 — eukaryotes: Spore's cell stage. Same pool as the bacteria, about 3–10× their size. Mouths set
// the diet (filter: plant food; jaw: meat and whole smaller cells; both: omnivore), cilia and flagella
// steer (no run-and-tumble: eukaryotes turn smoothly). Parts are added as their mechanics land.
import { TIER3 } from './animal.ts';
import { TIER4 } from './arthropod.ts';
import { type Catalog, TIER1, bitsOf, makeCatalog } from './genes.ts';

export const TIER2 = makeCatalog({
  cilia: { upkeep: 0.03, price: 10, maxCopies: 3, slot: 'membrane', at: 2.0, label: 'Cilia' },
  flagellum: { upkeep: 0.05, price: 25, maxCopies: 3, slot: 'membrane', at: Math.PI, label: 'Flagellum' },
  filter: { upkeep: 0.02, price: 15, maxCopies: 1, slot: 'membrane', at: 0.45, label: 'Filter mouth' },
  jaw: { upkeep: 0.03, price: 20, maxCopies: 1, slot: 'membrane', at: 0, label: 'Jaw' },
  // P8c — weapons, the jet, eyes. Spikes only stab where they point; the electric organ shocks anything
  // touching the body; poison is left behind as a cloud (left click); the jet is a dash (right click/Shift).
  spike: { upkeep: 0.03, price: 18, maxCopies: 3, slot: 'membrane', at: 0.3, label: 'Spike' },
  poison: { upkeep: 0.03, price: 22, maxCopies: 2, slot: 'membrane', at: 2.6, label: 'Poison gland' },
  electric: { upkeep: 0.05, price: 30, maxCopies: 2, slot: 'internal', at: [-0.35, -0.3], label: 'Electric organ' },
  jet: { upkeep: 0.04, price: 25, maxCopies: 1, slot: 'membrane', at: -2.6, label: 'Jet' },
  eye: { upkeep: 0.005, price: 8, maxCopies: 3, slot: 'internal', at: [0.45, 0.2], label: 'Eye' },
  // P8d — organelles from endosymbiosis: swallowed bacteria that became part of the cell.
  mitochondrion: { upkeep: 0, price: 20, maxCopies: 3, slot: 'internal', at: [-0.45, 0.25], label: 'Mitochondrion' },
  chloroplast: { upkeep: 0, price: 20, maxCopies: 3, slot: 'internal', at: [0.1, -0.45], label: 'Chloroplast' },
  // Richer catalog (user direction: ~15 parts a phase, balanced roles). Appended: earlier indices stay valid.
  // A parasite's feeding tube (myzocytosis): pierces a bigger cell or an animal it touches and sucks it dry.
  peduncle: { upkeep: 0.03, price: 25, maxCopies: 2, slot: 'membrane', at: -0.35, label: 'Peduncle' },
  // A predatory dinoflagellate's veil: wraps prey bigger than a jaw could take and digests it outside the cell.
  pallium: { upkeep: 0.04, price: 30, maxCopies: 1, slot: 'membrane', at: 0, label: 'Pallium' },
  // Cellulose plates in the membrane: armour against bites, a little slower.
  theca: { upkeep: 0.03, price: 30, maxCopies: 1, slot: 'coat', at: 0, label: 'Theca' },
  // Ballistic harpoons: fired in front on left click (with any poison), a short, brutal burst.
  trichocysts: { upkeep: 0.03, price: 28, maxCopies: 2, slot: 'internal', at: [0.3, 0.28], label: 'Trichocysts' },
});
export type Gene2 = (typeof TIER2.NAMES)[number];

/** A newly evolved eukaryote: a little cilia to steer and both mouths (omnivore) until the editor says otherwise. */
export const STARTER_GENOME2 = TIER2.genomeOf(['cilia', 'filter', 'jaw']);
/** Parts a new eukaryote can buy at once; weapons and the jet are found (meteor shards, eaten eukaryotes). */
export const STARTER_LIBRARY2 = bitsOf(TIER2.GENES.cilia.bit, TIER2.GENES.flagellum.bit, TIER2.GENES.filter.bit,
  TIER2.GENES.jaw.bit, TIER2.GENES.eye.bit);

/** The highest tier that exists so far; Evolve is offered below it. */
export const MAX_TIER = 4;
/** Phase names (user: phase 3 is plankton, phase 4 animals); arthropod / mollusk are tier 4's body plans. */
export const TIER_NAMES = ['', 'Bacterium', 'Eukaryote', 'Plankton', 'Animal'] as const;
/** The part catalog of a tier: the editor, rendering, validation and cards all go through this. */
export const catalogFor = (tier: number) => (tier === 4 ? TIER4 : tier === 3 ? TIER3 : tier === 2 ? TIER2 : TIER1) as unknown as Catalog;
/** Many-celled bodies (tier 3 up): segments, a mouth at the head, a mate call, bites. */
export const isAnimal = (tier: number) => tier >= 3;
