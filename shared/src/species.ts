// Hand-made tier-1 bot species: a genome plus a behaviour archetype. Shared so clients can name them
// (death screen, P4) and the headless balancing sim reads the same catalog as the server.

/**
 * grazer: feeds, dodges armed cells. hunter: chases smaller cells, attacks in range.
 * coward: feeds, flees anything foreign, sporulates when hurt. swarm: feeds in a pack, attacks intruders.
 */
/** parasite: seeks a eukaryote and clings to it (adhesins drain the host's energy). */
export type Archetype = 'grazer' | 'hunter' | 'coward' | 'swarm' | 'parasite';

/**
 * tier: 1 bacterium, 2 eukaryote. genes: the design, names in that tier's catalog; a gene listed twice is two
 * copies (stacking, like a player's editor design). shape: SHAPES index.
 */
export interface Species { name: string; tier: number; archetype: Archetype; genes: readonly string[]; shape: number }

export const BOT_SPECIES: readonly Species[] = [
  { name: 'Nudus errans', tier: 1, archetype: 'grazer', genes: [], shape: 0 }, // geneless drifter: everyone's first meal
  { name: 'Pilus repens', tier: 1, archetype: 'grazer', genes: ['pili', 'pili', 'pili', 'siderophores'], shape: 0 }, // anchored filter
  { name: 'Vibrio celer', tier: 1, archetype: 'grazer', genes: ['flagellum', 'flagellum', 'chemoreceptor', 'transporters'], shape: 2 },
  { name: 'Mucus tardus', tier: 1, archetype: 'grazer', genes: ['pili', 'capsule', 'transporters', 'transporters'], shape: 0 },
  { name: 'Necrophagus', tier: 1, archetype: 'grazer', genes: ['flagellum', 'chemoreceptor', 'exoenzymes', 'transporters'], shape: 1 }, // scavenger that can also graze
  { name: 'Spina venator', tier: 1, archetype: 'hunter', genes: ['flagellum', 't6ss', 't6ss', 'exoenzymes'], shape: 1 },
  { name: 'Toxicus lentus', tier: 1, archetype: 'hunter', genes: ['pili', 'bacteriocin', 'bacteriocin', 'endospore'], shape: 0 }, // sporulates out of jaws
  { name: 'Murus armatus', tier: 1, archetype: 'hunter', genes: ['pili', 'thickWall', 't6ss'], shape: 0 },
  { name: 'Fuga timida', tier: 1, archetype: 'coward', genes: ['flagellum', 'flagellum', 'endospore', 'capsule'], shape: 1 },
  { name: 'Grex acidus', tier: 1, archetype: 'swarm', genes: ['pili', 'pili', 'poreFormer', 'transporters'], shape: 2 },
  // P8d — photosynthesizers (cyanobacteria): they live on light, and they are where chloroplasts come from.
  { name: 'Cyanella viridis', tier: 1, archetype: 'grazer', genes: ['pili', 'thylakoid', 'thylakoid'], shape: 0 },
  { name: 'Lumibacter virens', tier: 1, archetype: 'grazer', genes: ['flagellum', 'thylakoid', 'thylakoid', 'capsule'], shape: 1 },
  { name: 'Chlorovibrio lentus', tier: 1, archetype: 'coward', genes: ['flagellum', 'thylakoid', 'thylakoid', 'thylakoid'], shape: 2 },
  // P8f — a parasite: a fast, hooked bacterium that rides eukaryotes and drains them.
  { name: 'Chytridium parasita', tier: 1, archetype: 'parasite', genes: ['flagellum', 'flagellum', 'chemoreceptor', 'adhesin', 'adhesin'], shape: 2 },
  // P8e — eukaryotes, Spore's cell-stage neighbours: grazing ciliates and euglenas, amoeboid and spiked
  // hunters that swallow bacteria and small cells, and a jumpy electric coward.
  { name: 'Ciliata lenta', tier: 2, archetype: 'grazer', genes: ['filter', 'cilia', 'cilia', 'cilia', 'eye'], shape: 1 },
  { name: 'Euglenoides lucens', tier: 2, archetype: 'grazer', genes: ['filter', 'flagellum', 'chloroplast', 'chloroplast', 'eye'], shape: 2 },
  { name: 'Amoebina vorax', tier: 2, archetype: 'hunter', genes: ['jaw', 'filter', 'cilia', 'cilia', 'mitochondrion'], shape: 0 }, // eats anything
  { name: 'Didinia ferox', tier: 2, archetype: 'hunter', genes: ['jaw', 'spike', 'spike', 'flagellum', 'cilia', 'mitochondrion'], shape: 0 },
  { name: 'Fulgur timidus', tier: 2, archetype: 'coward', genes: ['filter', 'cilia', 'cilia', 'jet', 'electric', 'eye'], shape: 1 },
];
