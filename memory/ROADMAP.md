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
- [x] P2 Render bar (2026-10-14): depth layers + parallax (perspective camera, floor at z -1400, plankton -1100..-60 and foreground 40..160), per-layer baked DOF, HDR bloom + ACES, membrane shader (wobble, translucent cytoplasm, nucleoid, glint), warped-Worley caustics, rocky pool rim, plankton drifting on the shared current field. Open: art polish (eat/death FX, parts visuals come with P3), FPS: 45 on dev machine (user report), below 60 target — profile before P6 (suspects: full-res floor shader, bloom, sprite overdraw).
- [x] P3 Tier-1 gameplay, sliced (2026-10-14 → 2026-10-15):
  - [x] P3a Gene catalog (`shared/src/genes.ts`, bitmask genome, upkeep) + currents move cells + run-and-tumble (flagellum/pili/chemoreceptor), gene visuals, dev gene cheats (`--dev` only)
  - [x] P3b Feeding: 7 wandering seeps emit plumes of food packets drifting on the currents (+ thin background, 60 s lifetime); debris (red) from dead cells (50% of mass); transporters ×1.5 dissolved, siderophores ×1.6 reach, exoenzymes ×2 debris; 80-unit spatial grid; packet paths rebuilt client-side (spawn-only sync); integer tick clock
  - [x] P3c Combat: drifting toxin clouds (bacteriocin wide/slow, pore-former burst; producer immune; mass cost + cooldown), T6SS contact stab, capsule/thick wall/efflux resistances, endospore (predicted, 5 s dormant, 45 s cooldown), regen only 3 s after last hit, kill attribution (died: lysed by), kills burst into debris. DNA fragments moved to P3d. Controls: hold/tap left click toxin, right click or Shift endospore (presses latch until next send)
  - [x] P3d Unlocks (2026-10-15): dead cells spill one DNA fragment per gene (50% transformation on absorb), rare plasmids (1/15 s, random gene, always take); DNA isn't food; auto-express + HUD "New gene" notice; dev keys P/V drop plasmid/phage on your cell
  - [x] P3e Phages (2026-10-15): wild phages drift passively (0.5/s, never spawn within 200 of a cell); contact = infection (5 s × 10 dps each, stacks); dying infected bursts 8 phages (epidemics); capsule blocks 60%, endospore immune/frozen; "Phages burst you open" death; virions drawn inside infected cells
  - [x] P3f (2026-10-15): 10 bot species (`shared/src/species.ts`: genome + grazer/hunter/coward/swarm) fill rooms to BOT_FILL 30 cells (humans displace them), same world rules as players; headless sim `npm run balance -w server -- [min] [bots]` (~180× real time) reports per-species lives, kills, deaths by cause, time to cap, lifetime, genes gained, top killer. First tuning pass: T6SS 20→12 dps, seeps 1.5→0.8/s, hunters chase only smaller cells. Open: lethality ~15 deaths/min per 30 bots (life ~2 min, mostly hunter-vs-hunter); phages barely touch bots (they dodge perfectly).
  - [x] P3g Meteor intro (2026-10-15): on first join the camera starts at 1800 and glides down while a molten meteor plunges from below it trailing steam, flashes, sends a shockwave and hatches your cell (overshoot pop, camera shake); input muted ~2.8 s; client-only (`client/src/scene/meteor.ts`). Spawn grace 5 s (no lysis/infection, hunters ignore) covers it and fixes newcomers being hunted at mass 10 — bot deaths 15 → 12/min.
  - Original scope: run-and-tumble movement, nutrient plumes + debris feeding, lysis combat (toxin clouds, T6SS, defenses, endospore), transformation + plasmid unlocks, fission, phages, bot ecology (tier-1 part + bot catalog), headless sim tool for tuning, meteor intro.
