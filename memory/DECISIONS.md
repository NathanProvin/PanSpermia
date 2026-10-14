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
