# Roadmap — Panspermia.io (Spore cell phase x Agar.io)
Never use "Spore" (EA trademark) in name, logo, or assets. Nostalgia via moments: meteor intro, editor feel, zoom-out stage-ups, generative ambient music, other players' species in your world.

## Vision
Browser multiplayer drop-in arena (agar.io) where you evolve a custom species through 5 evolutionary tiers
(Spore cell phase, extended), from bacteria to chordate, then Ascend. Beautiful: shaders, depth-of-field, parallax.

## Core loop
1. Spawn as one individual of your species (no signup, playing in <5s).
2. Eat (diet set by mouth part) -> grow mass + fill DNA meter. Avoid/fight others and bots.
3. Hit the tier size cap -> mate call -> editor (Spore-style freeform). Spend DNA: more children (lives) vs better parts.
4. Children are born as the NEXT tier. You control one; the rest are a hidden reserve of lives.
5. Die -> take over next child. All children dead -> game over (death screen names the killer species).
6. Complete tier 5 -> Ascension: species card + Hall of Fame entry, start a new species.

## Tiers (one multi-scale room; tier sets camera zoom + depth layer)
| # | Life form | Reproduction protection | Hazards (scale per tier) |
|---|-----------|------------------------|--------------------------|
| 1 | Bacteria | Vulnerable | Bacteriophages (agar "viruses") |
| 2 | Eukaryote | Vulnerable | TBD (parasites, ...) |
| 3 | Small multicellular (nematode, daphnia, plankton) | Egg | TBD |
| 4 | Small arthropod / insect / mollusk | Cocoon | TBD (predatory plants, ...) |
| 5 | Chordate | Womb | TBD |

Interactions: fight your tier ±1; bigger tiers filter-feed on tiny ones; giants drift by blurred in parallax.

## Tier 1 — Bacteria (vertical slice design)
- Movement: run-and-tumble. No motility genes = drift with currents; type IV pili = slow precise crawl; flagellum = fast straight runs, turning costs a semi-random tumble; chemoreceptor gene biases tumbles toward food. (Cilia are eukaryotic -> tier 2.)
- Food: dissolved nutrient plumes carried by currents (passive absorption, follow gradients) + debris clouds of lysed cells (richest, predator route).
- Combat = lysis, no engulf: secreted toxins/bacteriocins + pore-forming proteins (clouds drifting with currents, area denial), type VI secretion system (contact spike). Defenses: capsule, thick wall, efflux pumps (toxin resistance), endospore (panic: dormant + invulnerable, frozen). Killed cell bursts into nutrients + DNA fragments.
- Part unlocks (horizontal gene transfer): transformation = absorb victim's DNA fragments -> chance to gain its genes (Spore "eat a creature, get its part"); rare free-floating plasmids (Spore meteor equivalent).
- Hazard: bacteriophages (agar viruses). Reproduction: binary fission, vulnerable.

## Rules
- Engulf starts at tier 2 (eukaryote phagocytosis): target mass <= 1/2 of yours AND a carnivore/omnivore mouth part. Otherwise: part combat (health, bites, spikes, poison, electric). Tier-2 engulf of a bacterium can grant an organelle (endosymbiosis: chloroplast, mitochondrion).
- Diets: herbivore, carnivore, omnivore, filter-feeder (slow constant intake of plankton; seek dense areas / currents).
- Agar mechanics mapped to biology: fission = split (tier 1), phages = viruses, ink/spore eject (mollusk branch), metabolism = mass decay.
- Body plan + part catalog change per tier (membrane -> colony -> segmented -> exoskeleton/shell + limbs -> spine/fins); some parts carry over as traits.
- Win: Ascension. Live mass leaderboard in-room. Global Hall of Fame ranks ascended species by fewest generations used. Shareable species card.
- Bots: NPC prey/predators per tier, keep 50-player rooms full and new players fed.
- Target run to ascend: 15-30 min.
- Monetization: cosmetics only, never pay-to-win.

