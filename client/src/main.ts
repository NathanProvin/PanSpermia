import { Callbacks, Client, Predict, type Reconciler } from '@colyseus/sdk';
import {
  ACTION_SPORE, ACTION_TOXIN, Input, NutrientKind, PACKET_DNA, PLASMID_DNA, type Lineage, type Player, PoolState, ROOM_NAME, SERVER_PORT,
  BOT_SPECIES, EYE_SIGHT, ANTENNA_SIGHT, MATE_PREFIX, TICK_DT, TICK_RATE, TIER2, TIER3, TIER4, TOXINS, TUN_COOLDOWN, isAnimal, ENDOSPORE_COOLDOWN, INK_COOLDOWN,
  JET_COOLDOWN, formOf, TIER_NAMES, evolveDnaOf, massCapOf, minMassOf, currentAt, speedOf, isMate, ownGenome, segmentsOf, catalogFor, hasGene, stack, healthMaxOf, radiusOf, sanitizeInput, stepCell,
  hasBit, withBit, DEFAULT_RADII, Lineage as LineageState,
} from '@panspermia/shared';
import * as THREE from 'three';
import { type CardData, decodeCard, showCard } from './card.ts';
import { createEditor } from './editor.ts';
import { type HallLists, createEnding } from './ending.ts';
import { createHistory } from './history.ts';
import { type Ability, createHud } from './hud.ts';
import { createLabels } from './labels.ts';
import { type Look, createCells, hashId } from './scene/cells.ts';
import { createClouds } from './scene/clouds.ts';
import { createMeteor } from './scene/meteor.ts';
import { createNutrients, isDna } from './scene/nutrients.ts';
import { createGiants } from './scene/giants.ts';
import { createPlankton } from './scene/plankton.ts';
import { createPool } from './scene/pool.ts';
import { createRipples } from './scene/ripples.ts';
import { createFeast } from './scene/feast.ts';
import { createPost } from './scene/post.ts';
import { createPerf, off } from './perf.ts';
import { createTickClock, createTrails } from './timeline.ts';

const hud = createHud(document.getElementById('hud')!);
hud.message('Connecting…');
const cardScreen = document.getElementById('card')!;
const stageup = document.getElementById('stageup')!;
const labels = createLabels(document.getElementById('labels')!, document.getElementById('leaders') as HTMLOListElement);
// Dev: Vite serves the page, the game server is on its own port. Production: the game server serves
// the page too, so the game is wherever the page came from (localhost, a tunnel, a domain).
const endpoint = import.meta.env.VITE_SERVER_URL
  ?? (import.meta.env.DEV ? `${location.protocol}//${location.hostname}:${SERVER_PORT}` : location.origin);

const renderer = new THREE.WebGLRenderer({ antialias: false }); // MSAA lives on the composer's HDR target
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
// Top-down perspective camera over the gameplay plane z = 0, which is also the focal plane.
const camera = new THREE.PerspectiveCamera(50, 1, 10, 24000); // far: a grown animal's camera (eyes, antennae) over the pond floor
camera.position.z = 700;

const post = createPost(renderer, scene, camera);
const perf = createPerf(renderer);
// The console reads the budget: perf(); perfReset() forgets the samples (after toggling a layer).
if (import.meta.env.DEV) Object.assign(window, { perf: perf.stats, perfReset: () => perf.reset('gpu', 'frame', 'calls') });
/**
 * Adaptive resolution: the scene renders at renderScale × the device pixel ratio (the image is soft by design,
 * so fewer pixels barely show). Once a second: over budget (GPU > GPU_BUDGET ms, or missed frames if there is no GPU timer) → render
 * fewer pixels; clear headroom for a while → climb back toward full resolution.
 */
