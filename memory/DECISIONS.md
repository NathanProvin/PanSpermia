# Decisions Log
Append-only. Format: `## YYYY-MM-DD — Title` / Decision / Why / Rejected

## 2026-10-14 — Session model
Decision: drop-in persistent arena (agar.io). Why: zero friction, instant restart. Rejected: timed rounds, persistent MMO world.

## 2026-10-14 — Death = lineage lives
Decision: you play one individual; reproduction yields children kept as a hidden reserve of lives; all dead = game over.
Why: IKEA effect on custom species + loss aversion. Rejected: AI-controlled children (server cost), swarm.

## 2026-10-14 — Reproduction = Spore mate call
Decision: fill DNA meter, mate call opens editor. Protection scales per tier: vulnerable (T1-2), egg (T3), cocoon (T4), womb (T5).
Children count is a DNA trade-off vs parts.

## 2026-10-14 — Stage-up only via reproduction
Decision: evolution happens between generations; children are born as next tier.

## 2026-10-14 — Win condition = Ascension
Decision: complete tier 5 to Ascend; live mass leaderboard; global Hall of Fame ranked by fewest generations; shareable species card.
Why: (engagement review) gives each run a climax, produces a shareable artifact (Sporepedia effect), and top players leaving the room caps agar's snowball problem. Rejected as sole condition: mass leaderboard (snowball), longevity (rewards hiding), species teams (v2).

## 2026-10-14 — Combat = hybrid
Decision: instant engulf needs >= 2x mass AND a carnivore/omnivore mouth part; otherwise Spore part combat with health.

## 2026-10-14 — Tier 1 = realistic bacteria (amends Combat)
Decision: no engulf at tier 1; kill by lysis (toxins, pore-formers, T6SS), feed on debris + dissolved nutrient plumes. Movement run-and-tumble (drift / pili / flagellum / chemoreceptor). Parts unlock via transformation (victim DNA) + free plasmids. Engulf begins tier 2 with endosymbiosis bonus.
Why: biology-grounded uniqueness; run-and-tumble is a skill mechanic. Deferred: transduction, conjugation, photosynthesis, vents.

## 2026-10-14 — Diets
Decision: Spore herbivore/carnivore/omnivore + filter-feeder (slow constant plankton intake, seek dense areas/currents).

## 2026-10-14 — 5 evolutionary tiers, per-tier body plans
Decision: bacteria -> eukaryote -> small multicellular -> arthropod/insect/mollusk -> chordate -> Ascension. Each tier has its own body plan + part catalog. Target 15-30 min to ascend.

## 2026-10-14 — Agar mechanics mapped to biology
Decision: fission = split, phages = viruses, ink/spore eject, metabolism = decay. Hazards scale per tier.

## 2026-10-14 — World = one multi-scale room
Decision: 50-player rooms with bots (prey/predators). Tier sets zoom/depth layer; interact with tier ±1. Rejected: room per tier, zones.

## 2026-10-14 — Stack
Decision: TypeScript, Three.js client, Colyseus authoritative server, SQLite, single VPS.
Why: user requires shader-heavy visuals (DOF, blur, parallax) -> real 3D renderer; Colyseus gives rooms/sync out of the box. Rejected: PixiJS (faked depth), Babylon (heavier), custom netcode.

## 2026-10-14 — Art = procedural shaders + sculpted part meshes
Decision: GLSL procedural bodies (membrane, translucency, refraction); sculpted modular part meshes from tier 2+. Why: best render quality for the microscopy look while keeping editor parts modular.

## 2026-10-14 — Monetization = cosmetics only
Decision: no pay-to-win, no rewarded-ad lives.

## 2026-10-14 — First milestone = Tier 1 vertical slice at full quality
Why: prove fun + visual bar before scaling content.

## 2026-10-14 — Title = Panspermia.io
Decision: working title Panspermia.io; never use "Spore"/"Sp0re" in name, logo, assets. Marketing may say "spiritual successor to Spore's cell stage" (no implied EA endorsement).
Why: "Spore" is an EA trademark; confusable variants invite C&D/takedowns, worse with cosmetics monetization. Panspermia winks at Spore's meteor intro. Rejected: Spore Browser, Sp0re, Primordia, Lineage.

## 2026-10-14 — Nostalgia via moments, not IP
Decision: recreate meteor intro (own version), editor feel (snap, dance, test drive), zoom-out stage-ups, generative ambient music, other players' species in your world. No EA art/music/sounds/UI.

## 2026-10-14 — Content pipeline = data catalogs + procedural visuals
Decision: shared catalog for parts/hazards/bots; procedural visuals from parameters; procedural map (curl-noise currents, nutrient plumes). Bots = genome from player part catalog + behavior archetype; extinct/ascended player species return as bots (Sporepedia effect).

## 2026-10-14 — Numbers = targets -> headless sim -> playtests
Decision: back-of-envelope constants from run-length targets, tuned by a headless bot sim at 100x (added to P3), then playtests.

## 2026-10-14 — P0 toolchain
Decision: npm workspaces (`shared`, `server`, `client`); TypeScript 7 strict (`noUncheckedIndexedAccess`, `erasableSyntaxOnly`, `verbatimModuleSyntax`), typecheck-only (`noEmit`). Server runs TS natively on Node >= 24 (type stripping), no build step / tsx. `shared` is consumed as TS source (`exports` -> `src/index.ts`). Client: Vite 8 + Three.js 0.186. Tests: Vitest 5 at root (`*/src/**/*.test.ts`). `concurrently` for `npm run dev`.
Why: fewest moving parts; one source of truth for constants + schema; no compile step to drift.
Rejected: pnpm (not installed, npm workspaces suffice), tsx, ESLint/Prettier (strict tsc covers it for now).

## 2026-10-14 — Colyseus 0.18, schema without decorators
Decision: `@colyseus/core` + `ws-transport` (not the `colyseus` meta-package, which pulls redis/monitor/playground). State defined with schema 5's `schema({...})` + `t.*` builders in `shared/`, client passes the class as `rootSchema` for typed state. Room name `pool`, `maxClients` = `MAX_PLAYERS` (50), overflow opens a new room.
Why: decorators need legacy TS settings incompatible with native type stripping; schema 5 recommends `schema()`. Single `@colyseus/schema` copy verified (`npm ls`) — duplicates break encoding.
Note for P1: 0.18 ships fixed-timestep, input buffers, client prediction/reconciliation and rewind.

## 2026-10-14 — graphify-out not committed
Decision: `graphify-out/` is gitignored (derived, regenerate with `/graphify . --update`).

## 2026-10-14 — P1 simulation architecture
Decision: 20 Hz `setFixedTimestep`, one input = one fixed step. Movement rules (`move`, `clampSteer`, `radiusOf`, `speedOf`) live in `shared/src/sim.ts` and run identically on server and in the client `Reconciler`. Other world rules (feeding, metabolism, death, regrowth) are pure functions in `server/src/world.ts` over `PoolState`, so the P3 headless sim can drive them without a Room. Remote cells: `Predict` lerp, 100 ms delay.
Why: deterministic shared step = zero-latency own movement with no rubber-banding; measured reconcile drift ~1e-3 world units (test-asserted).
Rejected: dead reckoning for remotes (lerp is exact for now), `Rewind` lag compensation (nothing to hit until P3).

## 2026-10-14 — Input contract: clampSteer, not per-axis clamps
Decision: input = steering vector (dirX, dirY), throttle = |dir| ≤ 1. Clients call `clampSteer` before `send()`; the server uses the same function as its `defineInput` sanitizer (NaN/Infinity -> no input).
Why: a per-axis [-1,1] range clamp bent the heading of any |dir| > 1 input (pointer beyond full-throttle radius), so the server moved the cell somewhere else than the client predicted (2-15 units of divergence per step, found by test).

