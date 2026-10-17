import { Callbacks, Client, Predict, type Reconciler } from '@colyseus/sdk';
import {
  ACTION_SPORE, ACTION_TOXIN, Input, type Lineage, type Player, PoolState, ROOM_NAME, SERVER_PORT,
  BOT_SPECIES, EYE_SIGHT, MATE_PREFIX, TICK_DT, TICK_RATE, TIER2, TOXINS, isAnimal, isMate, ownGenome, segmentsOf, catalogFor, hasGene, stack, healthMaxOf, radiusOf, sanitizeInput, stepCell,
} from '@panspermia/shared';
import * as THREE from 'three';
import { type CardData, decodeCard, showCard } from './card.ts';
import { createEditor } from './editor.ts';
import { createLabels } from './labels.ts';
import { type Look, createCells, hashId } from './scene/cells.ts';
import { createClouds } from './scene/clouds.ts';
import { createEggs } from './scene/eggs.ts';
import { createMeteor } from './scene/meteor.ts';
import { createNutrients } from './scene/nutrients.ts';
import { createGiants } from './scene/giants.ts';
import { createPlankton } from './scene/plankton.ts';
import { createPool } from './scene/pool.ts';
import { createPost } from './scene/post.ts';
import { createPerf, off } from './perf.ts';

const hud = document.getElementById('hud')!;
const extinctScreen = document.getElementById('extinct')!;
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
const camera = new THREE.PerspectiveCamera(50, 1, 10, 14000); // far: a grown animal's camera over the pond floor
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
let bump = 0;
let lastBuzz = 0;
const cells = createCells(scene, (id, strength) => {
  if (id !== selfId) return;
  bump = Math.max(bump, strength);
  if (performance.now() - lastBuzz > 150) {
    lastBuzz = performance.now();
    navigator.vibrate?.(Math.round(15 + 35 * strength));
  }
});
const editor = createEditor(renderer, document.getElementById('editor')!);
const cloudLayer = createClouds();
const eggLayer = createEggs();
const meteor = createMeteor();
// Dev: ?off=floor,haze,rim,plankton,nutrients hides a layer at load; `layers.rim.visible = false` from the console
// does it live (perf attribution, see perf.ts).
const layers = {
  floor: pool.far[0]!, haze: pool.far[1]!, rim: pool.objects[0]!, plankton: plankton.objects[0]!, dust: plankton.objects[1]!,
  nutrients: nutrientLayer.objects[0]!,
};
for (const [name, object] of Object.entries(layers)) if (off.has(name)) object.visible = false;
if (import.meta.env.DEV) Object.assign(window, { layers, bloom: post.bloom, nutrientLayer });
post.far.add(...pool.far, ...giants.objects);
scene.add(...pool.objects, ...plankton.objects, ...nutrientLayer.objects, ...cloudLayer.objects, ...eggLayer.objects, ...meteor.objects);
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

let notice = '';
let fps = 0; // dev readout, exponential moving average
let noticeUntil = 0;
const say = (text: string) => {
  notice = text;
  noticeUntil = performance.now() + 4000;
};
/** Library last seen on our lineage, to announce parts unlocked by gene transfer. */
let knownLibrary = -1;
let knownLineage: Lineage | undefined;
/** The dividing individual the editor was opened for (one design per cyst). */
let designedFor: Player | undefined;
/** When our species evolved (the slice's ending: zoom out, then the species card), or 0. */
/** Our species' tier as last seen: a rise is the stage-up moment. */
let knownTier = 0;
const STAGEUP_MS = 4500;
let stageupUntil = 0;
let pendingStageUp: Lineage | undefined;

/** A shared card link opens the card alone; Play drops the fragment and starts the game. */
const sharedCard = location.hash.startsWith('#card=') ? decodeCard(location.hash.slice('#card='.length)) : undefined;
if (sharedCard) {
  hud.textContent = '';
  showCard(cardScreen, sharedCard, { label: 'Play Panspermia', action: () => {
    history.replaceState(null, '', location.pathname);
    location.reload();
  } });
  await new Promise(() => {}); // park: a card viewer never joins a room
}

