// Tier-1 gene catalog. A genome is a bitmask of these. Expressing a gene costs upkeep (mass/s on top
// of metabolism): bigger genomes must eat more, which is real biology and free balancing.
// Genes are added here as their mechanics land (P3b feeding, P3c combat).
export const GENES = {
  pili: { bit: 1 << 0, upkeep: 0.006, label: 'Type IV pili' },
  flagellum: { bit: 1 << 1, upkeep: 0.015, label: 'Flagellum' },
  chemoreceptor: { bit: 1 << 2, upkeep: 0.004, label: 'Chemoreceptor' },
  transporters: { bit: 1 << 3, upkeep: 0.008, label: 'Transporters' },
  siderophores: { bit: 1 << 4, upkeep: 0.01, label: 'Siderophores' },
  exoenzymes: { bit: 1 << 5, upkeep: 0.008, label: 'Exoenzymes' },
} as const;
export type Gene = keyof typeof GENES;
export const GENE_NAMES = Object.keys(GENES) as Gene[];

/** New individuals start able to steer precisely, if slowly. */
export const STARTER_GENOME = GENES.pili.bit;

export const hasGene = (genome: number, gene: Gene) => (genome & GENES[gene].bit) !== 0;
export const upkeepOf = (genome: number) =>
  GENE_NAMES.reduce((sum, g) => (hasGene(genome, g) ? sum + GENES[g].upkeep : sum), 0);
