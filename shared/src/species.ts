// Hand-made tier-1 bot species: a genome plus a behaviour archetype. Shared so clients can name them
// (death screen, P4) and the headless balancing sim reads the same catalog as the server.
import type { Gene } from './genes.ts';

/**
 * grazer: feeds, dodges armed cells. hunter: chases smaller cells, attacks in range.
 * coward: feeds, flees anything foreign, sporulates when hurt. swarm: feeds in a pack, attacks intruders.
 */
export type Archetype = 'grazer' | 'hunter' | 'coward' | 'swarm';

/** genes: the design; a gene listed twice is two copies (stacking, like a player's editor design). */
export interface Species { name: string; archetype: Archetype; genes: readonly Gene[] }

export const BOT_SPECIES: readonly Species[] = [
  { name: 'Nudus errans', archetype: 'grazer', genes: [] }, // geneless drifter: everyone's first meal
  { name: 'Pilus repens', archetype: 'grazer', genes: ['pili', 'pili', 'pili', 'siderophores'] }, // anchored filter
  { name: 'Vibrio celer', archetype: 'grazer', genes: ['flagellum', 'flagellum', 'chemoreceptor', 'transporters'] },
  { name: 'Mucus tardus', archetype: 'grazer', genes: ['pili', 'capsule', 'transporters', 'transporters'] },
  { name: 'Necrophagus', archetype: 'grazer', genes: ['flagellum', 'chemoreceptor', 'exoenzymes', 'transporters'] }, // scavenger that can also graze
  { name: 'Spina venator', archetype: 'hunter', genes: ['flagellum', 't6ss', 't6ss', 'exoenzymes'] },
  { name: 'Toxicus lentus', archetype: 'hunter', genes: ['pili', 'bacteriocin', 'bacteriocin', 'effluxPump'] },
  { name: 'Murus armatus', archetype: 'hunter', genes: ['pili', 'thickWall', 't6ss'] },
  { name: 'Fuga timida', archetype: 'coward', genes: ['flagellum', 'flagellum', 'endospore', 'capsule'] },
  { name: 'Grex acidus', archetype: 'swarm', genes: ['pili', 'pili', 'poreFormer', 'transporters'] },
];
