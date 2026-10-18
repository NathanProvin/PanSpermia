export const SERVER_PORT = 2567;
export const ROOM_NAME = 'pool';
export const MAX_PLAYERS = 50;
/** Server simulation + input rate, Hz. Advertised to predicting clients in the join handshake. */
export const TICK_RATE = 20;
export const TICK_DT = 1 / TICK_RATE;

/** Pool radius, world units. */
export const WORLD_RADIUS = 6500; // 1500 → 2200 (P8a) → 3000 (P9a) → 4500 (TIER_SCALE) → 6500 (P10a, tier 4): rates below scaled with the area

// Cell body. Area ∝ mass, so radius ∝ √mass.
export const SPAWN_MASS = 10;
/** Metabolism never burns below this; a cell sitting here starves. */
export const MIN_MASS = 5;
/** Tier-1 size cap; reproduction (P4) takes over from here. */
export const MASS_CAP = 100;
export const RADIUS_PER_SQRT_MASS = 4;
/**
 * Body scale per tier (index = tier): each tier is clearly a size step up — a newborn eukaryote (radius ≈ 66)
 * is ~1.6× a grown bacterium (40), a newborn animal (≈ 305) ~1.6× a grown eukaryote (190); animals grow to ≈ 680;
 * a newborn arthropod or mollusk (≈ 870) is ~1.3× a grown animal and grows to ≈ 1120 (the pool is 13000 across).
 */
export const TIER_SCALE = [1, 1, 1.5, 2.2, 2.8] as const;
// Agar-like: bigger is slower. speed = SPEED_COEF · mass^SPEED_EXP u/s → 119 at spawn, 47 at cap.
export const SPEED_COEF = 300;
export const SPEED_EXP = -0.4;

// Swimming, as a fraction of speedOf(mass). Without motility genes a cell only creeps.
export const SWIM_CREEP = 0.35;
export const SWIM_PILI = 0.6;
export const SWIM_FLAGELLUM = 1.25;
/** Share of the current a cell drifts with; pili grip resists it. */
export const DRIFT_PILI = 0.3;
// Run-and-tumble (flagellum): runs hold their heading (slow turning only); a wider turn
// triggers a tumble, a brief stop that re-aims at the pointer with random error.
export const RUN_TURN_RATE = 0.7; // rad/s
export const TUMBLE_ANGLE = Math.PI / 4;
export const TUMBLE_TIME = 0.3; // s
export const TUMBLE_ERROR = Math.PI / 3; // ± rad
export const TUMBLE_ERROR_CHEMO = Math.PI / 12; // ± rad with a chemoreceptor
/** Server ticks without input before a silent client's cell drifts on its own. */
export const IDLE_GRACE_TICKS = 10;

// Metabolism burns (BASE + RATE·mass) mass/s: 0.04 at spawn, 0.22 at cap.
export const METABOLISM_BASE = 0.02;
export const METABOLISM_RATE = 0.002;
// Starving (at MIN_MASS) drains health; otherwise it regenerates.
export const HEALTH_MAX = 100;
export const STARVE_DPS = 2;
export const HEALTH_REGEN = 5;

// Food: dissolved-nutrient packets drift on the currents from a few seeps (plumes) plus a thin
// background; dead cells burst into richer debris. Packets dissolve after a lifetime.
export const SEEP_COUNT = 131;
export const SEEP_RATE = 1.1; // packets/s per seep
export const SEEP_SPREAD = 30; // emission jitter, world units
export const SEEP_LIFETIME: readonly [number, number] = [90, 240]; // s before a seep dries up and reappears elsewhere
export const BACKGROUND_RATE = 113; // packets/s scattered over the whole pool
export const NUTRIENT_LIFETIME = 60; // s
export const NUTRIENT_CAP = 37500; // packets alive at most
export const NUTRIENT_MASS = 1; // dissolved packet
export const DEBRIS_MASS = 2; // debris packet
export const DEBRIS_SHARE = 0.5; // share of a dead cell's mass released as debris
// Feeding genes.
export const TRANSPORTER_YIELD = 1.5; // × dissolved yield
export const SIDEROPHORE_REACH = 1.6; // × absorption radius
export const EXOENZYME_YIELD = 2; // × debris yield

