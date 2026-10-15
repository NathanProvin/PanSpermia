// Tier-1 gene catalog. A genome packs a copy count (0–3) per gene in 2 bits, so `GENES.x.bit` is one
// copy of x and ORing bits of different genes builds a genome. Extra copies stack with diminishing
// returns (see `stack`); every copy costs upkeep (mass/s on top of metabolism): bigger genomes must
// eat more, which is real biology and free balancing. `price` is the DNA cost of one copy in the editor.
// Genes are added here as their mechanics land; append only (the index is the wire format).
const CATALOG = {
  pili: { upkeep: 0.006, price: 8, maxCopies: 3, label: 'Type IV pili' },
  flagellum: { upkeep: 0.015, price: 20, maxCopies: 3, label: 'Flagellum' },
  chemoreceptor: { upkeep: 0.004, price: 12, maxCopies: 2, label: 'Chemoreceptor' },
  transporters: { upkeep: 0.008, price: 10, maxCopies: 3, label: 'Transporters' },
  siderophores: { upkeep: 0.01, price: 12, maxCopies: 2, label: 'Siderophores' },
  exoenzymes: { upkeep: 0.008, price: 10, maxCopies: 3, label: 'Exoenzymes' },
  bacteriocin: { upkeep: 0.01, price: 18, maxCopies: 3, label: 'Bacteriocin' },
  poreFormer: { upkeep: 0.012, price: 22, maxCopies: 3, label: 'Pore-forming toxin' },
  t6ss: { upkeep: 0.012, price: 20, maxCopies: 3, label: 'Type VI secretion' },
  capsule: { upkeep: 0.008, price: 15, maxCopies: 1, label: 'Capsule' },
  thickWall: { upkeep: 0.01, price: 18, maxCopies: 1, label: 'Thick wall' },
  effluxPump: { upkeep: 0.006, price: 12, maxCopies: 1, label: 'Efflux pump' },
  endospore: { upkeep: 0.006, price: 20, maxCopies: 1, label: 'Endospore' },
} as const;
export type Gene = keyof typeof CATALOG;
export const GENE_NAMES = Object.keys(CATALOG) as Gene[];
export const GENES = Object.fromEntries(GENE_NAMES.map((g, index) =>
  [g, { ...CATALOG[g], index, bit: 1 << (2 * index) }])) as { [G in Gene]: (typeof CATALOG)[G] & { index: number; bit: number } };

/** New individuals start able to steer precisely, if slowly. */
export const STARTER_GENOME = GENES.pili.bit;

export const copiesOf = (genome: number, gene: Gene) => (genome >>> (2 * GENES[gene].index)) & 3;
export const hasGene = (genome: number, gene: Gene) => copiesOf(genome, gene) > 0;
/** `genome` with exactly `n` copies of `gene` (clamped to 0–3). */
export const withCopies = (genome: number, gene: Gene, n: number) => {
  const shift = 2 * GENES[gene].index;
  return ((genome & ~(3 << shift)) | (Math.max(0, Math.min(3, n)) << shift)) >>> 0;
};
/** Genome from a list of genes, repeats meaning copies: ['flagellum', 'flagellum'] = two flagella. */
export const genomeOf = (genes: readonly Gene[]) =>
  genes.reduce((g, gene) => withCopies(g, gene, copiesOf(g, gene) + 1), 0);

/** Diminishing returns: total strength of n copies, each worth half the previous (0, 1, 1.5, 1.75). */
export const stack = (n: number) => 2 - 2 ** (1 - n);
export const upkeepOf = (genome: number) =>
  GENE_NAMES.reduce((sum, g) => sum + copiesOf(genome, g) * GENES[g].upkeep, 0);
/** DNA price of every copy in a genome. */
export const priceOf = (genome: number) =>
  GENE_NAMES.reduce((sum, g) => sum + copiesOf(genome, g) * GENES[g].price, 0);
/** Parts a new species can already buy; the rest arrive by gene transfer (fragments, plasmids). */
export const STARTER_LIBRARY = GENES.pili.bit | GENES.flagellum.bit | GENES.transporters.bit;