## Stack
TypeScript monorepo (client / server / shared). Client: Three.js (2D gameplay plane, real z-layers for parallax, DOF, bloom, custom GLSL). Server: Colyseus (rooms, state sync), authoritative sim. SQLite for Hall of Fame. Host: single VPS.
Art: procedural GLSL bodies + sculpted modular part meshes (from tier 2+).

## Content pipeline
- Content = data: one part/hazard/bot catalog in shared/, read by server (stats) and client (visuals).
- Visuals procedural from part parameters (flagellum = animated helix tube, capsule = halo shader, phage = icosahedral head + tail fibers).
- Map: curl-noise currents, advected nutrient-plume density field, noise depth layers.
- Bots = genome (same parts as players) + behavior archetype (grazer, hunter, coward, swarm). ~10 hand-made tier-1 species, then random genomes within DNA budget. Extinct/ascended player species return as bots in other rooms (Sporepedia effect).

## Numbers
Back-of-envelope from targets (~4 min/tier; tier 1 mass 10 -> 100 => ~0.4 mass/s net intake; plumes ~0.3/s; kill debris ~50% victim mass; metabolism ~0.1%/s; ~1 DNA per mass; child ~25% of DNA budget => ~3 lives avg; engulf 2x; speed ~ mass^-0.4).
Then tune with a headless bot sim at 100x (time-to-cap, kills/min, children used, part win rates), then playtests.

## Phases
### Milestone A — Tier 1 vertical slice (full quality)
- [x] P0 Foundations: git init, monorepo (Vite client, Colyseus server, shared constants), dev scripts, first /graphify run. (2026-10-14)
- [x] P1 Core sim (2026-10-14): 20 Hz fixed-timestep authoritative sim, shared deterministic `move`/`clampSteer`, client prediction (`Reconciler`) + lerp for remotes, nutrients placeholder, mass->radius/speed, metabolism, starvation death -> respawn, 50-player rooms. Lag compensation (`Rewind`) deferred to P3 combat.
- [ ] P2 Render bar: depth layers + parallax, DOF blur, bloom, membrane shader (wobble/translucency), caustics, plankton particles, current flow field.
- [ ] P3 Tier-1 gameplay: run-and-tumble movement, nutrient plumes + debris feeding, lysis combat (toxin clouds, T6SS, defenses, endospore), transformation + plasmid unlocks, fission, phages, bot ecology (tier-1 part + bot catalog), headless sim tool for tuning, meteor intro.
- [ ] P4 Lineage loop: DNA meter, mate call (vulnerable), freeform editor, children-vs-parts trade-off, lives reserve, game over + killer screen.
- [ ] P5 Virality: species name on cell, live leaderboard, shareable species card (render + link), slice ends at "evolved to eukaryote" moment.
- [ ] P6 Ship: VPS deploy, bot-driven 50-player load test, basic analytics (session length, restarts, shares), first public playtest.

### Milestone B — Full evolution
- [ ] P7 Multi-scale room: cross-tier zoom/layers, ±1 tier interaction, filter-feeding giants.
- [ ] P8 Tier 2 Eukaryote (body plan, parts, engulf + endosymbiosis, hazards).
- [ ] P9 Tier 3 Multicellular + egg protection.
- [ ] P10 Tier 4 Arthropod/insect/mollusk + cocoon, ink eject.
- [ ] P11 Tier 5 Chordate + womb.
- [ ] P12 Ascension + global Hall of Fame (SQLite).

### Milestone C — Live game
- [ ] P13 Accounts (optional) + cosmetics shop.
- [ ] P14 Moderation: species-name filter, report creature (Spore's Sporepedia lesson).
- [ ] P15 Mobile controls + perf tier; scale out beyond one VPS.

## Open questions
- Domain availability for panspermia.io. IP lawyer check before monetizing. Diet mapping per tier (filter-feeder fits tier 3 daphnia/plankton; tier 1 = osmotroph vs predator).
- v2 tier-1 ideas: transduction from phages, CRISPR immunity part, conjugation with own species, photosynthesis, vents, quorum sensing.
- Tier 2-5 hazards and part catalogs. Number tuning (DNA thresholds, size caps, children cost).
- Species teams / friends joining same species (v2 idea).
