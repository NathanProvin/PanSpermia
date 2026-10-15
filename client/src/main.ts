import { Callbacks, Client, Predict, type Reconciler } from '@colyseus/sdk';
import {
  ACTION_SPORE, ACTION_TOXIN, Input, type Lineage, type Player, PoolState, ROOM_NAME, SERVER_PORT,
  EYE_SIGHT, TICK_DT, TIER2, TOXINS, catalogFor, hasGene, stack, healthMaxOf, radiusOf, sanitizeInput, stepCell,
} from '@panspermia/shared';
import * as THREE from 'three';
import { type CardData, decodeCard, showCard } from './card.ts';
import { createEditor } from './editor.ts';
import { createLabels } from './labels.ts';
import { type Look, createCells, hashId } from './scene/cells.ts';
import { createClouds } from './scene/clouds.ts';
import { createMeteor } from './scene/meteor.ts';
import { createNutrients } from './scene/nutrients.ts';
import { createPlankton } from './scene/plankton.ts';
import { createPool } from './scene/pool.ts';
import { createPost } from './scene/post.ts';

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
const camera = new THREE.PerspectiveCamera(50, 1, 10, 6000);
camera.position.z = 700;

const post = createPost(renderer, scene, camera);
const resize = () => {
  const pixelRatio = Math.min(devicePixelRatio, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  post.setSize(innerWidth, innerHeight, pixelRatio);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
};
addEventListener('resize', resize);
resize();

const pool = createPool();
const plankton = createPlankton(camera);
const nutrientLayer = createNutrients();
const cells = createCells(scene);
const editor = createEditor(renderer, document.getElementById('editor')!);
const cloudLayer = createClouds();
const meteor = createMeteor();
scene.add(...pool.objects, ...plankton.objects, ...nutrientLayer.objects, ...cloudLayer.objects, ...meteor.objects);
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
  tier: l.tier, shape: l.shape,
});