const partsOf = (l: Lineage) => [...l.parts].map((part) => ({ ...part.toJSON(), gene: catalogFor(l.tier).NAMES[part.gene]! }));
const cardOf = (l: Lineage, fate: CardData['fate']): CardData => ({
  name: l.name, hue: l.hue, parts: partsOf(l), generation: l.generation, dna: Math.round(l.lifetimeDna), kills: l.kills, fate,
  tier: l.tier, shape: l.shape, plan: l.plan, radii: [...l.radii],
});

try {
  const room = await new Client(endpoint).joinOrCreate(ROOM_NAME, {}, PoolState);
  selfId = room.sessionId;
  room.onLeave(() => { hud.textContent = 'Disconnected'; });
  room.onMessage('died', ({ cause, killer, extinct }: { cause: string; killer?: string; extinct: boolean }) => {
    const how = { starvation: 'You starved', phage: 'Phages burst you open', virus: 'A giant virus burst you open' }[cause]
      ?? `Lysed by ${killer}`;
    if (!extinct) return say(`${how}. Your next child takes over…`);
    extinctScreen.querySelector('p')!.textContent = `${how}. No children were left: your species is extinct.`;
    extinctScreen.hidden = false;
    extinctScreen.querySelector('button')!.focus();
  });
  /** Spore's stage-up: the title card while the camera zooms out to the bigger body (the follow zoom does it). */
  const stageUp = (l: Lineage) => {
    const subtitle = document.createElement('small');
    subtitle.textContent = [
      '', '', 'Engulf smaller cells with a jaw, graze algae with a filter mouth. Bacteria are food now.',
      'Sweep up bacteria and algae with filter combs, bite with mandibles. Single cells are food now.',
      'Graze with mouthparts or a radula, crush with claws or a beak. Small animals are food now.',
    ][l.tier] ?? '';
    stageup.replaceChildren(`${l.name} evolved into ${['', '', 'eukaryotes', 'animals', 'arthropods'][l.tier]}`, subtitle);
    stageup.classList.add('on');
    stageupUntil = performance.now() + STAGEUP_MS;
  };
  const newSpecies = () => {
    extinctScreen.hidden = true;
    room.send('newSpecies');
  };
  extinctScreen.querySelector('.found')!.addEventListener('click', newSpecies);
  extinctScreen.querySelector('.show-card')!.addEventListener('click', () => {
    const l = room.state.lineages.get(room.sessionId);
    if (!l) return;
    extinctScreen.hidden = true;
    showCard(cardScreen, cardOf(l, 'extinct'), { label: 'Found a new species', action: newSpecies });
  });
  room.onMessage('designRefused', (reason: string) => (editor.isOpen ? editor.refused(reason) : say(`Design refused: ${reason}`)));

  /** A player's cell wears its species design (unless dev cheats changed its genes); bots get the default layout. */
  const lookOf = (id: string, p: Player): Look => {
    const l = room.state.lineages.get(isMate(id) ? id.slice(MATE_PREFIX.length) : id); // a mate looks like its species
    const genome = ownGenome(p);
    const cat = catalogFor(p.tier);
    // The species design, unless this individual differs (dev cheats) or has no lineage (bots).
    const parts = l && l.tier === p.tier && l.genome === genome ? partsOf(l) : cat.defaultParts(genome);
    const bot = !l && isAnimal(p.tier) ? BOT_SPECIES.find((s) => s.tier === p.tier && s.name === p.name) : undefined; // bots: their species' body
    const segments = l && isAnimal(p.tier) && l.tier === p.tier && l.radii.length ? segmentsOf(l.plan, [...l.radii])
      : bot?.radii ? segmentsOf(bot.plan ?? 0, bot.radii) : undefined;
    return { tier: p.tier, genome, parts, hue: l?.hue ?? hashId(id), shape: p.shape, segments };
  };

  const input = room.input({ type: Input, mode: 'reliable' });
  const predict = Predict.get(room, { mode: 'lerp', delay: 100 });
  predict.attachAll('players', { x: 'lerp', y: 'lerp' });
  predict.attachAll('players', { heading: { mode: 'lerp', angle: true } }); // angles lerp the short way round

  // Own cell: predicted locally, reconciled against the server. Death replaces the
  // Player instance, so rebind whenever our entry is (re)added.
  const callbacks = Callbacks.get<PoolState>(room);
  callbacks.onAdd('nutrients', (n, id) => nutrientLayer.add(id, n));
  callbacks.onRemove('nutrients', (_, id) => {
    const at = nutrientLayer.remove(id);
    if (at) cells.gulp(at.x, at.y, performance.now() / 1000); // the cell that took it up dimples in
  });
  callbacks.onAdd('clouds', (c, id) => cloudLayer.add(id, c));
  callbacks.onRemove('clouds', (_, id) => cloudLayer.remove(id));
  // A clutch that vanishes before its hatching tick was eaten.
  callbacks.onRemove('eggs', (egg) => {
    if (egg.owner === room.sessionId && room.state.tick < egg.hatchTick) say('Your eggs were eaten!');
  });

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
      if (e.key === 'k') room.send('dev:die');
      if (e.key === 'n') room.send('dev:dna');
    });
  }

  let last = performance.now();
  let lastTick = -1;
  let tickArrivedAt = 0;
  renderer.setAnimationLoop((now) => {
    perf.begin();
    // Send the due inputs before reading any predicted value (see Predict.tick).
    for (let due = predict.tick(now); due > 0; due--) {
      // The hatchling waits for the intro; a dividing cell can't act (the server ignores it too).
      const steer = meteor.active || (room.state.players.get(room.sessionId)?.cyst ?? 0) > 0 ? 0 : 1;
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
    }

    const seenH = camera.position.z * Math.tan((camera.fov * Math.PI) / 360); // last frame's view of the plane
    cells.update(players, time, dt, (p) => ({
      x: predict.value(p, 'x'), y: predict.value(p, 'y'), heading: predict.value(p, 'heading'),
      tumble: predict.value(p, 'tumble'), spore: predict.value(p, 'spore'), cyst: p.cyst, dash: predict.value(p, 'dash'), call: p.call,
    }), lookOf, { x: camera.position.x, y: camera.position.y, halfW: seenH * camera.aspect * 1.2, halfH: seenH * 1.2 });
    perf.mark('cells');
    const self = players.get(room.sessionId);
    const selfView = cells.get(room.sessionId);
    const selfMesh = selfView?.body;
    if (self && selfMesh) {
      // Follow the cell; zoom out as it grows.
      // Eyes let a eukaryote or bigger see further: the camera pulls back.
      const own = catalogFor(self.tier);
      const sight = 1 + EYE_SIGHT * stack('eye' in own.GENES ? own.copiesOf(ownGenome(self), 'eye') : 0);
      // bacterium: spawn ≈ 290, cap ≈ 620; eukaryote ≈ 930–1970; animal (gentler: specks still readable) ≈ 2540–4420;
      // arthropod (gentler still: the pool is only so big) ≈ 4990–5740
      const r = radiusOf(self.mass, self.tier);
      const targetZ = (140 + 12 * Math.min(r, 126) + 5 * Math.max(0, Math.min(r, 680) - 126) + 3 * Math.max(0, r - 680)) * sight;
      const at = selfView!.at; // the cell's centre (an animal's quad is offset to fit its body)
      camera.position.set(at.x, at.y, camera.position.z + (targetZ - camera.position.z) * 0.05);
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
      if (lineage !== knownLineage) [knownLineage, knownLibrary] = [lineage, lineage.library]; // a new species
      const cat = catalogFor(lineage.tier);
      if (lineage.tier !== knownTier) { // a new species, or a stage-up: the library starts over
        if (knownTier && lineage.tier > knownTier) pendingStageUp = lineage; // its title plays once the editor is done
        knownTier = lineage.tier;
        knownLibrary = lineage.library;
      }
      if (lineage.library & ~knownLibrary) {
        const found = cat.NAMES.filter((g) => cat.hasGene(lineage.library & ~knownLibrary, g)).map((g) => cat.GENES[g]!.label);
        say(`Part unlocked: ${found.join(', ')}`);
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
      const own = ownGenome(self);
      const genes = cat.NAMES.filter((g) => cat.hasGene(own, g))
        .map((g) => cat.GENES[g]!.label + (cat.copiesOf(own, g) > 1 ? ` ×${cat.copiesOf(own, g)}` : '')).join(', ') || 'no genes';
      const ready = (s: number) => (s > 0 ? `${s.toFixed(1)}s` : 'ready');
      const abilities = [
        self.tier === 1 && TOXINS.some((t) => t.tier === 1 && hasGene(self.genome, t.gene)) ? `toxin ${ready(self.toxinCooldown)}` : '',
        self.tier === 2 && TIER2.hasGene(self.genome2, 'poison') ? `poison ${ready(self.toxinCooldown)}` : '',
        self.tier === 2 && TIER2.hasGene(self.genome2, 'jet') ? (self.dash > 0 ? 'DASH' : `jet ${ready(self.dashCooldown)}`) : '',
        hasGene(self.genome, 'endospore') ? (self.spore > 0 ? 'DORMANT' : `spore ${ready(self.sporeCooldown)}`) : '',
        self.infection > 0 ? `INFECTED ${self.infection.toFixed(1)}s` : '',
        self.cyst > 0 ? (self.evolving ? 'EVOLVING' : isAnimal(self.tier) ? 'MATING' : 'DIVIDING') : '',
        self.call > 0 ? 'CALLING — a mate is coming' : '',
        ...[...room.state.eggs.values()].filter((e) => e.owner === room.sessionId)
          .map((e) => `eggs hatch in ${Math.ceil((e.hatchTick - room.state.tick) / TICK_RATE)}s`),
      ].filter(Boolean).join(' · ');
      hud.textContent = `${lineage.name} · energy ${self.mass.toFixed(1)} · health ${Math.ceil(self.health)}/${healthMaxOf(self.genome, self.tier)}`
        + (abilities ? ` · ${abilities}` : '') + ` · ${genes}`
        + ` · DNA ${Math.floor(lineage.dna)} · children ${lineage.children} · gen ${lineage.generation} · ${players.size} cell${players.size === 1 ? '' : 's'}`
        + (import.meta.env.DEV ? ` · ${Math.round(fps)} fps · ${perf.text()} · ${Math.round(renderScale * 100)}% res` : '')
        + (now < noticeUntil ? ` — ${notice}` : '');
    } else hud.textContent = now < noticeUntil ? notice : ''; // extinct or evolved: no cell to report on

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
    nutrientLayer.update(tick, (now - tickArrivedAt) / 1000, seeps, time, focus,
      { x: camera.position.x, y: camera.position.y, halfW: halfH * camera.aspect, halfH });
    perf.mark('nutrients');
    cloudLayer.update(tick, (now - tickArrivedAt) / 1000, time, focus);
    eggLayer.update(room.state.eggs.values(), tick, time, focus);
    perf.mark('clouds');
    perf.gpuBegin();
    // The editor stays up for exactly one division: until this individual hatches (or dies).
    if (editor.isOpen && (!self || self !== designedFor || self.cyst === 0)) editor.close();
    if (editor.isOpen) {
      const view = editor.frame(time, dt, self!.cyst, innerWidth / innerHeight);
      post.render(view.scene, view.camera);
    } else post.render();
    perf.gpuEnd();
    perf.mark('render');
  });
} catch (err) {
  hud.textContent = `Cannot reach server at ${endpoint}`;
  console.error(err);
}
