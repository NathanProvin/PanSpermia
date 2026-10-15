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
