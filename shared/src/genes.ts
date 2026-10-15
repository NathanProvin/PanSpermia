// Tier-1 gene catalog. A genome packs a copy count (0–3) per gene in 2 bits, so `GENES.x.bit` is one
// copy of x and ORing bits of different genes builds a genome. Extra copies stack with diminishing
// returns (see `stack`); every copy costs upkeep (mass/s on top of metabolism): bigger genomes must
// eat more, which is real biology and free balancing. `price` is the DNA cost of one copy in the editor.
// Genes are added here as their mechanics land; append only (the index is the wire format).
// slot: where the editor places it — on the membrane (snaps to the rim), inside the cytoplasm, or a
// coat over the whole body (no placement). `at`: default membrane angle (rad, 0 = front) or interior spot.
const CATALOG = {
  pili: { upkeep: 0.006, price: 8, maxCopies: 3, slot: 'membrane', at: 2.2, label: 'Type IV pili' },
  flagellum: { upkeep: 0.015, price: 20, maxCopies: 3, slot: 'membrane', at: Math.PI, label: 'Flagellum' },
  chemoreceptor: { upkeep: 0.004, price: 12, maxCopies: 2, slot: 'membrane', at: 0, label: 'Chemoreceptor' },
  transporters: { upkeep: 0.008, price: 10, maxCopies: 3, slot: 'membrane', at: 1.4, label: 'Transporters' },
  siderophores: { upkeep: 0.01, price: 12, maxCopies: 2, slot: 'internal', at: [-0.3, 0.3], label: 'Siderophores' },
  exoenzymes: { upkeep: 0.008, price: 10, maxCopies: 3, slot: 'internal', at: [0.3, -0.25], label: 'Exoenzymes' },
  bacteriocin: { upkeep: 0.01, price: 18, maxCopies: 3, slot: 'membrane', at: 0.8, label: 'Bacteriocin' },
  poreFormer: { upkeep: 0.012, price: 22, maxCopies: 3, slot: 'membrane', at: -0.8, label: 'Pore-forming toxin' },
  t6ss: { upkeep: 0.012, price: 20, maxCopies: 3, slot: 'membrane', at: 0.35, label: 'Type VI secretion' },
  capsule: { upkeep: 0.008, price: 15, maxCopies: 1, slot: 'coat', at: 0, label: 'Capsule' },
  thickWall: { upkeep: 0.01, price: 18, maxCopies: 1, slot: 'coat', at: 0, label: 'Thick wall' },
  effluxPump: { upkeep: 0.006, price: 12, maxCopies: 1, slot: 'membrane', at: -2.0, label: 'Efflux pump' },
  endospore: { upkeep: 0.006, price: 20, maxCopies: 1, slot: 'internal', at: [0, 0], label: 'Endospore' },
  // P8d — cyanobacterial thylakoid membranes: photosynthesis, mass from light (PHOTO_RATE × stack).
  thylakoid: { upkeep: 0.004, price: 15, maxCopies: 3, slot: 'internal', at: [-0.1, -0.35], label: 'Photosynthesis' },
  // P8f — adhesins: hooks that let a bacterium cling to a eukaryote and drain its energy (parasitism).
  adhesin: { upkeep: 0.004, price: 14, maxCopies: 2, slot: 'membrane', at: 0.2, label: 'Adhesins' },
} as const;
export type Gene = keyof typeof CATALOG;

/** Where the editor puts a part: on the membrane (snaps to the rim), inside, or a whole-body coat. */
export type Slot = 'membrane' | 'internal' | 'coat';
export interface CatalogEntry {
  upkeep: number; price: number; maxCopies: number; slot: Slot; at: number | readonly [number, number]; label: string;
}
/** A placed part, as on the wire (Part) and in the editor; x forward, y left, in cell radii. */
export interface Placement<G extends string = Gene> { gene: G; x: number; y: number; angle: number; scale: number; group: number }

