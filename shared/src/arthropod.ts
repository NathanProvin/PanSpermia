// Tier 4 — arthropods and mollusks: crayfish, beetle larvae, water snails, little squid. The biggest life in the
// pool. Two body plans share one catalog (P10b: the plan decides which parts fit): an arthropod walks on jointed
// legs or flips a tail fan, grazes with mouthparts or crushes with claws, under a hard exoskeleton; a mollusk
// glides on a muscular foot or jets through a siphon, rasps with a radula or bites with a beak, under a shell.
// Mouths set the diet as before: grazers sweep up plant food and specks, claws and beaks take meat and swallow
// single cells and smaller animals, and bite whatever is too big.
import { makeCatalog } from './genes.ts';

export const TIER4 = makeCatalog({
  legs: { upkeep: 0.4, price: 40, maxCopies: 3, slot: 'membrane', at: 1.7, label: 'Walking legs' },
  tailFan: { upkeep: 0.6, price: 60, maxCopies: 1, slot: 'membrane', at: Math.PI, label: 'Tail fan' },
  claw: { upkeep: 0.4, price: 60, maxCopies: 2, slot: 'membrane', at: 0.45, label: 'Claws' },
  maxillae: { upkeep: 0.2, price: 40, maxCopies: 1, slot: 'membrane', at: 0, label: 'Grazing mouthparts' },
  exoskeleton: { upkeep: 0.5, price: 70, maxCopies: 1, slot: 'coat', at: 0, label: 'Exoskeleton' },
  foot: { upkeep: 0.3, price: 40, maxCopies: 1, slot: 'coat', at: 0, label: 'Muscular foot' },
  siphon: { upkeep: 0.5, price: 55, maxCopies: 1, slot: 'membrane', at: Math.PI, label: 'Siphon' },
  radula: { upkeep: 0.2, price: 40, maxCopies: 1, slot: 'membrane', at: 0, label: 'Radula' },
  beak: { upkeep: 0.3, price: 55, maxCopies: 1, slot: 'membrane', at: 0, label: 'Beak' },
  shell: { upkeep: 0.6, price: 80, maxCopies: 1, slot: 'coat', at: 0, label: 'Shell' },
  eye: { upkeep: 0.05, price: 15, maxCopies: 3, slot: 'internal', at: [0.55, 0.2], label: 'Eye' },
  // P10d — a mollusk's escape: right click squirts a big ink cloud behind it and jets away (bots can't see into ink).
  inkSac: { upkeep: 0.3, price: 50, maxCopies: 1, slot: 'internal', at: [-0.45, 0], label: 'Ink sac' },
});
export type Gene4 = (typeof TIER4.NAMES)[number];

/** A newly evolved arthropod: a pair of walking legs, grazing mouthparts, an eye. */
export const STARTER_GENOME4 = TIER4.genomeOf(['legs', 'legs', 'maxillae', 'eye']);
/** Both plans' basics; the exoskeleton, the shell and the siphon are found (meteor shards). */
export const STARTER_LIBRARY4 = TIER4.GENES.legs.bit | TIER4.GENES.tailFan.bit | TIER4.GENES.claw.bit
  | TIER4.GENES.maxillae.bit | TIER4.GENES.eye.bit | TIER4.GENES.foot.bit | TIER4.GENES.radula.bit | TIER4.GENES.beak.bit;

/** What each tier-4 plan can wear (one-copy bits; the eye fits both). */
const PLAN_PARTS: Readonly<Record<number, number>> = {
  2: ['legs', 'tailFan', 'claw', 'maxillae', 'exoskeleton', 'eye'].reduce((m, g) => m | TIER4.GENES[g as Gene4].bit, 0),
  3: ['foot', 'siphon', 'radula', 'beak', 'shell', 'eye', 'inkSac'].reduce((m, g) => m | TIER4.GENES[g as Gene4].bit, 0),
};
/** Whether a part (its one-copy bit) fits a body plan; plans without a list take any part of their tier. */
export const fitsPlan = (plan: number, bit: number) => ((PLAN_PARTS[plan] ?? ~0) & bit) !== 0;

/** Mouthparts that sweep up plant food (and bacteria, as specks), and those that take meat, bite and swallow. */
export const grazes4 = (genome4: number) => TIER4.hasGene(genome4, 'maxillae') || TIER4.hasGene(genome4, 'radula');
export const hunts4 = (genome4: number) => TIER4.hasGene(genome4, 'claw') || TIER4.hasGene(genome4, 'beak');