- [x] P4 Lineage loop (design: DECISIONS 2026-10-15 "P4 design forks" + "P4 loop shape"), sliced:
  - [x] P4a (2026-10-15) Lineage core: genome = per-gene copy counts (stacking, diminishing returns, per-copy upkeep), species library (gene transfer unlocks instead of auto-expressing), DNA meter (mass eaten, kills, fragments), children reserve, death → next child or game over (killer species), fission at cap → shielded division cyst awaiting a design (60 s), server-validated design submission; minimal HUD. Done: `Lineage` per session (genome, parts, hue, library, DNA, lifetime DNA, children, generation, extinct); copies packed 2 bits/gene (max 1-3 per part); DNA 1/mass eaten, 25% of victim mass per kill, 3 per DNA packet; child 30 DNA, 2 starter children, cap 9; extinction screen + "Found a new species"; stub client auto-submits the unchanged design and buys children with spare DNA until P4b; dev keys G (cap) / K (die)
  - [x] P4b (2026-10-15) Spore-like editor UI: big cell view, palette of unlocked parts with DNA prices, drag-place on the membrane/inside, bilateral symmetry, copies, paint (species hue), children ± at a fixed price, 60 s timer. Done (`client/src/editor.ts`): palette (locked parts shown as ???), membrane parts snap to the rim, internal ones float inside, coats toggle; axial and radial symmetry (radial repeats ×2–3 by copies left); drag to move, drag off / right-click to remove (refund), wheel to resize; hue slider; children ±; live DNA/parts/upkeep; designs regroup from `Part.group`; drafts sync to the server so a timed-out cyst hatches the latest edits. Evolve progress moved to P5. Dev key N = +100 DNA
  - [x] P4c (2026-10-15) Placed parts rendered in the pool (multiple flagella, parts where placed), species colour. Done: one quad per placed part in a body frame that turns with the heading (`createCellView`), shared by the pool and the editor; bots/dev-toggled cells use `defaultParts`; division cyst drawn as a pinching furrow with two nucleoids
  - [x] P4d (2026-10-15) Bots get copy-count designs; balancing pass with the sim (time per generation, lives used). Done: stacked bot designs; bots divide at the cap (instant, no editor); sim reports gens, genMin, livesPerGen; hunters only chase cells < 0.7× their mass and only while < 70 mass, fire only at prey or in self-defence; grazers flee armed cells ≥ 0.5× their mass within 200; spawn weights grazer 3 / coward 2 / swarm 2 / hunter 1; SEEP_RATE 0.8 → 1.1. Result (20 min, 30 bots): ~3 deaths/min (was 16), generations ~1.2–5 min, < 1 life per generation for most species
- [x] P5 Virality (2026-10-15): species name on cell, live leaderboard, shareable species card (render + link), slice ends at "evolved to eukaryote" moment. Done: generated Latin binomial names (rename in the editor, `cleanName` gate), DOM labels over cells, top-8 mass leaderboard, Evolve button at EVOLVE_DNA 250 lifetime DNA (two-click confirm) → zoom-out stage-up → card; species card 1200×630 PNG rendered with the game shaders + link carrying the design in the URL fragment (no server storage, validated on decode), viewer mode with Play; extinction screen also offers the card; death screen names human killer species. Dev key N now also counts as lifetime DNA.
- [ ] P6 Ship — b/c/d deferred (2026-10-15, user): gameplay development first (deploy plan: DECISIONS 2026-10-15 "Deployment path"), sliced:
  - [x] P6a (2026-10-15) Stage 1 playtests from the dev PC: production server serves the built client (one origin) + `/health`; production client connects to its own origin; `npm run play`, `npm run tunnel` (Cloudflare quick tunnel); README playtest steps
  - [ ] P6b Stage 2 public alpha: VPS (Oracle Always Free on pay-as-you-go, or Hetzner ~€4/mo), Caddy TLS, systemd, Cloudflare DNS/proxy, firewall, deploy script; stale-client version check
  - [ ] P6c Bot-driven 50-player load test (measure bandwidth per client), basic analytics (Cloudflare Web Analytics + own events in SQLite: session length, restarts, card shares)
  - [ ] P6d First public playtest