// Horizontal gene transfer. A dead cell spills one DNA fragment per gene it expressed; absorbing one
// may add that gene (transformation: "eat a creature, get its part"). Plasmids drift in carrying a random gene and
// take sometimes (user: rarer than before, when every plasmid unlocked its part); a eukaryote's plasmid may unlock one
// of its own undiscovered parts.
export const TRANSFORM_CHANCE = 0.5;
export const PLASMID_UNLOCK_CHANCE = 0.3;
/**
 * Packets/s scattered over the whole pool. Plasmids are the species' main DNA (food pays none: user direction), so they
 * are 5× as common as before; every phase collects them. Provisional until the balance step measures income: a body
 * sweeps water ∝ its reach × speed, which grows with the phase about as fast as the evolve thresholds, so one flat DNA
 * value per plasmid keeps each phase near a few generations per evolution.
 */
export const PLASMID_RATE = 3.5 / 0.815; // user: 30 % fewer than the 5× step

// Bacteriophages (agar's viruses): drift passively; touching one infects (it's used up). Infection
// lyses from inside for PHAGE_LATENT s per phage; dying infected bursts out new phages (epidemics).
export const PHAGE_RATE = 9; // wild phages/s
export const PHAGE_CLEARANCE = 200; // wild phages never appear this close to a cell
export const PHAGE_LATENT = 5; // s of damage per infecting phage
export const PHAGE_DPS = 10;
export const PHAGE_BURST = 8; // phages released by a cell dying infected
export const CAPSULE_PHAGE_BLOCK = 0.6; // chance a capsule masks the receptors a phage binds to

/** Bots top a room up to this many cells (humans + bots); humans displace them as they join. */
export const BOT_FILL = 50; // kept at 50 in the 4500 pool: 80 made the sim ~3× deadlier (2026-10-16); raise if the pool feels empty
/** New cells can't be hurt or infected, and bots don't hunt them, for this long (covers the meteor intro). */
export const SPAWN_GRACE = 5; // s

// Extra flagella add thrust with diminishing returns: ×1, ×1.2, ×1.3 on SWIM_FLAGELLUM.
export const FLAGELLUM_STACK = 0.4;

// Lineage (P4). DNA buys parts and children in the editor; it comes from DNA packets and kills — never from food
// (user direction: energy and DNA are separate harvests).
export const KILL_DNA_SHARE = 0.25; // of the victim's mass, to the killer
export const PACKET_DNA = 5; // per DNA fragment (a dead bacterium's gene) absorbed
export const PLASMID_DNA = 25; // per plasmid or meteor shard absorbed
export const CHILD_PRICE = 30; // DNA per extra child (fixed)
export const STARTER_CHILDREN = 2; // reserve lives of a new species
/** Reaching the size cap starts binary fission: a shielded division cyst while the editor is open. */
export const CYST_TIME = 60; // s; when it runs out the cell hatches with its old design
export const MAX_PARTS = 24; // placements per design
export const MAX_CHILDREN = 9; // reserve cap
/** Lifetime DNA a species must earn before it can evolve to the next tier (Spore's "Grow legs?"). */
export const EVOLVE_DNA = 250;
export const EVOLVE_DNA_T2 = 2500; // lifetime DNA for a eukaryote species to become an animal
export const EVOLVE_DNA_T3 = 15000; // and for an animal species to become an arthropod or mollusk (~2–3 animal generations)