## 2026-10-14 — Low-Reynolds movement, no inertia
Decision: velocity follows input instantly (microbes have no momentum). speed = 300·mass^-0.4, radius = 4·√mass. Run-and-tumble (P3) layers on top.

## 2026-10-14 — Metabolism + starvation (only damage source until P3)
Decision: burn (0.02 + 0.002·mass) mass/s down to MIN_MASS 5; at the floor health drains 2/s, above it regenerates 5/s; health 0 -> death -> fresh individual (P4 swaps in lineage children). Mass capped at 100 (tier-1 cap).
Why: gives P1 a real eat-or-die loop and reaps idle/AFK cells (~4 min idle to death). Not in original Spore; revisit if it feels punishing.

## 2026-10-14 — Nutrients placeholder, full state sync
Decision: 600 nutrient particles, regrown instantly at random; the whole room is synced to every client (no interest management) and eating is an O(players × nutrients) scan.
Why: fine at 50 players + 600 entities. Upgrade path: StateView interest management + spatial grid when P3 plumes/bots raise entity counts.

## 2026-10-14 — P2 rendering pipeline
Decision: classic `WebGLRenderer` + `EffectComposer`: HDR half-float target (MSAA x4) -> `UnrealBloomPass` -> `OutputPass` (ACES, sRGB). Scene modules in `client/src/scene/` (pool, plankton, nutrients, cells, sprites, post, glsl); all shaders are hand-written GLSL strings.
Rejected: WebGPU/TSL pipeline (newer API surface, no need yet), `BokehPass`.

## 2026-10-14 — Depth of field baked per layer, not post-process
Decision: camera-facing instanced sprites grow by their circle of confusion (`APERTURE` · |depth - focus|, focus = gameplay plane) and dim to conserve light; the far floor uses soft low-frequency detail.
Why: transparent sprites never write depth, so a post-process DOF blurs them by whatever is behind them (wrong); baked CoC is correct for every layer and cheaper on mobile.

## 2026-10-14 — Pool currents = curl of drifting waves (shared)
Decision: `shared/src/current.ts`, 4 analytic modes, divergence-free (tested), peak < 70 u/s. P2 drifts plankton with it; P3 reuses it for nutrient plumes and cell drift.

## 2026-10-14 — No third-party shader code
Decision: all GLSL written from scratch (caustics = domain-warped animated Worley F2-F1). Why: popular Shadertoy caustics are CC BY-NC-SA, incompatible with cosmetics monetization.

## 2026-10-14 — Camera framing
Decision: camera z = 140 + 12·radius (≈290 at spawn, ≈620 at cap); cell is the hero (~60-75 px at spawn on 800 px tall view). Foreground layer must stay below the lowest camera (z ≈ 247).

## 2026-10-14 — P3 design forks (user-chosen)
Decision: genes auto-express when acquired during P3 (P4 adds placement/DNA costs/choice); run-and-tumble = tumble to turn (pointer > 45° off heading -> 0.3 s stop -> re-aim with ±60° error, ±15° with chemoreceptor; slow 0.7 rad/s steering within the cone); fission = tier-1 reproduction (P4), no agar attack split; controls = pointer steer, left click toxin, Shift/right-click endospore.

## 2026-10-14 — Genome = bitmask + upkeep
Decision: `Player.genome` uint32 bitmask over `GENES` (shared data catalog); each expressed gene adds upkeep (mass/s) to metabolism. Starter genome: pili (precise, slow, resists currents). Genes are added to the catalog only when their mechanic lands.

## 2026-10-14 — Deterministic randomness + shared clock for prediction
Decision: tumble randomness = xorshift32 state synced on `Player.rng` and stepped identically on both sides; `PoolState.time` (default 0) drives currents. Client replay uses the latest synced time (currents change slowly: sub-unit error, test-asserted drift < 0.3).

## 2026-10-14 — Silent clients drift after a grace period
Decision: if a client sends no input for IDLE_GRACE_TICKS (10 = 0.5 s) the server steps its cell with zero input so currents keep carrying it. The grace absorbs jitter so live clients never get unpredicted steps. A backgrounded tab is corrected when it resumes (expected; this is what the automation browser tab triggers).

## 2026-10-14 — Room options must be explicit (security)
Decision: `createServer` passes every room option explicitly (`dev: options.dev === true`). Why: Colyseus merges client create-options under handler options, so an unset key let a client `create('pool', { dev: true })` and enable cheats; regression-tested. Dev cheats only with `node src/index.ts --dev` (the `npm run dev` script); unknown messages get the client kicked (4002).

## 2026-10-14 — P3b food = drifting packets, spawn-only sync
Decision: food is packets (dissolved 1 mass, debris 2) emitted by 7 seeps that relocate every 90-240 s (plumes/streams) plus a thin background (6/s), drifting on the shared current, dissolving after 60 s or at the rock, capped at 2000. Only spawn point (float32, server pre-rounds with Math.fround), spawn tick and kind are synced; every client rebuilds the path with the shared fixed-tick `drift`. Rooms prewarm one lifetime (223 ms) so plumes exist at first join; a joining client catches up in ~67 ms.
Why: syncing ~1000 moving positions at 20 Hz ≈ 240 KB/s per client; spawn/remove events cost ~0.5 KB/s. Path identity is test-asserted (server vs rebuild, over the wire, bit-exact).
Rejected: synced scalar concentration grid (bandwidth), analytic field without depletion (no competition over plumes).

## 2026-10-14 — Sim clock = integer tick
Decision: `PoolState.tick` (uint32) replaces the float `time`; time = tick · TICK_DT. Why: exact and identical on every side forever (uint32 at 20 Hz lasts 6.8 years); float32 time would lose tick precision after ~1 day.

## 2026-10-14 — Feeding genes and Spore colour code
Decision: transporters ×1.5 dissolved yield, siderophores ×1.6 absorption reach (dotted ring shows it), exoenzymes ×2 debris yield (warm halo). Dissolved food is green, debris is red: Spore's plant/meat colour code, a nostalgia cue. Dead cells release 50% of their mass as debris.

## 2026-10-14 — P3c combat model
Decision: toxins are clouds synced like food (spawn point/tick/kind/owner; path rebuilt with `drift`), radius grows ∝ √age, dps fades linearly. Bacteriocin r 40→110, 4 s, 12 dps, 2.5 s cooldown, 0.6 mass; pore-former r 28→55, 1.2 s, 45 dps, 3 s cooldown, 0.8 mass; one click releases every toxin the genome makes; secretion can't drop you below MIN_MASS. Owner immune (P4: whole species, like real bacteriocin immunity genes). T6SS 20 dps on contact. Capsule ×0.6 toxin damage & ×0.9 swim; thick wall ×0.5 contact damage, ×1.4 max health, ×0.85 swim; efflux pump ×0.3 bacteriocin only (counterplay). Endospore lives in the shared step (predicted): 5 s dormant (no swim/eat/metabolism/damage, still drifts), 45 s cooldown. Health regenerates only 3 s after the last hit; deaths within that window are attributed to the last attacker. Stats live in `shared/src/combat.ts`.
Why: lysis-not-engulf (tier-1 realism); every weapon has a counter-gene; numbers are first guesses for the P3f balancing sim.

## 2026-10-14 — Action presses latch
Decision: a click/key press sets its action bit until the next input is sent (in addition to "held"). Why: on slow frames a quick tap could start and end between two input sends and be lost.