### Milestone B — Full evolution
- [ ] P7+P8 Tier 2 Eukaryote in the same pool (design: DECISIONS 2026-10-15 "Tier 2 forks"), sliced:
  - [x] P8a (2026-10-15) Eukaryotes exist: Player.tier + genome2 (tier-2 catalog, tier-1 rules untouched), tier-2 scale (spawn 120 → cap 1000 mass, own speed/metabolism/health), steering movement (cilia, flagellum), mouths set diet (filter: algae + dissolved; jaw: debris, chunks, engulf cells ≤ ½ mass incl. bacteria; both = omnivore), algae + meat chunks, Evolve → next generation hatches as tier 2 (stage-up zoom), bigger pool, bacteria flee jaws, phages ignore eukaryotes. Done; tier-2 cells are plain bodies and divide with an unchanged design until P8b; pool 1500 → 2200 (rates ×2.15, 40 bots); bot sim: generations 1.4–5.4 min, ≤ 1.4 lives/gen
  - [x] P8b (2026-10-15) Universal editor + Spore-cell visuals: one editor/renderer/validator for every tier via `catalogFor(tier)` (palette, prices, copies, slots, symmetry, drafts, Evolve hidden at MAX_TIER); eukaryote body with nucleus, nucleolus and vacuoles; cilia comb, filter funnel mouth, jaw mandibles, shorter eukaryote flagellum; cards and dev gene keys tier-aware (eyes moved to P8c)
  - [x] P8c (2026-10-15) Weapons (spike, poison, electric), jet dash, eyes. Done: directional spikes (stab only where they point), electric field (all around, bacteria included), poison cloud left behind (left click), jet dash (right click/Shift, predicted), eyes widen the view; meteor shards (rare, unlock a random tier-2 part on touch) and gene-carrying chunks from dead eukaryotes (jaw, 50%); starter tier-2 library adds eyes
  - [x] P8d (2026-10-15) Endosymbiosis + photosynthesis + body shapes (coccus/rod/vibrio, editor picker, shared deform): engulfing specific bacteria unlocks organelles (mitochondrion, chloroplast) + 3 photosynthetic tier-1 bot species. Browser-checked: shapes in pool and editor, mitochondrion and chloroplast visuals. Note: balance sim 190× → 48× real time since the bigger pool (bot perception scans all nutrients)
  - [x] P8e (2026-10-15) Tier-2 bots + balance pass + perf: 5 eukaryote species (Ciliata lenta, Euglenoides lucens, Amoebina vorax, Didinia ferox, Fulgur timidus; spawn weight 1 each ≈ 6 of 40 bots); bot perception grid + drift every 2 ticks (sim 49.8× → 70–87× real time); fixed a NaN-steering bug that let a NaN eukaryote swallow the whole pool; bots sporulate out of jaws; pure-carnivore bots digest 6 s per swallow; "mass" is Energy in the UI. Result (20 min, 40 bots): 6–7 deaths/min, eukaryote generations 2.7–4.1 min (Didinia ~11.5, apex), most bacteria ≤ 1 life/gen
  - [x] P8f (2026-10-15) Hazards of eukaryotes: giant viruses (eukaryote-only, drift, infect on contact 6 s × 20 dps, burst 6 from the dead; bots dodge them) and parasitic bacteria (new tier-1 gene Adhesins: drain 2 energy/s × stack from a touched eukaryote, 80 % to the parasite; bot species Chytridium parasita holds station on a host rim; eukaryote bots jet to shake parasites off; electric/spikes kill them). Sim: parasites thrive (1.8 min generations) and slow eukaryote grazers by ~1 min/gen; 7.5 deaths/min across 40 bots
  - [ ] Next: balance pass with humans in playtests (P6c/d), tier 3
  - [x] P7 rest (2026-10-15): "thriving pond" background — pond bottom with regional sand/silt/moss/weeds under blue/teal/green water, heavily blurred sun patches, a water-column haze layer with soft light shafts (depth parallax), an earthy mossy bank, a mixed plankton palette, and distant giant silhouettes (water fleas, rotifers, nematodes, copepods, a tadpole) swimming far below, recycled around the camera for regular sightings. Generic ±1-tier interaction rules remain for tier 3
- [ ] P9 Tier 3 small multicellular animals (design: DECISIONS 2026-10-15 "Tier 3 forks"), sliced:
  - [x] P9a (2026-10-15) Animals exist: Player.genome3 + TIER3 catalog, tier-3 scale, segmented body rendering (default spine), diets (filter combs sweep up specks: bacteria, algae; mandibles bite eukaryotes and rivals), Evolve tier 2 → 3, bigger pool. Done: genome3 + TIER3 (paddle legs, tail, filter combs, mandibles, eye, carapace), mass 1200→6000, evolving a eukaryote species needs 2500 lifetime DNA, combs swallow bacteria, mandibles swallow eukaryotes and bite rival animals in front (carapace ×0.6), pond radius 3000 with rates scaled, 50 bots, three-segment body (tissue, grooves, gut), parts snap to the outline, paired side parts mirror
  - [ ] P9b Body editor: segmented spine or radial body plan (add/remove/resize segments), parts snap to the body outline
  - [ ] P9c Mate call, mating, egg clutch (vulnerable until it hatches; children = extra eggs)
  - [ ] P9d Tier-3 bots + hazards + balance
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