/** Diminishing returns: total strength of n copies, each worth half the previous (0, 1, 1.5, 1.75). */
export const stack = (n: number) => 2 - 2 ** (1 - n);

/**
 * Genome helpers for one tier's part catalog. Each tier has its own catalog and genome field (tier 1:
 * `genome`, tier 2: `genome2`), so one tier's rules can never misread another tier's bits.
 */
export function makeCatalog<const C extends Record<string, CatalogEntry>>(entries: C) {
  type G = keyof C & string;
  const NAMES = Object.keys(entries) as G[];
  const GENES = Object.fromEntries(NAMES.map((g, index) => [g, { ...entries[g], index, bit: 1 << (2 * index) }])) as
    { [K in G]: C[K] & { index: number; bit: number } };
  const copiesOf = (genome: number, gene: G) => (genome >>> (2 * GENES[gene].index)) & 3;
  const withCopies = (genome: number, gene: G, n: number) => {
    const shift = 2 * GENES[gene].index;
    return ((genome & ~(3 << shift)) | (Math.max(0, Math.min(3, n)) << shift)) >>> 0;
  };
  return {
    GENES,
    NAMES,
    copiesOf,
    hasGene: (genome: number, gene: G) => copiesOf(genome, gene) > 0,
    /** `genome` with exactly `n` copies of `gene` (clamped to 0–3). */
    withCopies,
    /** Genome from a list of genes, repeats meaning copies: ['flagellum', 'flagellum'] = two flagella. */
    genomeOf: (genes: readonly G[]) => genes.reduce((g, gene) => withCopies(g, gene, copiesOf(g, gene) + 1), 0),
    upkeepOf: (genome: number) => NAMES.reduce((sum, g) => sum + copiesOf(genome, g) * GENES[g].upkeep, 0),
    /** DNA price of every copy in a genome. */
    priceOf: (genome: number) => NAMES.reduce((sum, g) => sum + copiesOf(genome, g) * GENES[g].price, 0),
    /**
     * A plausible layout for a genome that has no designed one (bots, dev-toggled cells, a new species):
     * every copy at its gene's default spot, extra copies fanned out around it — or, for a part on the side,
     * mirrored in pairs across the axis (legs, cilia). One group per gene.
     */
    defaultParts(genome: number): Placement<G>[] {
      const parts: Placement<G>[] = [];
      for (const [group, gene] of NAMES.entries()) {
        const { slot, at } = GENES[gene];
        const n = copiesOf(genome, gene);
        const side = slot === 'membrane' && Math.abs(Math.sin(at as number)) > 0.3;
        for (let k = 0; k < n; k++) {
          const fan = (k - (n - 1) / 2) * 0.5;
          if (slot === 'membrane') {
            const a = side ? (k % 2 ? -1 : 1) * ((at as number) + Math.floor(k / 2) * 0.5) : (at as number) + fan;
            parts.push({ gene, x: Math.cos(a), y: Math.sin(a), angle: a, scale: 1, group });
          } else {
            const [x, y] = slot === 'internal' ? (at as readonly [number, number]) : [0, 0];
            parts.push({ gene, x: x + fan * 0.4, y, angle: 0, scale: 1, group });
          }
        }
      }
      return parts;
    },
  };
}
export type Catalog = ReturnType<typeof makeCatalog<Record<string, CatalogEntry>>>;

export const TIER1 = makeCatalog(CATALOG);
export const { GENES, copiesOf, hasGene, withCopies, genomeOf, upkeepOf, priceOf, defaultParts } = TIER1;
export const GENE_NAMES = TIER1.NAMES;

/** New individuals start able to steer precisely, if slowly. */
export const STARTER_GENOME = GENES.pili.bit;
/** Parts a new species can already buy; the rest arrive by gene transfer (fragments, plasmids). */
export const STARTER_LIBRARY = GENES.pili.bit | GENES.flagellum.bit | GENES.transporters.bit;