try {
  const room = await new Client(endpoint).joinOrCreate(ROOM_NAME, {}, PoolState);
  room.onLeave(() => { hud.textContent = 'Disconnected'; });
  room.onMessage('died', ({ cause, killer, extinct }: { cause: string; killer?: string; extinct: boolean }) => {
    const how = { starvation: 'You starved', phage: 'Phages burst you open' }[cause] ?? `Lysed by ${killer}`;
    if (!extinct) return say(`${how}. Your next child takes over…`);
    extinctScreen.querySelector('p')!.textContent = `${how}. No children were left: your species is extinct.`;
    extinctScreen.hidden = false;
    extinctScreen.querySelector('button')!.focus();
  });
  /** Spore's stage-up: the title card while the camera zooms out to the bigger body (the follow zoom does it). */
  const stageUp = (l: Lineage) => {
    const subtitle = document.createElement('small');
    subtitle.textContent = 'Engulf smaller cells with a jaw, graze algae with a filter mouth. Bacteria are food now.';
    stageup.replaceChildren(`${l.name} evolved into eukaryotes`, subtitle);
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
    const l = room.state.lineages.get(id);
    const genome = p.tier === 2 ? p.genome2 : p.genome;
    const cat = catalogFor(p.tier);
    // The species design, unless this individual differs (dev cheats) or has no lineage (bots).
    const parts = l && l.tier === p.tier && l.genome === genome ? partsOf(l) : cat.defaultParts(genome);
    return { tier: p.tier, genome, parts, hue: l?.hue ?? hashId(id), shape: p.shape };
  };

  const input = room.input({ type: Input, mode: 'reliable' });
  const predict = Predict.get(room, { mode: 'lerp', delay: 100 });
  predict.attachAll('players', { x: 'lerp', y: 'lerp' });
  predict.attachAll('players', { heading: { mode: 'lerp', angle: true } }); // angles lerp the short way round

  // Own cell: predicted locally, reconciled against the server. Death replaces the
  // Player instance, so rebind whenever our entry is (re)added.
  const callbacks = Callbacks.get<PoolState>(room);
  callbacks.onAdd('nutrients', (n, id) => nutrientLayer.add(id, n));
  callbacks.onRemove('nutrients', (_, id) => nutrientLayer.remove(id));
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
      fields: ['x', 'y', 'heading', 'tumble', 'rng', 'spore', 'sporeCooldown', 'dash', 'dashCooldown'],
      // Mass, genome and the sim clock are server-driven; replay reads their latest values and
      // smoothing absorbs the tiny resulting drift (currents change slowly).
      step: (ctx, state, cmd) =>
        stepCell(state, player.mass, player.genome, cmd.dirX, cmd.dirY, cmd.actions, ctx.dt, room.state.tick * TICK_DT,
          player.tier, player.genome2),
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
    const { players, seeps, tick } = room.state;
    if (tick !== lastTick) {
      lastTick = tick;
      tickArrivedAt = now;
    }

    cells.update(players, time, dt, (p) => ({
      x: predict.value(p, 'x'), y: predict.value(p, 'y'), heading: predict.value(p, 'heading'),
      tumble: predict.value(p, 'tumble'), spore: predict.value(p, 'spore'), cyst: p.cyst, dash: predict.value(p, 'dash'),
    }), lookOf);
    const self = players.get(room.sessionId);
    const selfView = cells.get(room.sessionId);
    const selfMesh = selfView?.body;
    if (self && selfMesh) {
      // Follow the cell; zoom out as it grows.
      // Eyes let a eukaryote see further: the camera pulls back.
      const sight = 1 + EYE_SIGHT * stack(self.tier === 2 ? TIER2.copiesOf(self.genome2, 'eye') : 0);
      const targetZ = (140 + 12 * radiusOf(self.mass)) * sight; // bacterium: spawn ≈ 290, cap ≈ 620
      camera.position.set(selfMesh.position.x, selfMesh.position.y, camera.position.z + (targetZ - camera.position.z) * 0.05);
    }
    // Every frame, cell or not: an intro cut short by death or extinction must still play out, not freeze.
    const impact = selfMesh?.position ?? camera.position;
    const { hatch, shake } = meteor.update(dt, time, camera.position.z, impact.x, impact.y);
    selfView?.grow(hatch);
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    if (self && selfMesh) {
      const lineage = room.state.lineages.get(room.sessionId)!;
      if (lineage !== knownLineage) [knownLineage, knownLibrary] = [lineage, lineage.library]; // a new species
      const cat = catalogFor(lineage.tier);
      if (lineage.tier !== knownTier) { // a new species, or a stage-up: the library starts over
        if (knownTier && lineage.tier > knownTier) stageUp(lineage);
        knownTier = lineage.tier;
        knownLibrary = lineage.library;
      }
      if (lineage.library & ~knownLibrary) {
        const found = cat.NAMES.filter((g) => cat.hasGene(lineage.library & ~knownLibrary, g)).map((g) => cat.GENES[g]!.label);
        say(`Part unlocked: ${found.join(', ')}`);
      }
      knownLibrary = lineage.library;
      if (self.cyst > 0 && designedFor !== self) {
        designedFor = self;
        editor.open(lineage, (design, final) => room.send(final ? 'design' : 'draft', design));
      }
      const ownGenome = self.tier === 2 ? self.genome2 : self.genome;
      const genes = cat.NAMES.filter((g) => cat.hasGene(ownGenome, g))
        .map((g) => cat.GENES[g]!.label + (cat.copiesOf(ownGenome, g) > 1 ? ` ×${cat.copiesOf(ownGenome, g)}` : '')).join(', ') || 'no genes';
      const ready = (s: number) => (s > 0 ? `${s.toFixed(1)}s` : 'ready');
      const abilities = [
        self.tier === 1 && TOXINS.some((t) => t.tier === 1 && hasGene(self.genome, t.gene)) ? `toxin ${ready(self.toxinCooldown)}` : '',
        self.tier === 2 && TIER2.hasGene(self.genome2, 'poison') ? `poison ${ready(self.toxinCooldown)}` : '',
        self.tier === 2 && TIER2.hasGene(self.genome2, 'jet') ? (self.dash > 0 ? 'DASH' : `jet ${ready(self.dashCooldown)}`) : '',
        hasGene(self.genome, 'endospore') ? (self.spore > 0 ? 'DORMANT' : `spore ${ready(self.sporeCooldown)}`) : '',
        self.infection > 0 ? `INFECTED ${self.infection.toFixed(1)}s` : '',
        self.cyst > 0 ? 'DIVIDING' : '',
      ].filter(Boolean).join(' · ');
      hud.textContent = `${lineage.name} · energy ${self.mass.toFixed(1)} · health ${Math.ceil(self.health)}/${healthMaxOf(self.genome, self.tier)}`
        + (abilities ? ` · ${abilities}` : '') + ` · ${genes}`
        + ` · DNA ${Math.floor(lineage.dna)} · children ${lineage.children} · gen ${lineage.generation} · ${players.size} cell${players.size === 1 ? '' : 's'}`
        + (import.meta.env.DEV ? ` · ${Math.round(fps)} fps` : '')
        + (now < noticeUntil ? ` — ${notice}` : '');
    } else hud.textContent = now < noticeUntil ? notice : ''; // extinct or evolved: no cell to report on

    if (stageupUntil && now > stageupUntil) {
      stageupUntil = 0;
      stageup.classList.remove('on');
    }

    labels.update(players, room.sessionId, camera, (id) => {
      const body = cells.get(id)?.body;
      return body && { x: body.position.x, y: body.position.y, r: body.scale.x };
    }, !editor.isOpen && !meteor.active);
    labels.leaderboard(players, room.sessionId, !editor.isOpen);

    const focus = camera.position.z; // distance to the gameplay plane
    pool.update(time);
    plankton.update(time, dt, focus);
    nutrientLayer.update(tick, (now - tickArrivedAt) / 1000, seeps, time, focus);
    cloudLayer.update(tick, (now - tickArrivedAt) / 1000, time, focus);
    // The editor stays up for exactly one division: until this individual hatches (or dies).
    if (editor.isOpen && (!self || self !== designedFor || self.cyst === 0)) editor.close();
    if (editor.isOpen) {
      const view = editor.frame(time, dt, self!.cyst, innerWidth / innerHeight);
      post.render(view.scene, view.camera);
    } else post.render();
  });
} catch (err) {
  hud.textContent = `Cannot reach server at ${endpoint}`;
  console.error(err);
}
