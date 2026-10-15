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

/** A placed part, as on the wire (Part) and in the editor; x forward, y left, in cell radii. */
export interface Placement { gene: Gene; x: number; y: number; angle: number; scale: number; group: number }

/**
 * A plausible layout for a genome that has no designed one (bots, dev-toggled cells, a new species):
 * every copy at its gene's default spot, extra copies fanned out around it. One group per gene.
 */
export function defaultParts(genome: number): Placement[] {
  const parts: Placement[] = [];
  for (const [group, gene] of GENE_NAMES.entries()) {
    const { slot, at } = GENES[gene];
    const n = copiesOf(genome, gene);
    for (let k = 0; k < n; k++) {
      const fan = (k - (n - 1) / 2) * 0.5;
      if (slot === 'membrane') {
        const a = (at as number) + fan;
        parts.push({ gene, x: Math.cos(a), y: Math.sin(a), angle: a, scale: 1, group });
      } else {
        const [x, y] = slot === 'internal' ? (at as readonly [number, number]) : [0, 0];
        parts.push({ gene, x: x + fan * 0.4, y, angle: 0, scale: 1, group });
      }
    }
  }
  return parts;
}