// Tier 2 — eukaryotes (P8). Mass continues from the tier-1 cap; speed and metabolism get their own
// coefficients so a eukaryote feels as nimble at its scale as a bacterium does at its own.
export const T2_SPAWN_MASS = 120; // radius ≈ 66 (TIER_SCALE 1.5)
export const T2_MIN_MASS = 60;
export const T2_MASS_CAP = 1000; // radius ≈ 190
// Bigger bodies swim faster in absolute terms (eukaryotes ×√TIER_SCALE, animals ×1.25), so a bigger tier
// doesn't feel sluggish; animals not more, or they plow through the bacteria (sim).
export const T2_SPEED_COEF = 748; // speed = coef · mass^SPEED_EXP: 110 u/s at spawn, 47 at cap
export const T2_HEALTH_MAX = 300;
export const T2_METABOLISM_BASE = 0.1; // mass/s: 0.17 at spawn, 0.7 at cap
export const T2_METABOLISM_RATE = 0.0006;
export const T2_DRIFT = 0.4; // share of the current a big cell drifts with
export const T2_SWIM_CREEP = 0.3; // no motility part
export const T2_SWIM_CILIA = 0.8; // × speedOf; precise steering
export const T2_SWIM_FLAGELLUM = 1.25; // × speedOf; fast but turns at T2_TURN_RATE
export const T2_TURN_RATE = 2.2; // rad/s with a flagellum and no cilia
// Diets. Algae are tier-2 plant food (bacteria can't take them in); a dead eukaryote falls apart
// into meat chunks; a jaw engulfs any cell at most ENGULF_RATIO of the eater's mass.
export const ALGAE_MASS = 6;
export const ALGAE_RATE = 28; // per s over the whole pool, plus SEEP_ALGAE at each seep (35.3 before cyanobacteria and hyphae)
export const SEEP_ALGAE = 0.25; // per s per seep
export const CHUNK_MASS = 10;
/**
 * More plant food (user direction): cyanobacteria filaments and fungal hyphae, eaten like algae — by plant mouths
 * (a filter mouth, filter combs, grazing mouthparts or a radula), never by bacteria. Their mass/s (36 + 21) is taken back
 * from algae (35.3 → 28/s, −44), so plant eaters get ~3 % more food than the balance had and bacteria the same.
 */
export const CYANO_MASS = 4;
export const CYANO_RATE = 9; // per s over the whole pool
export const HYPHA_MASS = 3;
export const HYPHA_RATE = 7;
/**
 * Plants for every phase's grazers (user direction: populate the pool for herbivore play), each eaten like algae — by
 * plant mouths — and only from the phase big enough to take it in: spirulina (helical blue-green filaments) from
 * eukaryotes, diatoms and dinoflagellates from plankton, macroalgae (kelp, sea lettuce, red fronds) from animals. A
 * grazer's encounter rate ∝ its reach × speed × the plant's density (rate × NUTRIENT_LIFETIME / pool area): with these
 * rates a foraging grazer finds roughly 5 (eukaryote), 13 (plankton) and 17 (animal) mass/s of its phase's plants,
 * a few times its burn — a generation's growth in a few minutes of grazing. Provisional until the balance step.
 */
export const SPIRULINA_MASS = 12;
export const SPIRULINA_RATE = 4; // per s over the whole pool
// Half as many as first tried, each worth twice as much (the same food): the plankton's view was crowded.
export const DIATOM_MASS = 80;
export const DIATOM_RATE = 2;
export const DINOFLAGELLATE_MASS = 120;
export const DINOFLAGELLATE_RATE = 1.25;
export const MACROALGA_MASS = 300;
export const MACROALGA_RATE = 0.5;
/** The phase that can first take each plant in (kind → tier); plants not listed are eaten from tier 2 (algae, filaments). */
export const PLANT_TIER: Readonly<Record<number, number>> = { 11: 2, 12: 3, 13: 3, 14: 4 };
export const ENGULF_RATIO = 0.5;
export const ENGULF_SHARE = 0.8; // of the victim's mass, to the eater