## 2026-10-14 — Dev workflow note
Decision: kill dev servers by process tree (`taskkill /T /F`) and re-check ports; `node --watch` parents otherwise survive and respawn stale servers that hold port 2567 without `--dev`.

## 2026-10-15 — P3d/P3e: one drifting-packet pipeline for food, DNA and phages
Decision: fragments, plasmids and phages are new `NutrientKind`s in the existing nutrient map (spawn-only sync, shared `drift`, 60 s lifetime, spatial grid, `NUTRIENT_CAP`). The carried gene is a server-only `Nutrient.gene` (noSync): what a packet holds is a surprise, like Spore's meteors. Phages bind the cell body (not siderophore reach) and are used up on contact. Phage deaths are attributed to `PHAGE_KILLER` ('~phage', never a session id).
Why: zero new sync/render/drift code paths; ~30 phages + a few plasmids cost nothing extra on the wire.
Numbers (first guesses for P3f): TRANSFORM_CHANCE 0.5, PLASMID_RATE 1/15 s, PHAGE_RATE 0.5/s, clearance 200, latent 5 s × 10 dps, burst 8, capsule blocks 0.6. Gained genes show as a client-side genome diff ("New gene: …"), no server message.
Note: `Encoder.BUFFER_SIZE` raised to NUTRIENT_CAP·24 bytes: the join snapshot of ~1000 packets overflowed the 8 KB default (warning since P3b).

