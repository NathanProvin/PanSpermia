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