// Tier-2 weapons and abilities (P8c).
export const SPIKE_DPS = 30; // per facing spike, stacked by stack(count)
export const SPIKE_ARC = 0.6; // rad either side of a spike's direction it can stab into
export const SPIKE_REACH = 0.35; // spike length beyond the membrane, in the bearer's radii
export const ELECTRIC_DPS = 14; // to everything touching the body, stacked by copies
export const ELECTRIC_REACH = 1.3; // the field around the bearer, in its radii
export const JET_TIME = 0.8; // s of dash
export const JET_COOLDOWN = 6; // s
export const JET_BOOST = 2.6; // × swim speed while dashing
export const EYE_SIGHT = 0.18; // camera pulls back this much more per stacked eye (client)
// Meteor shards: Spore's meteor bits. Rare sparkly packets carrying a random tier-2 part; any eukaryote
// that touches one unlocks it. A dead eukaryote's chunks carry its parts too (eaten with a jaw: may unlock).
export const SHARD_RATE = 1 / 2.35; // per s over the whole pool

// Photosynthesis and endosymbiosis (P8d). Light is uniform for now: a photosynthesizer gains mass
// steadily without eating. Swallowing a bacterium may adopt it as an organelle (Margulis): one with
// transporters (a respiring cell) → mitochondrion, one with thylakoids (a cyanobacterium) → chloroplast.
export const PHOTO_RATE = 0.08; // mass/s for a bacterium, × stack(thylakoids)
export const CHLOROPLAST_RATE = 0.35; // mass/s for a eukaryote, × stack(chloroplasts)
export const MITO_METABOLISM = 0.15; // metabolism burns less by this share × stack(mitochondria)
export const MITO_SPEED = 0.08; // and swims faster by this share × stack
export const ENDOSYMBIOSIS_CHANCE = 0.25; // per qualifying bacterium swallowed

// Hazards of eukaryotes (P8f). Giant viruses (like mimivirus in amoebae) are the eukaryote's phages:
// they drift, infect on contact and burst out of the dead; bacteria are immune to them, as eukaryotes are
// to phages. Parasitic bacteria with adhesins drain the energy of any eukaryote they cling to.
export const VIRUS_RATE = 2.6; // wild giant viruses/s
export const VIRUS_LATENT = 6; // s of damage per infecting virus
export const VIRUS_DPS = 20;
export const VIRUS_BURST = 6;
export const ADHESIN_DRAIN = 2; // energy/s taken from a eukaryote host, × stack(adhesins)
export const ADHESIN_SHARE = 0.8; // of the drained energy, to the parasite
/**
 * Parasitic mouths of the bigger phases (richer catalog): a eukaryote's peduncle, a plankton's stylet, an animal's
 * proboscis drain a bigger host they touch, mass/s × stack(copies), keeping PARASITE_SHARE. Sized to rival grazing
 * (a few times the parasite's burn) without killing a host quickly.
 */
export const PEDUNCLE_DRAIN = 8;
export const STYLET_DRAIN = 30;
export const PROBOSCIS_DRAIN = 60;
export const PARASITE_SHARE = 0.8;
/** A pallium wraps prey up to this share of the eater's mass (a jaw: ENGULF_RATIO). */
export const PALLIUM_RATIO = 0.8;
/** A theca lets this share of a bite through, and slows the cell. */
export const THECA_ARMOUR = 0.7;
export const THECA_SWIM = 0.92;