## 2026-10-15 — P3f bots = players with a brain
Decision: bots are ordinary `Player` entries (ids `botN`) driven by `server/src/bots.ts` (pure functions over PoolState + a brain map): think every 4 ticks (5 Hz), then `stepCell` + `secrete` exactly like a human input. Species catalog is shared data (`BOT_SPECIES`, genes + archetype), assigned round-robin; dead bots are reborn as their own species (genes gained by transfer are lost). Rooms fill to BOT_FILL (30) cells; `bots` is an explicit room option (tests run with 0).
Why: one rule set means the headless sim's numbers transfer to humans; the same functions run in the room and in `server/src/balance.ts`.
Tuning pass 1 (20-min runs, 30 bots): before — 28.6 kills/min, lives ~1 min, Murus armatus (wall + T6SS) dominant, seep camping gave ~1.4 mass/s (5× design). After T6SS 20→12, SEEP_RATE 1.5→0.8, hunters chase only smaller prey: ~15 deaths/min, lives ~2 min, time to cap 1.6–2.6 min for the cells that make it. Cap counted at mass ≥ MASS_CAP − 1 (metabolism shaves the clamp in the same tick; P4's mate call must use the same rule).

## 2026-10-15 — P3g meteor intro + spawn grace
Decision: the intro is a client-only cinematic (sprites with baked DOF, additive, so the meteor is molten/glowing — it can't be drawn darker than the water), played once per page load; respawns just drift in. The meteor's height is tied to the camera's (55% of it) so the existing follow-zoom easing can drive the descent without the camera overtaking it. The server shields every new individual (humans and bots) for SPAWN_GRACE 5 s: no lysis damage, no phage infection, not chosen as prey (`Player.graceUntil`, noSync; `spawnPlayer()` without a tick = unshielded, as tests expect).
Why: the intro mutes input for ~2.8 s, and the P3f sim/browser run showed fresh mass-10 cells being hunted within seconds.
Rule learned: additive sprite glows must fall to exactly 0 inside the quad (multiply by a rim smoothstep), else bloom reveals the square.

## 2026-10-15 — P4 design forks (user-chosen)
Decision: (1) full Spore-like freeform editor (parts placed on the body, not a checklist); (2) DNA comes from mass eaten, kills and DNA fragments; (3) reproduction is binary fission for tiers 1–2 (bacteria, eukaryotes), a mate call only from tier 3 up — this replaces "mate call" in the core loop for tiers 1–2; (4) children cost a fixed DNA price.

## 2026-10-15 — P4 loop shape (user-chosen)
Decision: the editor opens at every fission (size cap), not once per tier: children stay in the same tier with the new design; an Evolve button (Spore's "Grow legs?") unlocks once lifetime DNA crosses a threshold, and only then are children born as the next tier (the Evolve moment itself lands with P5's "evolved to eukaryote" slice end). While editing, the dividing cell is a shielded division cyst (drifts, can't be hurt or act) with a 60 s editor timer. Parts stack: several copies of a part add effect with diminishing returns and per-copy upkeep, so the genome becomes per-gene copy counts.
Supersedes: "genes auto-express when acquired during P3" — gene transfer now unlocks parts into the species' library; the editor is where they're bought and placed.

## 2026-10-15 — P4a lineage implementation
Decision: genome = 2-bit copy counts per gene packed in the existing uint32 (`GENES.x.bit` = one copy, so bit-ORs of distinct genes still build genomes); maxCopies 3 for stackable parts, 1 for coats/endospore/efflux. Stacking: multiplier genes get 1 + (base − 1)·stack(n), stack = 0, 1, 1.5, 1.75; flagella ×(1 + 0.4·(stack − 1)); pili drift DRIFT_PILI^stack; chemoreceptor error ÷ stack; toxin clouds carry a server-side power = stack(n) (damage and mass cost); T6SS dps × stack. `Lineage` lives in `PoolState.lineages` (synced; bots have none), so it survives the Player instance being replaced. Fission: at mass ≥ cap − 1 a lineage cell becomes a division cyst (dormant like a spore, server countdown CYST_TIME 60 s); `submitDesign` validates every field of the untrusted design (library, maxCopies, placement bounds, hue, children, DNA) and prices it as new copies − old copies (refunds removed parts) + children × CHILD_PRICE, then hatches a child at the parent's spot. Death spends a child; none left → extinct (player removed, lineage kept for the screen).
Why cyst isn't in the shared step: the server counts it down, so a predicted field would always disagree ("cyst off by −58" warnings). The room zeroes a dividing cell's inputs and honest clients send zeros, so prediction stays exact.
Gotcha: the meteor intro must advance every frame even without a cell — dying mid-intro froze its flash/shockwave on screen until the next species spawned.

## 2026-10-15 — Editor symmetry (user-chosen)
Decision: the editor offers two symmetry modes, axial (bilateral mirror across the body's forward axis, Spore's default) and radial (rotational copies around the centre). A placement on the symmetry axis (axial) or at the centre (radial) is a single copy; otherwise the mirror/rotated copies are real copies (price, upkeep, stacking).

## 2026-10-15 — P4b/P4c editor and part rendering
Decision: the editor is a DOM overlay over a separate Three scene (orthographic, cell facing up) rendered through the same bloom pipeline (`post.render(scene, camera)`); the pool keeps simulating underneath while the cell is a shielded cyst. Placements are stored per copy (`Part`) with a `group` byte so the editor can rebuild symmetric groups (1 = single, mirrored pair = axial, otherwise radial). Radial symmetry places min(3, copies left) rotated copies. Each gene has an editor slot (membrane / internal / coat) and a default spot (`GENES.x.slot`, `.at`), which also drive `defaultParts` for bots and new species.
Drafts: the editor sends every valid change as a 'draft' (debounced 250 ms); the server validates it like a final design and keeps the latest per lineage (server-only WeakMap); a timed-out cyst applies it. Why: a client-side "submit before the timer ends" fails whenever the tab is throttled or backgrounded (seen in the automation browser: rAF paused, the old design hatched).
Rendering: parts are individual quads (one draw call each) in a body frame turning with the heading. ponytail: ~200 meshes for 30 cells; instance per kind if draw calls show in profiles.
Testing note: the automation Chrome window intermittently pauses requestAnimationFrame (occluded), so UI flows that depend on the render loop must be verified by wire-level tests, not only by clicking through.

## 2026-10-15 — P4d balance: bots divide, hunters restrained, pool mostly food
Decision: bots divide at the size cap like players (instant, same design, no editor), so the sim measures a generation (spawn → cap) and lives lost per generation. Stacked bot designs made hunters lethal (16 deaths/min, 3–40 lives lost per generation); restraint fixed it instead of nerfing parts: hunters chase only cells under 0.7× their mass and only while under 70 mass (agar's "eat what's clearly smaller", satiation), toxins only at prey or in self-defence; grazers flee armed cells ≥ 0.5× their mass within 200; spawns weighted grazer 3 / coward 2 / swarm 2 / hunter 1 (the pool is mostly food). SEEP_RATE 0.8 → 1.1 to bring generations toward ~2–3 min. Necrophagus traded an exoenzyme for transporters (debris is rare once kills are rare).
Targets now: generation ≈ 2–3 min, < 1 life lost per generation for a sensible design; Nudus errans (geneless) stays deliberate prey. Next tuning is with humans in playtests; bots dodge phages perfectly, so phage pressure can't be judged from the sim.

## 2026-10-15 — P5 names, Evolve ending, species card links
Decision: species get generated Latin binomials (Spore's random creature names), editable in the editor; `cleanName` (2–24 letters/spaces/'/-, NFC) is the only gate until P14's moderation filter, and names are only ever written with textContent/fillText. `Player.name` copies the species name onto every individual (bots included) so labels and the leaderboard need no lookups. Evolving needs EVOLVE_DNA (250) lifetime DNA, is a final design submission (never applied from a timed-out draft) and removes the species' cell; the client zooms out to the whole pool (stage-up) and shows the card. Card links carry the design in the URL fragment (base64url JSON, ~300 chars) — no server storage, nothing sent to a server when shared; `decodeCard` validates every field because links are untrusted. Cards render the real cell shader in a throwaway WebGL context.
Rejected: server-stored cards with short ids (needs storage/moderation; revisit with the P12 Hall of Fame).

## 2026-10-15 — Deployment path (user-chosen: free first)
Decision: staged. Stage 1 (now): playtests run from the dev PC — `npm run play` (production server on :2567 also serves client/dist via express.static, so page and game share one origin: no CORS, the client connects to location.origin) exposed with a Cloudflare quick tunnel (free, no account/domain, WebSockets supported). Stage 2 when the game is further along: one VPS — Oracle Always Free ARM (switch the account to pay-as-you-go so idle free VMs aren't reclaimed; still €0) or Hetzner (~€4/month, EU, reliable) — with Caddy (auto Let's Encrypt), systemd, Cloudflare free DNS/proxy, firewall 80/443/22, deploy script. Stage 3: domain (~€10/yr .com; .io pricier, IP check pending), Cloudflare Web Analytics + own events in SQLite.
Rejected: Render free (sleeps after idle, drops WebSockets), Fly.io/Railway (no free tier any more), GCP free e2-micro (US only: latency for EU players), serverless (no long-lived sim process).
Notes: express 5 is a direct server dependency (already pulled in by Colyseus) with @types/express; Colyseus handles SIGINT/SIGTERM gracefully by default. Static serving denies dotfiles; path traversal checked (404).

## 2026-10-15 — Tier 2 forks (user-chosen)
Decision: (1) eukaryotes live in the same pool as bacteria at a bigger scale (P7+P8 together): evolving keeps your place in the world, the camera zooms out, bacteria become small prey and a nuisance; (2) tier 2 is Spore's cell stage: mouths set the diet (filter = herbivore, jaw = carnivore, both = omnivore), cilia/flagellum/jet movement, spike/poison/electric weapons, engulf cells ≤ ½ your mass with a jaw; (3) endosymbiosis: engulfing specific bacteria species may unlock an organelle (mitochondrion, chloroplast), then placed in the editor; (4) an evolved species leaves tier 1 entirely: you play only the new tier (the card records the journey).

## 2026-10-15 — P8a tier-2 model
Decision: `Player.tier` + a separate `genome2` for tier-2 parts (catalog `TIER2`, built by the same `makeCatalog` factory as tier 1). A eukaryote has `genome = 0`, so every tier-1 rule (toxins, T6SS, capsule, tumbling, upkeep...) ignores it without any gating; tier-2 rules read `genome2`. Lineage keeps one `genome`/`parts`/`library` interpreted with its `tier`'s catalog (evolving swaps in the tier-2 starter design and library: tier-1 parts mean nothing to a eukaryote). Later tier-1 "carry-over traits" = a non-zero `genome` on a eukaryote.
Scale: mass continues from the tier-1 cap (spawn 120 → cap 1000, radius 44 → 126), own speed coefficient (90 → 39 u/s), metabolism 0.1 + 0.0006·mass, health 300, drift 0.4 of the current. Steering: cilia turn instantly, a lone flagellum turns at 2.2 rad/s but swims 1.25×. Diet by mouth: filter = algae (6 mass, tier-2 only) + dissolved; jaw = debris + meat chunks (10 mass, what a dead eukaryote becomes) + engulfing any cell ≤ ½ its mass whose centre it covers (80% of the victim's mass; no debris; endospores, cysts and newborns escape). Phages are bacteria-only. Evolve now continues the game as tier 2 (Spore's stage-up title) instead of ending it; the evolved flag is unused until Ascension (P12).
Pool radius 1500 → 2200 so 1000-mass cells have room; seeps, background food, plasmids, phages, nutrient cap and bots (30 → 40) scaled with the area.
Found while testing: generated names could reach 25 chars (> NAME_MAX 24, so a random species couldn't rename itself without shortening): NAME_MAX 28.

## 2026-10-15 — Universal editor across tiers (user direction)
Decision: one editor, one cell renderer, one design validator for every tier. Everything tier-specific comes from the tier's catalog (`catalogFor(tier)`: parts, prices, max copies, slot, default spot, labels) plus a few constants (`MAX_TIER`, `TIER_NAMES`, per-tier flagellum length). The editor picks its catalog when it opens; part kinds in the renderer are the tier-1 index or 16 + the tier-2 index, so a new tier adds catalog entries and shader branches, not new editors. Whole-body shader features (coats, halos) read only the tier-1 genome; eukaryotes get a nucleus via `uTier`. Dev gene keys send an index into the cell's own tier catalog.

## 2026-10-15 — P8c tier-2 weapons and part discovery
Decision: catalog-driven like everything tier-2. Spikes are directional (Spore: placement matters): each spike stabs within ±0.6 rad of where it points, reach 0.35 radii past the membrane, 30 dps × stack(facing spikes); the server reads the wearer's real placements (lineage design, or the default layout). Electric organ: 14 dps × stack to everything within 1.3 radii (bacteria too). Poison reuses the toxin-cloud system (TOXINS gains a `tier`; a cell secretes only its own tier's toxins) and is left behind the eukaryote; the same action bits mean secrete/poison (left) and endospore/jet (right) depending on tier. Jet = predicted dash (`dash`, `dashCooldown` on the body, like the endospore): 0.8 s at 2.6×, 6 s cooldown. Eyes are a client sight bonus (camera +18 % per stacked eye).
Discovery (Spore's meteor bits): meteor shards drift in (1/20 s) carrying a random tier-2 part, unlocked by any eukaryote touching one; a dead eukaryote spills one gene-carrying chunk per part (eaten with a jaw: 50 % unlock). Weapons and the jet must be found; eyes are in the starter library.
Fixed on the way: bacteria eating a gene-carrying chunk would have OR'ed a tier-2 bit into their tier-1 library — tier-1 unlocks now only come from bacterial DNA packets (fragments, plasmids).

## 2026-10-15 — P8d shapes, photosynthesis, endosymbiosis
Decision: body shape is a species trait (Lineage/Player.shape: 0 coccus/round, 1 rod/elongated, 2 vibrio/crescent), picked in the universal editor at every tier, visual only (collisions stay circular). Designs stay on the canonical unit circle; shared/shapes.ts deform/undeform (stretch then bend) drive the body shader, part placement and editor pointer mapping; body quads now turn with the heading. Photosynthesis: tier-1 thylakoid gene (PHOTO_RATE 0.08 × stack), tier-2 chloroplast (0.35 × stack); mitochondrion: metabolism −15 % and speed +8 % × stack. Endosymbiosis: swallowing a bacterium with transporters (25 %) → mitochondrion, with thylakoids → chloroplast. Three photosynthetic bot species: Cyanella viridis (coccus), Lumibacter virens (rod), Chlorovibrio lentus (vibrio); existing species got shapes.

## 2026-10-15 — "Mass" is called Energy (user direction)
Decision: everything players read says energy (status bar, editor upkeep "energy/s", leaderboard label). The code and the wire keep the `mass` field and constant names (MASS_CAP, SPAWN_MASS, ...): same quantity, a rename there would only churn the schema and hundreds of lines. Size still grows with it (radius = 4·√energy).

## 2026-10-15 — P8e eukaryote bots, perf, balance
Decision: species carry a `tier`; their genes are names in that tier's catalog and `incarnate` builds the right individual (tier fields, newborn size, health, name, shape). Eukaryote behaviour reuses the archetypes: senses and fear distances ×2; hunters chase what their jaw can swallow; a hunter that can also graze hunts only when hungry, a pure carnivore (jaw, no filter) hunts to its cap but rests 6 s to digest after each swallow (caps its kill rate); eukaryote cowards fear other eukaryotes only; a fleeing eukaryote drops poison and fires its jet. Bacteria with an endospore sporulate when a swallower closes in (spores can't be digested) — the counter-play to jaws.
Bug: overlapping a cell a bot didn't fear divided by a zero fear distance → infinite steering → NaN position forever. Harmless-looking among bacteria (a ghost), catastrophic with engulfing (`NaN >= mouth²` is false: a NaN eukaryote "touched" every cell). Fixed at the cause, plus bot steering now goes through `sanitizeInput` like human input, and the engulf range check is NaN-safe.
Perf: the sim had slowed to ~50× real time after the bigger pool. Profile: packet drift (currentAt) 33 %, stepWorld 25 %, bot perception 24 %. Bot perception now reads a per-tick packet grid (cells within sight only); passive packets drift every DRIFT_TICKS = 2 ticks (deterministic, shared, clients glide between steps) → 70–87×. Production cost ≈ 0.7 ms of a 50 ms tick.
Balance (20 min, 40 bots): deaths 6–7/min; eukaryote generations 2.7–4.1 min, Didinia (apex carnivore) ~11.5 min; bacteria mostly ≤ 1 life per generation (Nudus is designed prey; small-sample species vary run to run).

## 2026-10-15 — Thriving pond background (user direction: depth and scale)
Decision: the floor shader paints a natural pond bottom from large slow fbm fields (silt ↔ sand with soft ripples, mossy patches, weed clumps) under a regionally varying water tint (clear blue, teal, pond green); caustics became broad, blurred sun patches. A transparent water-column haze plane at z −650 (density variation + soft light shafts) gives atmospheric perspective and parallax against the floor. The rim is an earthy, mossy bank. Distant giants (client/src/scene/giants.ts): SDF silhouettes of later-tier life at z −420…−1320, translucent with a backlit rim and inner features, softened by depth; they are recycled around the camera (reappear just off-screen on a crossing path) so the player regularly sees them.
Lessons: fine detail (pebbles) on a far, defocused layer reads as a grid pattern — keep far layers low-frequency; every term of a quad shader must reach 0 inside the quad (the giants' rim drew straight quad edges, like the meteor flash did).

## 2026-10-15 — P8f hazards of eukaryotes
Decision: two hazards built from existing systems. Giant viruses are the eukaryote's phages (NutrientKind.virus, same drift/infection/burst pipeline, the cell's tier picks which virus can infect it and which bursts out; VIRUS_KILLER for the death screen). Parasitism is a bacterial gene (Adhesins): contact with a eukaryote drains its energy — no attachment/pinning, so no prediction special case; a parasite must keep up with its host, which makes the jet (outrun), electric organ and spikes (kill) the counterplay. Being a gene, players can find it and play parasite. Bot species Chytridium parasita (weight 2) holds station on a host's rim, outside its jaw's reach.

## 2026-10-15 — Colour code and salty-shore pond (user direction)
Decision: one colour language for everything that drifts: food is white (dissolved motes, algae, debris, meat chunks, seep glows), bonuses are green (DNA fragments, plasmids, meteor shards), dangers are red (phages, giant viruses, all toxin clouds, toxin glands, virions inside an infected cell). Supersedes the Spore plant-green/meat-red food code (P3b). The pond is a rock pool on a salty shore: bright clear sand flats, dark rock outcrops, green-to-olive seaweed meadows and silt, under water from shallow turquoise/sea green (bottom visible) to deep blue/navy holes. Giants: 4 (was 9), cruising by fixed rules — straight 28 s legs with a gentle weave, a deterministic per-giant turn sequence (20–50° to one side), re-entry across the camera's area when out of range.

## 2026-10-15 — Tier 3 forks (user-chosen)
Decision: (1) tier-3 animals live in the same pool, which grows; the camera zooms out further on evolving; bacteria become specks, eukaryotes prey. (2) The body is a segmented spine edited in the universal editor (add, remove, resize segments; parts attach to the body), with a radial body plan as an alternative (segments/arms arranged around a centre). (3) Reproduction from tier 3 is a mate call: at the size cap you call, a mate of your species comes (another player or an AI mate), then the editor, then an egg clutch is laid that stays vulnerable until it hatches into the next individual; bought children are extra eggs.

## 2026-10-15 — P9a animals
Decision: an animal is a third genome field (genome3) and catalog (TIER3), like tier 2; ownGenome(p) picks the field by tier everywhere. Mass continues from the eukaryote cap (newborn 1200 ≈ a grown eukaryote, cap 6000), so a new animal is a peer of the biggest eukaryotes and grows to dwarf them. Diet by mouthparts: filter combs sweep up dissolved food, algae and whole bacteria; mandibles take meat, swallow eukaryotes up to half the animal's mass and bite rival animals in a front arc (MANDIBLE_DPS 60, carapace lets 60 % through). Evolving to tier 3 costs 2500 lifetime DNA (tier 1 → 2 stays 250). The pond grows to radius 3000 (rates scaled with the area, 50 bots). The camera zooms out more gently past eukaryote size so specks stay readable. Body: three blended segment circles (P9b makes them editable); membrane parts sit on that outline (animalRim, shared with the future editor). defaultParts now mirrors paired side parts across the axis (legs, cilia) for every tier. Animals ignore phages/giant viruses and parasites until tier-3 hazards (P9d). Joining a room now decodes ~4000 food packets (~2.5 s in the test harness): app tests get a 20 s timeout.

## 2026-10-15 — P9b animal body editor
Decision: a body is a plan (spine or radial) plus 2–6 relative segment sizes (0.3–1); `segmentsOf` lays them out (spine: a head-first chain, each segment overlapping the last; radial: a centre and evenly spaced lobes from the front) and scales the whole body to span about the cell's circle, so only proportions are a choice and the collision circle stays honest. The body is free (no DNA), visual and layout only (no stat effect yet). Resizing is a drag on a segment's edge measured from where the segment was when grabbed, so refitting can't feed back into the drag; radial lobes always resize together (symmetry). Switching plan starts from that plan's default.

## 2026-10-15 — P9c mate call and eggs
Decision: one player per species, so the mate is always an AI mate: a server-driven, invulnerable Player keyed `~mate:<caller>` (session ids never contain '~') that wears the caller's look and swims straight in faster than any animal; mates are skipped by feeding, combat, metabolism and the leaderboard, and vanish when the call ends. Calling keeps the animal active and vulnerable (Spore's "mate call" risk); meeting the mate, or 15 s of calling, starts the usual editor cyst. Finishing the editor lays a clutch on the spot instead of dividing: the parent stays the same individual at newborn energy (the energy went into the eggs) and can guard it; after 20 s the player becomes the hatchling at the clutch with the new design. Eukaryotes and animals eat a touched clutch (150/s of 400, as food): if it's eaten, the design is kept but the animal must regrow and call again. Children in reserve stay lives (death respawns as before); they only show as extra eggs in the clutch. Considered: making the player wait as the egg (no body) — rejected, it removes play for 20 s and needs a bodiless client state.

## 2026-10-15 — P9d animal bots and balance
Decision: three animal bot species (weight 1 each, ~4 of 50 bots). A first sim had animals emptying the pool (21.5 deaths/min, two hunters eating ~200 cells, mostly bacteria). Fix: animal hunters only chase eukaryotes and animals (bacteria are swept up in passing by filter combs, never hunted) and digest 30 s after any meal; result 12.1 deaths/min. Tier-3 hazards reuse existing systems: adhesin parasites now drain any eukaryote or animal, rival animals bite with mandibles, and unguarded clutches get eaten. Bot animals divide at the cap without the mate ritual (ponytail: give bots mates if players notice). Animals currently never die in the sim: they are the apex until tier-3 threats or human players arrive.

## 2026-10-15 — Feel pass: inertia, turns, collisions, bites (user direction)
Decision: gameplay feel over low-Reynolds realism. Cells carry a velocity (Player.vx/vy, reconciled like position) that eases toward the propulsion with a per-tier time constant (0.3 / 0.5 / 0.8 s), and every motility type turns at a limited rate (pili 4, creep 2.5, cilia 3.5, paddles 2.5 rad/s; flagella and tails keep their slower rates); a bacterial tumble now spins the cell to its new random heading (Player.aim, 14 rad/s) instead of jumping, so parts never teleport. Collisions are server-side (after movement, before feeding): overlapping cells push apart by mass and bounce (restitution 0.6 plus an overlap kick); pairs where one can swallow the other pass through (engulfing needs overlap), mates are ghosts; contact checks (T6SS, adhesins) got 8 % slack since cells now rest at touching distance. The client predicts its own velocity but not collisions: the server's push arrives as a correction, felt as the bump. Fights are Spore-style discrete bites: a jaw or mandibles bite the nearest cell in front that is too big to swallow, every 0.8 s (28 / 45 damage, carapace and thick wall soften), tearing off a chunk of meat and knocking the victim away while the biter recoils; Player.bites counts them so clients snap the mouthparts (also on a swallow). All reactions (contact flattening, impact jiggle, hurt flash, pinocytosis on packets vanishing at a membrane) are client-side visuals derived from synced state, no new messages. Sim after the pass: 11.1 deaths/min (was 12.1).

## 2026-10-16 — Dynamic bodies: soft rig, visual only (user direction + choice)
Decision: every body and part gets physics-driven secondary motion on the client (`client/src/scene/rig.ts`); the server's circles, heading, collisions and balance are untouched (user chose visual only over a server-simulated chain). Whips (flagella, tails) are 12-point chains in world space, rooted on the body and trailing through the water; the flagellum shader draws along them. Animal spines are follow-the-leader chains: the head is pinned to the body frame, each segment follows at its rest distance (≤ 0.6 rad per joint), and `uSeg` is uploaded every frame (the gut follows the segment centres); radial lobes lag on a leash. Parts ride their nearest segment. Cells bow into turns (`deform(..., flex)`, a spring on the turn rate, strongest for rods and crescents). Membrane parts swing on per-kind springs against the turn and sideways pushes; organelles slosh against acceleration. The rig snaps to rest with no motion (editor, card, first frame, a jump of more than 2 radii).
Lesson: positional pulls inside verlet act as a stiff, almost undamped spring (a whip rang like a pendulum for seconds). Shape relaxation now moves the point and its previous position together (overdamped, as in water); only the root dragging the chain carries momentum. Tuning: whip bend 40/s, water drag 12/s, so the tip lags about 0.2 s, cracks across and settles in about 0.75 s.

## 2026-10-16 — Frame budget: 60 fps first (user direction)
Decision: no more features while the game can't hold 60 fps. Measured on the user's setup (Brave, 1239×631 at DPR 1.5), GPU about 88 ms per frame at the start. A dev readout (`client/src/perf.ts`: median/p95 CPU per section, GPU via EXT_disjoint_timer_query_webgl2, draw calls; `?off=floor,haze,bloom,plankton,nutrients`, `?res=0.7` pins the scale) attributed it by difference; draw calls were never the problem (~40).
Cuts, all at full resolution, GPU 88 → ~14 ms: no MSAA on the half-float HDR target (it cost more than everything else together; every shape antialiases itself); far layers (floor, haze, giants) render at half resolution into `post.far` as the main scene's background; the floor's static fields are baked once into two 1024² half-float textures (14 fbm per pixel → two texture reads + sun and caustics); haze on two-octave noise; bloom at half resolution; plankton quads with almost no coverage are skipped in the vertex shader (`uCull`), with cheap sine-warp outlines instead of value noise. Adaptive resolution (main.ts) keeps GPU ≤ 12 ms: judged by the GPU timer when present (fewer pixels can't fix a CPU limit or a throttled tab), by missed frames otherwise; scale 0.5–1 × DPR.
CPU: `currentAt` loops by index (a tuple iterator per mode was the cost); nutrient packets drift once per tick (not per frame), only packets in view are uploaded, and far off-screen packets drift lazily on staggered 1–2 s periods (drift catches up exactly, so this costs no accuracy). Off-screen cells are parked (no rig, reactions or uniforms). At a real 60 fps cadence: nutrients 0.2 ms median, cells ~2 ms.
Lesson: the automation browser tab is throttled (1–20 fps), which inflates every per-frame CPU cost that scales with elapsed time (prediction replay, tick catch-up) and stretches the meteor intro (dt is clamped to 0.1 s). Measure GPU with the timer query and CPU at a simulated 60 fps cadence, not from that tab's frame rate.

## 2026-10-16 — Calmer light, natural pond matter (user direction)
Decision: glow toned down significantly. Bloom 0.7/0.5/0.7 → 0.25/0.35/0.95 (strength/radius/threshold: only true highlights bloom), exposure 1.1 → 1.0, and emissive multipliers above 1 roughly halved (food cores, DNA, plasmids, phages, shards, part glands and receptors, eyes, the body glint and halo). The colour code stays (food white, bonuses green, dangers red), just dimmer; seeps are a soft warm glow. The background bokeh became matter instead of light: plankton is drawn with premultiplied normal blending (brown flakes darken the water) — tan silt and dust, ragged brown detritus flakes, pale marine snow, olive algae, golden diatoms, rare translucent big organisms — tumbling and sinking slowly; the foreground layer is a faint dust veil. The haze gained murky patches of brown silt and olive organic haze over clearer blue-green water.

## 2026-10-16 — Animals as real animals; tier sizes; evolving opens the editor (user direction + choice)
Animal body (user: "segments dissociate", "must really look and move like a worm or insect, a real step from the eukaryote"). Cause of the separation: an animal's body shape (Long/Curved) was a whole-body stretch applied after the rig bent the spine, so sideways-bent plates were squashed apart. Now an animal's shape is per segment: the shape lays out the rest spine (longer, curved), each plate keeps its own proportions (`PLATE` in cells.ts) along its own segment's axis, and the rig and shader work in the body frame. The spine (rig.ts) is a kinematic chain of link angles behind a pinned head: lengths exact by construction (segments can never come apart), each link turns toward its parent at speed/length (the body follows its head's path) plus slow straightening, ≤ 0.45 rad per joint and ≤ 1.2 rad of total curl (it never folds), with a swimming undulation wave. Animals get their own shader branch: opaque segmented cuticle (plates, dark furrows, paler dorsal ridge, mottling, lit as solid segments), jointed legs rowing in a metachronal wave on every body segment, antennae, two tail filaments; radial plans wave tentacles. No membrane glow, nucleus or cytoplasm. Their quad is bigger (2.8 radii) and the editor frames them wider.
Tier sizes (user chose ×1.5 / ×2.2 with pool 4500): `radiusOf(mass, tier)` scales by TIER_SCALE [_, 1, 1.5, 2.2] — eukaryotes 66→190, animals 305→680, each newborn ~1.6× the previous tier's adult. WORLD_RADIUS 3000 → 4500 with every area rate ×2.25 (seeps, background food, cap, plasmids, phages, algae, shards, giant viruses); eukaryotes swim ×1.22 and animals ×1.25 faster; egg clutches 150. Swallowing kept near its old absolute reach so big bodies don't vacuum the pool: eukaryotes engulf within 0.6 radii of their centre (was 0.9), animals only with a mouth at the head (0.3 radii, 0.75 ahead). Animals no longer swallow rival animals whole (a newborn animal was gulped by any adult of twice its mass): rivals fight with bites. Sim (15 min): 80 bots made it ~3× deadlier, so BOT_FILL stays 50 → 14.5 deaths/min (was 11.1 in the old pool), animals still the top predators; tune with humans.
Evolving now opens the new tier's editor (Spore): the species' next individual is born in a stage-up cyst (`Player.evolving`) once the stage-up title has played; its design hatches it (an animal's first individual hatches as itself, no mate or clutch). The old tier's draft is dropped (it can't apply to the new catalog).

## 2026-10-16 — Animal-phase frame budget; stage-up order (user direction)
Stage-up order: evolving opens the new tier's editor at once; the stage-up title plays when its first individual hatches (`pendingStageUp` in main.ts).
Animal phase measured at 30 fps (user): GPU-bound at ~16–19 ms at full resolution, and on a 60 Hz display a frame that misses 16.7 ms by a little halves the rate. With every other layer off, the cells alone took 14.8 ms: each animal drew a fixed 5.6 × 5.6 radius quad of mostly open water through the costliest shader in the game. Now an animal's quad is the bounding box of what its segments draw this frame (`uQuad`: centre + half extents; the full square only while calling a mate), the shader skips segments beyond their reach and returns early on open water, and the impact jiggle's trig runs only during impacts → cells ~9 ms; with adaptive resolution the animal phase holds ~10.7 ms GPU at ~72 % resolution. The camera and meteor follow the cell's centre (`view.at`), not the body mesh, whose quad is now offset.
Nutrients at animal zoom (a third of the pool in view): every packet now drifts lazily — visible ones every 8–16 ticks (gliding on their last flow in between; the change in current over 0.8 s moves one ~1 unit), off-screen ones only once their stale position could reach the drawn area (distance ÷ 65 u/s max current). At a 60 fps cadence: mean ~1.8 ms, p95 ~4 ms (was 2.7 / 8.3). Dev: `layers.<name>.visible`, `bloom.enabled`, `perfReset()`, `nutrientLayer` on window for live attribution.
Measuring lesson (again): the automation tab drops to 1–15 fps, so per-frame CPU that scales with elapsed ticks reads 10× too high there; use the GPU timer, a pinned `?res=1`, and synthetic timing at a 60 fps cadence.
Bugs after the animal pass (user report): (1) faint rings ("bubbles") around animals — the per-segment early-out leaves sd/limbs at 1e3, so fwidth() across each skip circle was huge and the edge smoothstep drew a ring; edge softness now comes from the pixel size (length(fwidth(p))). (2) Lightning-like flashes — Fulgur timidus's electric organ redrew a full arc pattern 12×/s above the bloom threshold; arcs now crackle only in random 1/8 s moments, thinner and dimmer, below bloom.

## 2026-10-17 — Tier 4 forks (user-chosen)
Decision: (1) tier 4 has two body plans in the universal editor: Arthropod (hard exoskeleton plates, jointed legs, claws) and Mollusk (soft body under a shell; ink eject belongs to it); the plan picks which parts are allowed. (2) Same pool, which grows again (TIER_SCALE ~3.2, pool ~6500, area rates scaled; frame budget re-checked at the new zoom). (3) Reproduction is a metamorphosis cocoon: mate call → editor → the player's own body becomes a shielded, immobile cocoon for a while, then the new design emerges (safer than the tier-3 clutch, but tied to one spot). Build: tier 4 is "an animal with a 4th catalog" (`genome4`, `TIER4`), reusing segments, rig, mate call, bites and the animal shader; animal-ness checks become `tier >= 3`.

## 2026-10-17 — P10a tier-4 model, bigger pool, packet grid
Decision: tier 4 is a fourth genome field and catalog (genome4, TIER4), reusing the animal machinery: isAnimal(tier) = tier ≥ 3 drives segments, the mouth at the head, the mate call and the animal shader; GENOME_FIELD maps a tier to its field, and embody() makes any newborn of a tier (lineages and bots share it). One catalog holds both plans' parts (P10b gates them by plan): legs (precise), tail fan (fast, wide turns), claws (bite, ×1.5 with two), grazing mouthparts, exoskeleton (bites ×0.55, swim ×0.92); muscular foot (slow, barely drifts), siphon (fast), radula, beak, shell (bites ×0.35, swim ×0.8); eye. Diets as before by mouth: grazers take dissolved food, algae and sweep up bacteria; claws and beaks take meat and swallow anything of a lower tier up to half their mass (animals included), and bite what's bigger. Scale: TIER_SCALE 2.8, energy 6000 → 10000 (radius ≈ 870 → 1120), speed 150 → 122 u/s, health 3000, metabolism ≈ 3.3–4.5/s, bite 110; evolving an animal species takes 15000 lifetime DNA. No floor-grazing income: at this size sweeping packets already pays (a body ~1000 across moving 150 u/s sweeps ~300k u²/s). Pool 4500 → 6500 with every area rate ×2.09; BOT_FILL stays 50 until P10e. The camera zooms out a third as fast past an animal's size (3 per unit of radius beyond 680).
Perf: the sim had fallen to 8× real time in the 4500 pool (4.5× at 6500). Cause: rebuilding a Map of per-cell string arrays for every packet every tick (and bots built a second one). Now one counting-sorted flat grid (server/src/grid.ts) built from the drift loop and shared with bot perception via a WeakMap per pool (rooms share the process): 18× real time, ~2.8 ms per tick with 50 bots; drift trig is the rest. Lesson: GLSL reserves `out` (and builtin names like `step` make poor identifiers): a compile error there blanks every placed part, not just the new one.

## 2026-10-17 — P10b body plans for tier 4
Decision: PLAN_NAMES grows to Spine, Radial, Arthropod, Mollusk; PLANS_OF[tier] lists what a tier offers (3: spine/radial, 4: arthropod/mollusk), so every existing segmentsOf(plan) caller keeps working (only plan 1 is laid out radially). fitsPlan(plan, bit) gates tier-4 parts: arthropod = legs, tail fan, claws, grazing mouthparts, exoskeleton, eye; mollusk = foot, siphon, radula, beak, shell, eye. The server refuses a part that doesn't fit; a design that omits plan/radii keeps the lineage's current body. Plan switch in the editor resets the body to that plan's default (DEFAULT_RADII_OF: crayfish 5 segments, snail head + big body) and drops parts that don't fit (refunded by the usual price diff). Visuals in the one animal shader (uBody): arthropods are crisp chitin plates (tight joint blend, deep sutures, browner, glossier) and walk only on placed legs; mollusks are one soft body (wide blend, no furrows, speckled, wet sheen) with eye stalks, the foot a translucent skirt with pedal waves, the shell a log-spiral coil (few rounded whorls, a band per whorl, dark suture, apex offset) riding the biggest segment as the rig moves it.

## 2026-10-17 — P10c metamorphosis cocoon
Decision: a synced Player.cocoon countdown, separate from the cyst: the cyst means "editor open" to the client (it would keep the editor up), the cocoon comes after it. hatch() for a tier-4 parent ends the cyst and starts a COCOON_TIME (12 s) cocoon on the same individual; dormant() includes it (no eating, fighting, metabolism, damage, parasites; bots don't hunt it), the room zeroes its inputs like a cyst's; at 0 the lineage's next individual (the new design, newborn energy, spawn grace) replaces it where it lay. A timed-out editor goes through the same hatch(). Children stay reserve lives (no clutch). Drawn in the animal shader as a silk spindle around the body (head to tail, pointed ends, two windings of fibres, the body faintly inside); the quad is the full square while cocooned (the spindle reaches past the segments' bounding box).

## 2026-10-17 — P10d ink; fights span one tier
Ink: a mollusk part (inkSac, found, appended to TIER4). Right click/Shift starts a predicted dash in stepArthropod (INK_TIME 0.9 s at ×2.2, INK_COOLDOWN 10 s); the server releases the cloud when it sees the dash start (dashCooldown rose during the step, in the room and for bots), so no new message or action bit. The cloud is a TOXINS entry (tier 4, dps 0, radius 700 → 1700 over 7 s) on the existing synced, drifting cloud pipeline; left-click secretion skips it, lysis ignores it. Hiding: a bot ignores every cell whose centre is inside someone else's ink (inInk); mollusk bots squirt when fleeing. Client: a second sprite layer drawn as matter (premultiplied), dense near-black sepia billows. Lesson: in that shader, mixing the colour by a noise value blew up into a white bloom veil in the browser while the same value inside a min()-clamped alpha looked fine; keep the ink colour flat and the noise in alpha.
Fights span one tier (roadmap rule, now enforced): toxin clouds, T6SS, electric organs, spikes and bites from a cell two or more tiers smaller do no damage (outranks()). Found in the browser: a Didinia (tier 2, two spikes) resting against an idle arthropod's rim stabbed it to death in about a minute. Parasites (energy drain) and tier-3 bites on tier 4 remain; a Hydrina (tier 3) biting an unarmed snail still kills it in ~1 min: P10e balance.

## 2026-10-17 — Polish phase before more content (user direction + choices)
Decision: pause content after P10d for a polish phase (plan: ROADMAP "Polish phase", slices S0–S5). Choices: (1) organisms are adapted toward a microscope / documentary look, not reworked from scratch (user: keep the existing look, make the background more vibrant and light); (2) the editor's colour slider becomes natural pigment swatches (chlorophyll green, amber, rust, hyaline, olive, cyan-teal, carotenoid orange, brown) plus a pattern (plain, speckled, banded): Lineage.hue stays on the wire as a pigment index, a new pattern field joins it; (3) clay sculpting at every tier: cells get continuous length/width/bend (replacing the Coccus/Rod/Vibrio presets; old shape ids map to presets), animals lengthen/shorten by dragging (segment count follows, 2–6) and thicken regions with a brush; no segment or shape buttons; (4) balance: tier-4 health 3000 → 5000 and bites from a smaller tier do half damage (a tier-3 Hydrina was killing an unarmed snail in ~1 min). HUD: minimal and discreet (energy and DNA gauges, children as icons, ability chips, toasts), health hidden behind the existing hurt flash plus a low-health vignette; one set of CSS design tokens shared by HUD, editor, leaderboard and cards. Ripples: a cheap additive ring layer around the player's own body only, triggered from client-side data (impacts, bites, dash start, hard acceleration, entering strong current, hatching). Background: lighter, sunnier, distinct regions (cream textured sand, vibrant cyan wave-caustic shallows, dark grey rock), thinner warmer haze, colourful dust; still baked and low-frequency (frame budget). Deferred: tier-4 bots (later), balance numbers (P10e). Frame budget at tier 4 confirmed by the user (steady 60 fps).

## 2026-10-17 — Polish S1: sunny pond
Decision: the floor bake keeps its two textures but pass 1's alpha now holds "cyan shallows" (caustic strength); the sunlit falloff is computed live (cheap). Regions from the existing fbm fields plus one more (cyanF): cream-to-pale-yellow rippled sand (~0.33–0.56 linear), grey cracked rock (0.06–0.17) that also lifts clarity (it rises close under the surface) and cancels depth, mossy/leaf weed, warm silt, cyan shallows over pale sand; water turquoise/sea-green/blue, saturated, shallower overall. The live floor brings back P2's caustics (warped Worley edges, two layers, the second only where shallows show). Haze is a thin sunny veil (alpha ~0.03–0.1). Dust recoloured (greys, umber/chestnut, mossy-to-leaf green, golden diatoms) with the pale motes kept faint: light matter at many depths otherwise veils the pond in milk. Additive food dims as the camera rises (uFocus 1500 → 6500: × 1 → 0.4): ~60 packets of a plume piled into white bloom blobs once the background was light. Lessons: fine texture (≤ 200 units) on the far floor reads as grain from tier-3/4 heights, keep it ≥ ~500; pinning the camera high from the console during the meteor intro keeps the meteor hovering as a huge glow (pin after it lands).

## 2026-10-17 — Polish S2: microscope look (adapted, not rewritten)
Decision: species colour is a natural pigment (shared/pigments.ts: Chlorophyll, Amber, Rust, Hyaline, Olive, Teal, Carotene, Umber; sRGB hex, converted to linear) plus a pattern (Plain, Speckled, Banded), both read from the existing Lineage.hue (pigmentOf: integer part of hue × 8 = pigment, the rest × 3 = pattern), so no wire change; bots keep their hashed hue. The editor's swatches (S4) will write hue that way. Cells read as brightfield microscopy against the light pond: translucent pale pigment-tinted cytoplasm (alpha ~0.4 at the centre, denser at the rim), a dark refractive outline with a thin light inner rim, finer granules, a darker defined nucleus with a fine envelope and dense nucleolus, glow only where it means something (exoenzymes). Part colours are desaturated and dimmed globally; Spore's googly eyes became an orange carotenoid eyespot (protists) and a dark faceted compound eye (animals). Animals: see-through thin edges, a dark granular gut tube down the spine (drawn after the dorsal ridge highlight, which otherwise washed it out), fine cuticle grain, speckles or bands per plate. The editor's preview background is light pond water: these bodies are drawn for a light background.
