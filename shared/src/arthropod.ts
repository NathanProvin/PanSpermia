// Tier 4 — arthropods and mollusks: crayfish, beetle larvae, water snails, little squid. The biggest life in the
// pool. Two body plans share one catalog (P10b: the plan decides which parts fit): an arthropod walks on jointed
// legs or flips a tail fan, grazes with mouthparts or crushes with claws, under a hard exoskeleton; a mollusk
// glides on a muscular foot or jets through a siphon, rasps with a radula or bites with a beak, under a shell.
// Mouths set the diet as before: grazers sweep up plant food and specks, claws and beaks take meat and swallow
// single cells and smaller animals, and bite whatever is too big.
import { bitsOf, makeCatalog, PART_PRICE_SCALE } from './genes.ts';

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
  // Richer catalog (user direction: ~15 parts a phase). Appended.
  // A leech's or ribbon worm's eversible proboscis: the parasitic mouth — drains another animal it touches.
  proboscis: { upkeep: 0.25, price: 50, maxCopies: 1, slot: 'membrane', at: 0.15, label: 'Proboscis' },
  // A sea slug's cerata, tipped with stolen stinging cells (kleptocnids): a biter gets stung back.
  cerata: { upkeep: 0.2, price: 45, maxCopies: 3, slot: 'membrane', at: 2.4, label: 'Cerata' },
  // Long jointed antennae: the animal senses further (its view widens, like eyes).
  antennae: { upkeep: 0.04, price: 20, maxCopies: 2, slot: 'membrane', at: 0.4, label: 'Antennae' },
  // A jellyfish's trailing tentacles: the filtering mouth — they catch the eukaryotes drifting into them.
  filterTentacles: { upkeep: 0.15, price: 40, maxCopies: 3, slot: 'membrane', at: Math.PI, label: 'Filtering tentacles' },
  // A coral polyp's crown of stinging tentacles: catches eukaryotes and plankton that brush against it.
  polypTentacles: { upkeep: 0.2, price: 45, maxCopies: 3, slot: 'membrane', at: 0, label: 'Polyp tentacles' },
  // A fish's fins: fast, agile swimming.
  fins: { upkeep: 0.2, price: 45, maxCopies: 3, slot: 'membrane', at: 2.4, label: 'Fins' },
  // Feathery external gills: more oxygen — a lower burn and a little more speed.
  gills: { upkeep: 0, price: 35, maxCopies: 3, slot: 'membrane', at: 1.2, label: 'External gills' },
}, PART_PRICE_SCALE[4]);
export type Gene4 = (typeof TIER4.NAMES)[number];

/** A newly evolved arthropod: a pair of walking legs, grazing mouthparts, an eye. */
export const STARTER_GENOME4 = TIER4.genomeOf(['legs', 'legs', 'maxillae', 'eye']);
/** The bare minimum (legs and grazing maxillae); everything else is found (plasmids, meteor shards). */
export const STARTER_LIBRARY4 = bitsOf(TIER4.GENES.legs.bit, TIER4.GENES.maxillae.bit);

/** A tier-4 body looks soft and slick (a mollusk, a jellyfish, a polyp, a fish) with a foot, a shell, tentacles, fins or gills; otherwise plated chitin. */
export const softBody4 = (genome4: number) => TIER4.hasGene(genome4, 'foot') || TIER4.hasGene(genome4, 'shell')
  || TIER4.hasGene(genome4, 'filterTentacles') || TIER4.hasGene(genome4, 'polypTentacles') // cnidarians: soft, no plates
  || TIER4.hasGene(genome4, 'fins') || TIER4.hasGene(genome4, 'gills'); // a fish: smooth skin

/** Mouthparts that sweep up plant food (and bacteria, as specks), and those that take meat, bite and swallow. */
export const grazes4 = (genome4: number) => TIER4.hasGene(genome4, 'maxillae') || TIER4.hasGene(genome4, 'radula');
export const hunts4 = (genome4: number) => TIER4.hasGene(genome4, 'claw') || TIER4.hasGene(genome4, 'beak');