// Tier 3 — small multicellular animals (P9). Mass continues from the tier-2 cap.
export const T3_SPAWN_MASS = 1200; // radius ≈ 305 (TIER_SCALE 2.2)
export const T3_MIN_MASS = 600;
export const T3_MASS_CAP = 6000; // radius ≈ 680
export const T3_SPEED_COEF = 2350; // 138 u/s at spawn, 72 at cap
export const T3_HEALTH_MAX = 1200;
export const T3_METABOLISM_BASE = 0.5; // energy/s: ~1 at spawn, ~2.9 at cap
export const T3_METABOLISM_RATE = 0.0004;
export const T3_DRIFT = 0.15; // big animals barely drift
export const T3_SWIM_CREEP = 0.3;
export const T3_SWIM_PADDLE = 0.85; // × speedOf; precise steering
export const T3_SWIM_TAIL = 1.3; // × speedOf; fast, turns at T3_TURN_RATE
export const T3_TURN_RATE = 1.6; // rad/s with a tail and no paddles
// Richer catalog, plankton (provisional until the balance step).
export const MASTAX_YIELD = 1.5; // × the big plants (spirulina, diatoms, dinoflagellates, macroalgae) a mastax grinds
export const T3_SWIM_OARS = 1.25; // × speedOf at the top of a stroke; jump-and-glide averages ~1
export const OAR_STROKES = 1.3; // strokes per second
export const MUSCLE_SWIM = 0.25; // × swim per stack(muscles): the undulating body
export const T3_SWIM_LOBOPOD = 0.7; // a steady crawl, precise steering
export const LOBOPOD_DRIFT = 0.3; // × drift: the claws grip
export const LOBOPOD_GRIP = 0.4; // × a bite's knock-back
export const SPINE_GAPE = 6; // a spined animal can only be swallowed by an eater this many times its mass
export const TUN_TIME = 4; // s dormant: invulnerable, still, no metabolism
export const TUN_COOLDOWN = 20;
export const OIL_METABOLISM = 0.15; // burn × (1 − this × stack(oil))
// Richer catalog, animals.
export const CERATA_REFLECT = 0.35; // share of a bite's damage stung back into the biter, × stack(cerata)
export const ANTENNA_SIGHT = 0.15; // the view widens this much more per stacked antenna pair (client)
export const T4_SWIM_FINS = 1.15; // fins: fast and agile
export const FIN_TURN = 2.0;
export const GILL_METABOLISM = 0.12; // burn × (1 − this × stack(gills))
export const GILL_SPEED = 0.08; // swim × (1 + this × stack(gills))
export const MANDIBLE_ARC = 0.7; // ± rad in front where jaws and mandibles bite (see BITE_*)
/**
 * Swallowing reach. A eukaryote engulfs with its body (EUK_MOUTH radii around its centre); an animal with its
 * mouth, a disc of ANIMAL_MOUTH radii ANIMAL_MOUTH_AHEAD radii ahead of its centre. Kept near their absolute
 * sizes from before TIER_SCALE: bigger bodies mustn't vacuum up the pool (sim: deaths/min ×4 otherwise).
 */
export const EUK_MOUTH = 0.6;
/**
 * An animal eats only what touches its mouthparts (user direction): each placed mouthpart is a mouth on the body's
 * outline, MOUTH_OUT cell radii beyond it, taking what comes within MOUTH_REACH cell radii (× the part's scale).
 */
export const MOUTH_OUT = 0.15;
export const MOUTH_REACH = 0.3;
export const ANIMAL_MOUTH = 0.3;
export const ANIMAL_MOUTH_AHEAD = 0.75;
export const CARAPACE_ARMOUR = 0.6; // share of bite damage that gets through a carapace
/** A dead animal can't spill thousands of chunks: at most this many (the rest is lost). */
export const SPILL_MAX = 40;

// Tier 3 reproduction (P9c): mate call, mating, an egg clutch.
export const MATE_DISTANCE = 700; // a mate answers the call from this far beyond touching distance (~3 s away)
export const MATE_SPEED = 260; // u/s, faster than any animal: it always arrives
export const MATE_TIMEOUT = 15; // s of calling after which mating happens anyway
/** s: a plankton individual begins as an egg clutch, shielded and still like a cocoon (user: wait, don't play the parent). */
export const EGG_TIME = 5;

