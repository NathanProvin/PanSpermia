// Hand-made tier-1 bot species: a genome plus a behaviour archetype. Shared so clients can name them
// (death screen, P4) and the headless balancing sim reads the same catalog as the server.
import type { Gene } from './genes.ts';

/**
 * grazer: feeds, dodges armed cells. hunter: chases smaller cells, attacks in range.
 * coward: feeds, flees anything foreign, sporulates when hurt. swarm: feeds in a pack, attacks intruders.
 */
export type Archetype = 'grazer' | 'hunter' | 'coward' | 'swarm';

/** genes: the design; a gene listed twice is two copies (stacking, like a player's editor design). shape: SHAPES index. */
export interface Species { name: string; archetype: Archetype; genes: readonly Gene[]; shape: number }

export const BOT_SPECIES: readonly Species[] = [
  { name: 'Nudus errans', archetype: 'grazer', genes: [], shape: 0 }, // geneless drifter: everyone's first meal
  { name: 'Pilus repens', archetype: 'grazer', genes: ['pili', 'pili', 'pili', 'siderophores'], shape: 0 }, // anchored filter
  { name: 'Vibrio celer', archetype: 'grazer', genes: ['flagellum', 'flagellum', 'chemoreceptor', 'transporters'], shape: 2 },
  { name: 'Mucus tardus', archetype: 'grazer', genes: ['pili', 'capsule', 'transporters', 'transporters'], shape: 0 },
  { name: 'Necrophagus', archetype: 'grazer', genes: ['flagellum', 'chemoreceptor', 'exoenzymes', 'transporters'], shape: 1 }, // scavenger that can also graze
  { name: 'Spina venator', archetype: 'hunter', genes: ['flagellum', 't6ss', 't6ss', 'exoenzymes'], shape: 1 },
  { name: 'Toxicus lentus', archetype: 'hunter', genes: ['pili', 'bacteriocin', 'bacteriocin', 'effluxPump'], shape: 0 },
  { name: 'Murus armatus', archetype: 'hunter', genes: ['pili', 'thickWall', 't6ss'], shape: 0 },
  { name: 'Fuga timida', archetype: 'coward', genes: ['flagellum', 'flagellum', 'endospore', 'capsule'], shape: 1 },
  { name: 'Grex acidus', archetype: 'swarm', genes: ['pili', 'pili', 'poreFormer', 'transporters'], shape: 2 },
  // P8d — photosynthesizers (cyanobacteria): they live on light, and they are where chloroplasts come from.
  { name: 'Cyanella viridis', archetype: 'grazer', genes: ['pili', 'thylakoid', 'thylakoid'], shape: 0 },
  { name: 'Lumibacter virens', archetype: 'grazer', genes: ['flagellum', 'thylakoid', 'thylakoid', 'capsule'], shape: 1 },
  { name: 'Chlorovibrio lentus', archetype: 'coward', genes: ['flagellum', 'thylakoid', 'thylakoid', 'thylakoid'], shape: 2 },
];