const GPU_BUDGET = 12;
const MIN_SCALE = 0.5;
/** `?res=0.7` pins the scale (comparing costs, or a player's own choice). */
const pinnedScale = Number(new URLSearchParams(location.search).get('res')) || 0;
let renderScale = pinnedScale || 1;
let adaptedAt = 0;
let calm = 0;
const adaptResolution = (now: number) => {
  if (pinnedScale || now - adaptedAt < 1000) return;
  adaptedAt = now;
  const frame = perf.median('frame') ?? 0;
  const gpu = perf.median('gpu');
  // Fewer pixels only relieve the GPU: with a GPU timer, judge by it alone (a busy CPU or a throttled tab
  // also misses frames); without one, missed frames are all there is to go on.
  const busy = gpu === undefined ? frame > 18.5 : gpu > GPU_BUDGET;
  // Room to climb: one step up (×1.1 per axis, ×1.21 pixels) would still fit with a margin.
  calm = !busy && (gpu === undefined ? frame < 17.4 : gpu * 1.21 < GPU_BUDGET * 0.9) ? calm + 1 : 0;
  const next = busy ? Math.max(MIN_SCALE, renderScale * 0.85) : calm >= (gpu === undefined ? 5 : 2) ? Math.min(1, renderScale * 1.1) : renderScale;
  if (next === renderScale) return;
  renderScale = next;
  calm = 0;
  perf.reset('frame', 'gpu');
  resize();
};
const resize = () => {
  const pixelRatio = Math.min(devicePixelRatio, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  post.setSize(innerWidth, innerHeight, pixelRatio * renderScale);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
};
addEventListener('resize', resize);
resize();

const pool = createPool();
pool.bake(renderer);
const plankton = createPlankton(camera);
const giants = createGiants();
const nutrientLayer = createNutrients();
/** Our own cell's last impact (bump, bite, wound): a short camera shake, and a buzz on phones. */
let selfId = '';
/** What our body was doing last frame (ripple triggers). */
const rippleWatch: { player?: Player; dash: number; fast: number; stream: number } = { dash: 0, fast: 0, stream: 0 };
const flowNow = { x: 0, y: 0 };
/** u/s: the currents peak near 60; above this one is a stream worth a ripple when swum into. */
const STRONG_CURRENT = 38;
let bump = 0;
let lastBuzz = 0;
const ripples = createRipples();
const feast = createFeast();
/** Motes streaming into our body: `energy` and `dna` gained from a disc of radius `r` at (x, y) (prey, a DNA packet). */
const feed = (x: number, y: number, r: number, energy: number, dna: number, mass: number) => {
  const me = cells.get(selfId)?.at;
  if (!me) return;
  const size = Math.max(10, me.radius * 0.24);
  if (energy > 0) feast.burst(0, x, y, r, Math.round(Math.min(24, Math.max(4, 4 + (24 * energy) / mass))), size);
  if (dna > 0) feast.burst(1, x, y, r, Math.round(Math.min(16, Math.max(3, dna / 6))), size);
  hud.gain(energy, dna);
};
/**
 * A bite out of a seaweed at (x, y): crumbs scatter from it; when it was our bite (our animal's head at the frond), from
 * our mouth, some streaming into our body (user direction: a visual feedback for the bitten macroalgae).
 */
const crumbs = (x: number, y: number) => {
  const me = cells.get(selfId)?.at;
  if (me && Math.hypot(x - me.x, y - me.y) < me.radius + 750) { // a frond reaches ~650 from its centre
    const hx = me.x + Math.cos(me.heading) * me.radius;
    const hy = me.y + Math.sin(me.heading) * me.radius;
    const size = me.radius * 0.1;
    feast.burst(2, hx, hy, me.radius * 0.3, 10, size, me.radius * 0.9);
    feast.burst(2, hx, hy, me.radius * 0.2, 6, size);
  } else feast.burst(2, x, y, 300, 10, 70, 600);
};
/** A ripple around our own body; small ones are rate-limited so a busy moment doesn't become a blur. */
let lastRipple = 0;
const ripple = (strength: number) => {
  const at = cells.get(selfId)?.at;
  const now = performance.now();
  if (!at || (strength < 0.7 && now - lastRipple < 300)) return;
  lastRipple = now;
  ripples.add(at.x, at.y, at.radius, strength, now / 1000);
};
const cells = createCells(scene, (id, strength) => {
  if (id !== selfId) return;
  bump = Math.max(bump, strength);
  if (strength > 0.3) ripple(0.35 + 0.6 * strength); // a real bump, a bite, a wound
  if (performance.now() - lastBuzz > 150) {
    lastBuzz = performance.now();
    navigator.vibrate?.(Math.round(15 + 35 * strength));
  }
});
const editor = createEditor(renderer, document.getElementById('editor')!);
const ending = createEnding(document.getElementById('ending')!, (d) => editor.portrait(d));
/** Every species played this session, generation by generation: the end screen's evolution tree. */
const session = createHistory();
const cloudLayer = createClouds();
const meteor = createMeteor();
// Dev: ?off=floor,haze,rim,plankton,nutrients hides a layer at load; `layers.rim.visible = false` from the console
// does it live (perf attribution, see perf.ts).
const layers = {
  floor: pool.far[0]!, haze: pool.far[1]!, rim: pool.objects[0]!, plankton: plankton.objects[0]!, dust: plankton.objects[1]!,
  nutrients: nutrientLayer.objects[0]!,
};
for (const [name, object] of Object.entries(layers)) if (off.has(name)) object.visible = false;
if (import.meta.env.DEV) Object.assign(window, { layers, bloom: post.bloom, nutrientLayer, cloudLayer, camera });
post.far.add(...pool.far, ...giants.objects);
scene.add(...pool.objects, ...plankton.objects, ...nutrientLayer.objects, ...cloudLayer.objects, ...meteor.objects, ...ripples.objects, ...feast.objects);
/** Camera height the intro starts from; the usual follow zoom then glides down to the hatching cell. */
const INTRO_HEIGHT = 1800;
let introPlayed = false;

// Steering: pointer offset from the screen centre (where your cell is drawn).
// Full throttle at a quarter of the short screen side; `clampSteer` caps anything beyond.
const pointer = { x: 0, y: 0 };
addEventListener('pointermove', (e) => {
  pointer.x = e.clientX - innerWidth / 2;
  pointer.y = innerHeight / 2 - e.clientY;
});
const throttleScale = () => Math.min(innerWidth, innerHeight) / 4;

// Actions: hold left click to secrete toxins; right click or Shift to sporulate. A press also
// latches until the next input is sent, so a quick tap between two frames is never lost.
const held = { toxin: false, sporeButton: false, sporeKey: false };
let latched = 0;
addEventListener('pointerdown', (e) => {
  if (e.button === 0) { held.toxin = true; latched |= ACTION_TOXIN; }
  if (e.button === 2) { held.sporeButton = true; latched |= ACTION_SPORE; }
});
addEventListener('pointerup', (e) => {
  if (e.button === 0) held.toxin = false;
  if (e.button === 2) held.sporeButton = false;
});
addEventListener('keydown', (e) => {
  if (e.key === 'Shift') { held.sporeKey = true; latched |= ACTION_SPORE; }
});
addEventListener('keyup', (e) => { if (e.key === 'Shift') held.sporeKey = false; });
addEventListener('blur', () => { held.toxin = held.sporeButton = held.sporeKey = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
const takeActions = () => {
  const bits = latched | (held.toxin ? ACTION_TOXIN : 0) | (held.sporeButton || held.sporeKey ? ACTION_SPORE : 0);
  latched = 0;
  return bits;
};

let fps = 0; // dev readout, exponential moving average
const say = (text: string) => hud.toast(text);
/** Library last seen on our lineage, to announce parts unlocked by gene transfer. */
let knownLibrary = -1;
let knownLineage: Lineage | undefined;
/** The dividing individual the editor was opened for (one design per cyst). */
let designedFor: Player | undefined;
/** The individual whose editor backdrop was taken (once per opening). */
let backdropFor: Player | undefined;
/** When our species evolved (the slice's ending: zoom out, then the species card), or 0. */
/** Our species' tier as last seen: a rise is the stage-up moment. */
let knownTier = 0;
let knownGeneration = 0;
const STAGEUP_MS = 4500;
/** Camera height × per tier: plankton and animals see more of the pool around them. */
const TIER_ZOOM = [1, 1, 1, 1.45, 1.8];
let stageupUntil = 0;
let pendingStageUp: Lineage | undefined;
/** The species whose win (walking onto land) was shown. */
let wonBy: Lineage | undefined;
/** A predicted timer, on (its value) or off (0): smoothing leaves it hovering around 0 after it runs out. */
const on = (v: number) => (v > 0.02 ? v : 0);

/** A shared card link opens the card alone; Play drops the fragment and starts the game. */
const sharedCard = location.hash.startsWith('#card=') ? decodeCard(location.hash.slice('#card='.length)) : undefined;
if (sharedCard) {
  hud.message('');
  showCard(cardScreen, sharedCard, { label: 'Play Panspermia', action: () => {
    history.replaceState(null, '', location.pathname);
    location.reload();
  } });
  await new Promise(() => {}); // park: a card viewer never joins a room
}

/** Dev: a whole session made up from the bot species — two species that died out, then one that climbs every phase. */
function demoSession(fate: 'evolved' | 'extinct') {
  const h = createHistory();
  const design = (bot: string, name: string, generation: number): CardData => {
    const s = BOT_SPECIES.find((b) => b.name === bot)!;
    const cat = catalogFor(s.tier);
    return { name, hue: (generation * 0.13) % 1, tier: s.tier, shape: s.shape, parts: cat.defaultParts(cat.genomeOf(s.genes)), plan: s.plan ?? 0,
      radii: [...(s.radii ?? DEFAULT_RADII)], generation, dna: 0, kills: 0, fate: 'living' };
  };
  const found = (d: CardData, gene: string) => h.unlock({
    gene: catalogFor(d.tier).GENES[gene]!.label,
    icon: editor.partIcon(new LineageState({ name: d.name, tier: d.tier, hue: d.hue, shape: d.shape, plan: d.plan, radii: d.radii, genome: 0, library: 0, dna: 0, lifetimeDna: 0, children: 0 }), gene),
  });
  h.begin(design('Nudus errans', 'Primus infelix', 1));
  h.death();
  h.end('extinct');
  h.begin(design('Pilus repens', 'Secundus audax', 1));
  h.track(design('Pilus repens', 'Secundus audax', 2));
  h.track(design('Ciliata lenta', 'Secundus audax', 3));
  h.death();
  h.death();
  h.end('extinct');
  const steps: [string, number, number, string?][] = [ // bot design, generations, deaths, part found
    ['Nudus errans', 2, 1], ['Pilus repens', 2, 0, 'flagellum'], ['Vibrio celer', 3, 1, 'chemoreceptor'], ['Necrophagus', 1, 0],
    ['Ciliata lenta', 2, 2, 'jaw'], ['Amoebina vorax', 2, 0], ['Didinia ferox', 1, 1, 'spike'],
    ['Daphnia errans', 2, 1, 'mandibles'], ['Rotifera rapax', 1, 0], ['Cyclops furax', 2, 4],
    ...(fate === 'evolved' ? [['Gammarus pulex', 2, 0, 'claw'], ['Astacus fluviatilis', 1, 1]] as [string, number, number, string?][] : []),
  ];
  let g = 1;
  let last: CardData | undefined;
  for (const [bot, gens, deaths, gene] of steps) {
    for (let k = 0; k < gens; k++) {
      last = design(bot, 'Demonstrata victrix', g++);
      if (g === 2) h.begin(last);
      else h.track(last);
    }
    for (let k = 0; k < deaths; k++) h.death();
    if (gene && last && gene in catalogFor(last.tier).GENES) found(last, gene);
  }
  h.end(fate);
  return { runs: h.runs, final: { ...last!, dna: fate === 'evolved' ? 14820 : 5310, kills: 37, fate } as CardData };
}

const partsOf = (l: Lineage) => [...l.parts].map((part) => ({ ...part.toJSON(), gene: catalogFor(l.tier).NAMES[part.gene]! }));
const cardOf = (l: Lineage, fate: CardData['fate']): CardData => ({
  name: l.name, hue: l.hue, parts: partsOf(l), generation: l.generation, dna: Math.round(l.lifetimeDna), kills: l.kills, fate,
  tier: l.tier, shape: l.shape, ...(l.sx > 0 ? { form: formOf(l) } : {}), ...(l.bends.length ? { bends: [...l.bends] } : {}),
  ...(l.arms ? { arms: l.arms } : {}), plan: l.plan, radii: [...l.radii],
});

try {
  const room = await new Client(endpoint).joinOrCreate(ROOM_NAME, {}, PoolState);
  selfId = room.sessionId;
  hud.message('');
  room.onLeave(() => hud.message('Disconnected'));
  // We killed or swallowed something: its energy and DNA stream into us.
  room.onMessage('feast', (f: { x: number; y: number; r: number; energy: number; dna: number }) =>
    feed(f.x, f.y, f.r * 0.6, f.energy, f.dna, room.state.players.get(room.sessionId)?.mass ?? 1));
  room.onMessage('died', ({ cause, killer, extinct }: { cause: string; killer?: string; extinct: boolean }) => {
    const how = { starvation: 'You starved', phage: 'Phages burst you open', virus: 'A giant virus burst you open' }[cause]
      ?? `Lysed by ${killer}`;
    session.death();
    if (!extinct) return say(`${how}. Your next child takes over…`);
    say(`${how}. No children were left: your species is extinct.`);
    setTimeout(() => showEnd('extinct'), 1600);
  });
  /** Spore's stage-up: the title card while the camera zooms out to the bigger body (the follow zoom does it). */
  const stageUp = (l: Lineage) => {
    const subtitle = document.createElement('small');
    subtitle.textContent = [
      '', '', 'Engulf smaller cells with a jaw, graze algae with a filter mouth. Bacteria are food now.',
      'Sweep up bacteria and algae with filter combs, bite with mandibles. Single cells are food now.',
      'Walk on legs or glide on a foot, crush with claws or a beak, armour up in chitin or a shell. Small animals are food now.',
    ][l.tier] ?? '';
    stageup.replaceChildren(`${l.name} evolved into ${['', '', 'eukaryotes', 'plankton', 'animals'][l.tier]}`, subtitle);
    stageup.classList.add('on');
    stageupUntil = performance.now() + STAGEUP_MS;
  };
  const newSpecies = () => room.send('newSpecies');
  /** Dev: the next end screen shows a made-up session (L, Shift+L) instead of this one. */
  let demo: ReturnType<typeof demoSession> | undefined;
  /** The end of the game: the session's tree (this species' last design and fate recorded first), the Hall of Fame. */
  const showEnd = (fate: 'evolved' | 'extinct') => {
    const l = room.state.lineages.get(room.sessionId);
    if (!l || ending.isOpen) return;
    const final = cardOf(l, fate);
    session.track(final);
    session.end(fate);
    const shown = demo ?? { runs: session.runs, final };
    demo = undefined;
    ending.show(shown.runs, { ...shown.final, fate }, newSpecies);
    if (fate === 'extinct') room.send('hallRequest'); // the winner's lists come with its landing
  };
  // The Hall of Fame (today, all-time): on landing, with our ranks; on extinction, on request.
  room.onMessage('hall', (h: HallLists) => ending.hall(h));
  room.onMessage('designRefused', (reason: string) => (editor.isOpen ? editor.refused(reason) : say(`Design refused: ${reason}`)));

  /** A player's cell wears its species design (unless dev cheats changed its genes); bots get the default layout. */
  const lookOf = (id: string, p: Player): Look => {
    const l = room.state.lineages.get(isMate(id) ? id.slice(MATE_PREFIX.length) : id); // a mate looks like its species
    const genome = ownGenome(p);
    const cat = catalogFor(p.tier);
    // The species design, unless this individual differs (dev cheats) or has no lineage (bots).
    const parts = l && l.tier === p.tier && l.genome === genome ? partsOf(l) : cat.defaultParts(genome);
    const bot = !l && isAnimal(p.tier) ? BOT_SPECIES.find((s) => s.tier === p.tier && s.name === p.name) : undefined; // bots: their species' body
    const segments = l && isAnimal(p.tier) && l.tier === p.tier && l.radii.length ? segmentsOf(l.plan, [...l.radii], [...l.bends], l.arms)
      : bot?.radii ? segmentsOf(bot.plan ?? 0, bot.radii) : undefined;
    const plan = l && l.tier === p.tier ? l.plan : bot?.plan;
    return { tier: p.tier, genome, parts, hue: l?.hue ?? hashId(id), shape: l ? formOf(l) : p.shape, segments, plan };
  };

  const input = room.input({ type: Input, mode: 'reliable' });
  const predict = Predict.get(room, { mode: 'lerp', delay: 100 });
  predict.attachAll('players', { x: 'lerp', y: 'lerp' });
  predict.attachAll('players', { heading: { mode: 'lerp', angle: true } }); // angles lerp the short way round

  // Own cell: predicted locally, reconciled against the server. Death replaces the
  // Player instance, so rebind whenever our entry is (re)added.
  const callbacks = Callbacks.get<PoolState>(room);
  callbacks.onAdd('nutrients', (n, id) => {
    nutrientLayer.add(id, n);
    if (n.kind !== NutrientKind.macroalga && n.kind !== NutrientKind.wallAlga) return;
    callbacks.listen(n, 'bites', (bites, before) => {
      const at = bites > (before ?? 0) && nutrientLayer.packets.get(id);
      if (at) crumbs(at.x, at.y);
    });
  });
  callbacks.onRemove('nutrients', (_, id) => {
    const at = nutrientLayer.remove(id);
    if (at && (at.kind === NutrientKind.macroalga || at.kind === NutrientKind.wallAlga)) crumbs(at.x, at.y); // the last bite
    if (at) cells.gulp(at.x, at.y, performance.now() / 1000); // the cell that took it up dimples in
    // A DNA packet gone at our body's edge was ours: its DNA streams in. (The server doesn't say who took it.)
    const me = cells.get(room.sessionId)?.at;
    const self = room.state.players.get(room.sessionId);
    if (at && isDna(at.kind) && me && self && !isAnimal(self.tier) && Math.hypot(at.x - me.x, at.y - me.y) < me.radius * 1.6) { // animals take no loose DNA
      feed(at.x, at.y, me.radius * 0.1, 0, at.kind === NutrientKind.fragment ? PACKET_DNA : PLASMID_DNA, 1);
    }
  });
  callbacks.onAdd('clouds', (c, id) => cloudLayer.add(id, c));
  callbacks.onRemove('clouds', (_, id) => cloudLayer.remove(id));

  let me: Reconciler | undefined;
  callbacks.onAdd('players', (player, id) => {
    if (id !== room.sessionId) return;
    if (!introPlayed) {
      introPlayed = true;
      meteor.start();
      camera.position.z = INTRO_HEIGHT;
    }
    me?.dispose();
    me = predict.reconciler(player, {
      input,
      fields: ['x', 'y', 'heading', 'tumble', 'rng', 'spore', 'sporeCooldown', 'dash', 'dashCooldown', 'vx', 'vy', 'aim'],
      // Mass, genome and the sim clock are server-driven; replay reads their latest values and
      // smoothing absorbs the tiny resulting drift (currents change slowly).
      step: (ctx, state, cmd) =>
        stepCell(state, player.mass, player.genome, cmd.dirX, cmd.dirY, cmd.actions, ctx.dt, room.state.tick * TICK_DT,
          player.tier, player.genome2, player.genome3, player.genome4),
      warnOnDivergence: import.meta.env.DEV ? 1 : undefined, // console warning if client and server sims drift apart
    });
  });

  if (import.meta.env.DEV) {
    // Dev cheats (server must run with --dev, else it kicks us): these keys toggle genes in catalog
    // order; P drops a plasmid, V a phage, onto the cell; G grows to the cap, K kills the cell, N grants DNA.
    const DEV_KEYS = '1234567890-=[';
    addEventListener('keydown', (e) => {
      const index = DEV_KEYS.indexOf(e.key); // into the cell's own tier catalog
      if (index >= 0) room.send('dev:toggleGene', index);
      if (e.key === 'p') room.send('dev:spawn', 'plasmid');
      if (e.key === 'v') room.send('dev:spawn', 'phage');
      if (e.key === 'g') room.send('dev:grow');
      if (e.key === 'u') room.send('dev:unlock');
      if (e.key === 'b') room.send('dev:visitors');
      if (e.key === 'k') room.send('dev:die');
      if (e.key === 'n') room.send('dev:dna');
      // L: walk onto land now (the end screen with a full made-up session); Shift+L: the same, extinct.
      if (e.key.toLowerCase() === 'l' && !e.shiftKey) {
        demo = demoSession('evolved');
        room.send('dev:land');
      }
      if (e.key.toLowerCase() === 'l' && e.shiftKey) {
        demo = demoSession('extinct');
        showEnd('extinct');
      }
    });
  }

  let last = performance.now();
  let lastTick = -1;
  let tickArrivedAt = 0;
  let suckedAt = 0;
  const tickClock = createTickClock();
  const trails = createTrails(); // remote cells, played back by tick
  renderer.setAnimationLoop((now) => {
    perf.begin();
    // Send the due inputs before reading any predicted value (see Predict.tick).
    for (let due = predict.tick(now); due > 0; due--) {
      // The hatchling waits for the intro; a dividing cell can't act (the server ignores it too).
      const own = room.state.players.get(room.sessionId);
      const steer = meteor.active || (own?.cyst ?? 0) > 0 || (own?.cocoon ?? 0) > 0 ? 0 : 1;
      input.data.dirX = (pointer.x / throttleScale()) * steer;
      input.data.dirY = (pointer.y / throttleScale()) * steer;
      input.data.actions = takeActions() * steer;
      sanitizeInput(input.data); // same sanitizer as the server, so prediction replays the real command
      input.send();
    }

    const time = now / 1000;
    const dt = Math.min((now - last) / 1000, 0.1); // clamp after tab switches
    last = now;
    if (dt > 0) fps += (1 / dt - fps) * 0.05;
    if (dt > 0 && dt < 0.1) perf.sample('frame', dt * 1000); // not the long gaps of a hidden tab
    adaptResolution(now);
    const { players, seeps, tick } = room.state;
    if (tick !== lastTick) {
      lastTick = tick;
      tickArrivedAt = now;
      trails.record(players.values(), tick);
    }
    const clock = tickClock(tick, (now - tickArrivedAt) / 1000, dt); // smooth sim time for packets and remote cells

    const own = room.state.lineages.get(room.sessionId);
    if (own?.evolved && wonBy !== own) { // our animals walked onto land: the game is won (title, then the species card)
      wonBy = own;
      const subtitle = document.createElement('small');
      subtitle.textContent = 'Lungs and legs: a new world awaits. You won!';
      stageup.replaceChildren(`${own.name} walked onto land`, subtitle);
      stageup.classList.add('on');
      stageupUntil = performance.now() + STAGEUP_MS;
      setTimeout(() => showEnd('evolved'), STAGEUP_MS);
    }
    const seenH = camera.position.z * Math.tan((camera.fov * Math.PI) / 360); // last frame's view of the plane
    const ownCell = players.get(room.sessionId);
    cells.update(players, time, dt, (p) => ({
      ...(p === ownCell ? { x: predict.value(p, 'x'), y: predict.value(p, 'y'), heading: predict.value(p, 'heading') } : trails.pose(p, clock)),
      // Timers read as on/off: the prediction's output smoothing extrapolates them past 0 (a tiny negative spore hid every
      // part for up to a minute after a spore or a tun — user report), so near-zero is off.
      tumble: predict.value(p, 'tumble'), spore: on(predict.value(p, 'spore')), cyst: p.cyst, dash: on(predict.value(p, 'dash')), call: p.call, cocoon: p.cocoon,
      suck: p.sucking ? 1 : 0,
    }), lookOf, { x: camera.position.x, y: camera.position.y, halfW: seenH * camera.aspect * 1.2, halfH: seenH * 1.2 });
    perf.mark('cells');
    const self = players.get(room.sessionId);
    const selfView = cells.get(room.sessionId);
    const selfMesh = selfView?.body;
    if (self && selfMesh) {
      // Follow the cell; zoom out as it grows.
      // Eyes let a eukaryote or bigger see further: the camera pulls back.
      const own = catalogFor(self.tier);
      const sight = (1 + EYE_SIGHT * stack('eye' in own.GENES ? own.copiesOf(ownGenome(self), 'eye') : 0))
        * (1 + ANTENNA_SIGHT * stack(self.tier === 4 ? TIER4.copiesOf(self.genome4, 'antennae') : 0)); // antennae sense further
      // bacterium: spawn ≈ 290, cap ≈ 620; eukaryote ≈ 930–1970; plankton ≈ 3680–6410; animal ≈ 8980–10330
      // (TIER_ZOOM: the big bodies filled the screen — user, 2026-10-19 — now about a eukaryote's share of it)
      const r = radiusOf(self.mass, self.tier);
      const targetZ = (140 + 12 * Math.min(r, 126) + 5 * Math.max(0, Math.min(r, 680) - 126) + 3 * Math.max(0, r - 680)) * sight
        * (TIER_ZOOM[self.tier] ?? 1);
      const at = selfView!.at; // the cell's centre (an animal's quad is offset to fit its body)
      camera.position.set(at.x, at.y, camera.position.z + (targetZ - camera.position.z) * 0.05);
      // Bloom fades out as the camera rises: from an animal's height, piles of small additive lights (a plume of food,
      // toxin rings, shards) bloomed into big white glows popping in and out (user report, polish).
      const high = Math.min(1, Math.max(0, (camera.position.z - 900) / 2100));
      post.bloom.strength = 0.25 * (1 - 0.85 * high * high * (3 - 2 * high));
      // Ripples at key moments: a new individual (hatching, emerging), a dash or a spore starting, hard
      // acceleration, swimming into a strong current.
      const w = rippleWatch;
      const dash = predict.value(self, 'dash') + predict.value(self, 'spore');
      const fast = Math.hypot(self.vx, self.vy) / speedOf(self.mass, self.tier);
      currentAt(at.x, at.y, room.state.tick * TICK_DT, flowNow);
      const stream = Math.hypot(flowNow.x, flowNow.y);
      if (w.player && w.player !== self) {
        ripple(1);
        // A cell that divided (the next individual took over where it was, same tier): show the mitosis.
        if (self.tier <= 2 && w.player.tier === self.tier && Math.hypot(w.player.x - self.x, w.player.y - self.y) < 4 * r) {
          cells.divide(lookOf(room.sessionId, self), at.x, at.y, predict.value(self, 'heading'), r);
        }
      }
      else if (dash > 0 && w.dash === 0) ripple(0.8);
      else if (fast > 0.75 && w.fast <= 0.75) ripple(0.4);
      else if (stream > STRONG_CURRENT && w.stream <= STRONG_CURRENT) ripple(0.5);
      Object.assign(w, { player: self, dash, fast, stream });
      // Draining a host: energy droplets well up where we hold on to it and stream into our body.
      if (self.sucking && time - suckedAt > 0.15) {
        suckedAt = time;
        let host: { x: number; y: number; radius: number } | undefined;
        let gap = Infinity;
        for (const [id] of players) {
          const v = id === room.sessionId ? undefined : cells.get(id)?.at;
          const g = v ? Math.hypot(v.x - at.x, v.y - at.y) - v.radius : Infinity;
          if (g < gap) [gap, host] = [g, v];
        }
        if (host) {
          const a = Math.atan2(host.y - at.y, host.x - at.x);
          feast.burst(0, at.x + Math.cos(a) * at.radius * 1.1, at.y + Math.sin(a) * at.radius * 1.1, at.radius * 0.15, 2, Math.max(8, at.radius * 0.12));
        }
      }
    }
    // Every frame, cell or not: an intro cut short by death or extinction must still play out, not freeze.
    const impact = selfView?.at ?? camera.position;
    const { hatch, shake } = meteor.update(dt, time, camera.position.z, impact.x, impact.y);
    selfView?.grow(hatch);
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    const jolt = bump * camera.position.z * 0.012;
    camera.position.x += (Math.random() - 0.5) * jolt;
    camera.position.y += (Math.random() - 0.5) * jolt;
    bump *= Math.exp(-dt * 9);
    if (self && selfMesh) {
      const lineage = room.state.lineages.get(room.sessionId)!;
      if (lineage !== knownLineage) { // a new species
        [knownLineage, knownLibrary] = [lineage, lineage.library];
        session.begin(cardOf(lineage, 'living'));
      } else if (lineage.generation !== knownGeneration || lineage.tier !== knownTier) session.track(cardOf(lineage, 'living'));
      knownGeneration = lineage.generation;
      const cat = catalogFor(lineage.tier);
      if (lineage.tier !== knownTier) { // a new species, or a stage-up: the library starts over
        if (knownTier && lineage.tier > knownTier) pendingStageUp = lineage; // its title plays once the editor is done
        knownTier = lineage.tier;
        knownLibrary = lineage.library;
      }
      const found = cat.NAMES.filter((name) => hasBit(lineage.library, cat.GENES[name]!.bit) && !hasBit(knownLibrary, cat.GENES[name]!.bit));
      if (found.length) {
        for (const g of found) {
          const icon = editor.partIcon(lineage, g);
          hud.unlock(cat.GENES[g]!.label, icon);
          session.unlock({ gene: cat.GENES[g]!.label, icon });
        }
      }
      knownLibrary = lineage.library;
      if (self.cyst === 0) designedFor = undefined; // an animal stays the same individual: it may mate again
      // Evolving: the new tier's editor first, then the stage-up title as the first individual hatches.
      if (pendingStageUp && !self.evolving && self.cyst === 0) {
        stageUp(pendingStageUp);
        pendingStageUp = undefined;
      }
      if (self.cyst > 0 && designedFor !== self) {
        designedFor = self;
        editor.open(lineage, (design, final) => room.send(final ? 'design' : 'draft', design), self.evolving);
      }
      // The HUD: gauges, children, ability chips, one status line (hidden behind the editor).
      const own = ownGenome(self);
      const recharge = (left: number, full: number) => 1 - Math.min(1, left / full);
      const toxins = TOXINS.filter((t) => t.tier === self.tier && t.gene !== 'inkSac' && cat.hasGene(own, t.gene));
      const abilities: Ability[] = [];
      if (toxins.length) {
        abilities.push({ id: 'toxin', icon: '☣', label: self.tier === 2 ? 'Poison' : 'Toxins', hint: 'L-click',
          ready: recharge(self.toxinCooldown, Math.max(...toxins.map((t) => t.cooldown))), active: false });
      }
      if (self.tier === 1 && hasGene(self.genome, 'endospore')) {
        abilities.push({ id: 'spore', icon: '◎', label: 'Endospore', hint: 'R-click', ready: recharge(self.sporeCooldown, ENDOSPORE_COOLDOWN), active: self.spore > 0 });
      }
      if (self.tier === 3 && TIER3.hasGene(self.genome3, 'tun')) {
        abilities.push({ id: 'tun', icon: '⬮', label: 'Tun', hint: 'R-click', ready: recharge(self.sporeCooldown, TUN_COOLDOWN), active: self.spore > 0 });
      }
      if (self.tier === 2 && TIER2.hasGene(self.genome2, 'jet')) {
        abilities.push({ id: 'jet', icon: '➤', label: 'Jet', hint: 'R-click', ready: recharge(self.dashCooldown, JET_COOLDOWN), active: self.dash > 0 });
      }
      if (self.tier === 4 && TIER4.hasGene(self.genome4, 'inkSac')) {
        abilities.push({ id: 'ink', icon: '●', label: 'Ink', hint: 'R-click', ready: recharge(self.dashCooldown, INK_COOLDOWN), active: self.dash > 0 });
      }
      const status = self.cyst > 0
        ? (self.evolving ? `Evolved — design your first ${TIER_NAMES[lineage.tier]!.toLowerCase()}` : 'Designing the next generation')
        : self.call > 0 ? 'Calling a mate…'
        : self.cocoon > 0 ? `${self.tier === 3 ? 'Eggs hatching' : 'Metamorphosis — emerging'} in ${Math.ceil(self.cocoon)} s`
        : self.spore > 0 ? (self.tier === 3 ? 'Tun: dried out and shielded' : 'Dormant spore')
        : self.infection > 0 ? 'Infected!' : '';
      const floor = minMassOf(self.tier);
      hud.update(editor.isOpen ? undefined : {
        name: lineage.name, generation: lineage.generation, tier: lineage.tier,
        energy: Math.max(0, Math.min(1, (self.mass - floor) / (massCapOf(self.tier) - floor))),
        dna: lineage.dna, evolve: lineage.evolved ? undefined : Math.min(1, lineage.lifetimeDna / evolveDnaOf(lineage.tier)),
        children: lineage.children, abilities, status, health: self.health / healthMaxOf(self.genome, self.tier),
      });
      if (import.meta.env.DEV) hud.perf(`${Math.round(fps)} fps · ${perf.text()} · ${Math.round(renderScale * 100)}% res · ${players.size} cells`);
    } else hud.update(undefined); // extinct or evolved: no cell to report on

    if (stageupUntil && now > stageupUntil) {
      stageupUntil = 0;
      stageup.classList.remove('on');
    }

    labels.update(players, room.sessionId, camera, (id) => {
      const at = cells.get(id)?.at; // where it was drawn (an animal's quad is bigger than its body)
      return at && { x: at.x, y: at.y, r: at.radius };
    }, !editor.isOpen && !meteor.active);
    labels.leaderboard(players, room.sessionId, !editor.isOpen);

    perf.mark('hud');
    const focus = camera.position.z; // distance to the gameplay plane
    pool.update(time);
    giants.update(time, dt, camera.position);
    perf.mark('pool');
    plankton.update(time, dt, focus);
    perf.mark('plankton');
    const halfH = focus * Math.tan((camera.fov * Math.PI) / 360); // the view on the gameplay plane
    nutrientLayer.update(clock, seeps, time, focus,
      { x: camera.position.x, y: camera.position.y, halfW: halfH * camera.aspect, halfH });
    perf.mark('nutrients');
    cloudLayer.update(clock, time, focus);
    ripples.update(time, focus);
    feast.update(dt, time, focus, cells.get(room.sessionId)?.at);
    perf.mark('clouds');
    perf.gpuBegin();
    // The editor stays up for exactly one division: until this individual hatches (or dies).
    if (editor.isOpen && (!self || self !== designedFor || self.cyst === 0)) editor.close();
    if (ending.covering) { /* nothing to draw */ } else if (editor.isOpen) {
      if (backdropFor !== designedFor) { // the editor just opened: its backdrop is this pond, blurred
        backdropFor = designedFor;
        post.render();
        editor.backdrop(renderer.domElement);
      }
      const view = editor.frame(time, dt, self!.cyst, innerWidth / innerHeight);
      post.render(view.scene, view.camera);
    } else post.render();
    perf.gpuEnd();
    perf.mark('render');
  });
} catch (err) {
  hud.message(`Cannot reach server at ${endpoint}`);
  console.error(err);
}