// Tier 4 — arthropods and mollusks (P10). Mass continues from the tier-3 cap.
export const T4_SPAWN_MASS = 6000; // radius ≈ 870 (TIER_SCALE 2.8)
export const T4_MIN_MASS = 3000;
export const T4_MASS_CAP = 10000; // radius ≈ 1120
export const T4_SPEED_COEF = 4860; // 150 u/s at spawn, 122 at cap
export const T4_HEALTH_MAX = 5000; // 3000 → 5000 (polish S0): tier-3 jaws mustn't kill an unarmed snail in a minute
export const T4_METABOLISM_BASE = 1.5; // energy/s: ~3.3 at spawn, ~4.5 at cap
export const T4_METABOLISM_RATE = 0.0003;
export const T4_DRIFT = 0.08;
export const T4_SWIM_CREEP = 0.3;
export const T4_SWIM_LEGS = 0.85; // walking legs: precise, like paddles
export const T4_SWIM_TAILFAN = 1.3; // a tail fan: fast, turns at T4_TURN_RATE
export const T4_SWIM_FOOT = 0.55; // a mollusk's muscular foot: slow and sure (it barely drifts)
export const T4_SWIM_SIPHON = 1.35; // jet propulsion through a siphon: fast, turns at T4_TURN_RATE
export const T4_TURN_RATE = 1.4; // rad/s with a tail fan or a siphon and nothing to steer with
export const LEG_TURN = 2.2;
export const FOOT_DRIFT = 0.3; // × T4_DRIFT: a foot holds on
/** Share of bite damage that gets through a hard exoskeleton, or a mollusk's shell (heavier: it slows the body). */
export const EXOSKELETON_ARMOUR = 0.55;
export const SHELL_ARMOUR = 0.35;
export const EXOSKELETON_SWIM = 0.92;
export const SHELL_SWIM = 0.8;
/** Tier-4 reproduction (P10c): after mating and the editor, the body spins a cocoon and the new design emerges from it. Every new animal begins in one. */
export const COCOON_TIME = 12; // s, shielded and still
/** Ink (P10d): the squirt that releases an ink cloud is a predicted dash, like the eukaryote's jet. */
export const INK_TIME = 0.9; // s of dash
export const INK_COOLDOWN = 10; // s
export const INK_BOOST = 2.2; // × swim speed while dashing

// Feel (movement polish): inertia and progressive turns. Gameplay over low-Reynolds realism: a cell's
// velocity eases toward its propulsion with this time constant (s), per tier — bigger bodies feel heavier.
export const INERTIA = [0, 0.3, 0.5, 0.8, 1];
/** Turn rates (rad/s) of the steering motility types that used to turn instantly. */
export const PILI_TURN = 4;
export const CREEP_TURN = 2.5;
export const CILIA_TURN = 3.5;
export const PADDLE_TURN = 2.5;
/** A tumble spins the cell round to its new random heading instead of jumping there (rad/s). */
export const TUMBLE_SPIN = 14;
// Collisions: overlapping cells push apart (by mass) and bounce.
export const BOUNCE = 0.6; // restitution of the normal velocity
export const PUSH = 0.8; // share of the overlap resolved per tick
export const BUMP_SPEED = 60; // u/s of extra separation kick at full overlap, for a felt bounce
// Bites: jaws (tier 2), mandibles (tier 3), claws and beaks (tier 4) bite what's in front and too big to swallow.
export const BITE_INTERVAL = 0.8; // s between bites
export const BITE_DAMAGE = [0, 0, 28, 45, 110]; // per bite, per tier
export const BITE_REACH = 0.25; // × the biter's radius beyond touching
/** Small jaws on a big body: bites on a bigger tier do this share of their damage. */
export const SMALLER_BITE = 0.5;
export const BITE_KNOCK = 140; // u/s pushed into the victim, away from the biter
export const BITE_RECOIL = 80; // u/s the biter bounces back
