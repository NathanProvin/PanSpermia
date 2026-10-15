import { Callbacks, Client, Predict, type Reconciler } from '@colyseus/sdk';
import {
  ACTION_SPORE, ACTION_TOXIN, GENES, GENE_NAMES, Input, type Lineage, type Player, PoolState, ROOM_NAME, SERVER_PORT,
  TICK_DT, TOXINS, copiesOf, defaultParts, hasGene, healthMaxOf, radiusOf, sanitizeInput, stepCell,
} from '@panspermia/shared';
import * as THREE from 'three';
import { createEditor } from './editor.ts';
import { type Look, createCells, hashId } from './scene/cells.ts';
import { createClouds } from './scene/clouds.ts';
import { createMeteor } from './scene/meteor.ts';
import { createNutrients } from './scene/nutrients.ts';
import { createPlankton } from './scene/plankton.ts';
import { createPool } from './scene/pool.ts';
import { createPost } from './scene/post.ts';

const hud = document.getElementById('hud')!;
const extinctScreen = document.getElementById('extinct')!;
const endpoint = import.meta.env.VITE_SERVER_URL ?? `${location.protocol}//${location.hostname}:${SERVER_PORT}`;

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
  extinctScreen.querySelector('button')!.addEventListener('click', () => {
    extinctScreen.hidden = true;
    room.send('newSpecies');
  });
  room.onMessage('designRefused', (reason: string) => (editor.isOpen ? editor.refused(reason) : say(`Design refused: ${reason}`)));

  /** A player's cell wears its species design (unless dev cheats changed its genes); bots get the default layout. */
  const lookOf = (id: string, p: Player): Look => {
    const l = room.state.lineages.get(id);
    if (!l) return { genome: p.genome, parts: defaultParts(p.genome), hue: hashId(id) };
    const parts = p.genome === l.genome
      ? [...l.parts].map((part) => ({ ...part.toJSON(), gene: GENE_NAMES[part.gene]! }))
      : defaultParts(p.genome);
    return { genome: p.genome, parts, hue: l.hue };
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
      fields: ['x', 'y', 'heading', 'tumble', 'rng', 'spore', 'sporeCooldown'],
      // Mass, genome and the sim clock are server-driven; replay reads their latest values and
      // smoothing absorbs the tiny resulting drift (currents change slowly).
      step: (ctx, state, cmd) =>
        stepCell(state, player.mass, player.genome, cmd.dirX, cmd.dirY, cmd.actions, ctx.dt, room.state.tick * TICK_DT),
      warnOnDivergence: import.meta.env.DEV ? 1 : undefined, // console warning if client and server sims drift apart
    });
  });

  if (import.meta.env.DEV) {
    // Dev cheats (server must run with --dev, else it kicks us): these keys toggle genes in catalog
    // order; P drops a plasmid, V a phage, onto the cell; G grows to the cap, K kills the cell, N grants DNA.
    const DEV_KEYS = '1234567890-=[';
    addEventListener('keydown', (e) => {
      const gene = GENE_NAMES[DEV_KEYS.indexOf(e.key)];
      if (gene) room.send('dev:toggleGene', gene);
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
      tumble: predict.value(p, 'tumble'), spore: predict.value(p, 'spore'), cyst: p.cyst,
    }), lookOf);
    const self = players.get(room.sessionId);
    const selfView = cells.get(room.sessionId);
    const selfMesh = selfView?.body;
    if (self && selfMesh) {
      // Follow the cell; zoom out as it grows.
      const targetZ = 140 + 12 * radiusOf(self.mass); // spawn ≈ 290, cap ≈ 620
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
      if (lineage.library & ~knownLibrary) {
        const found = GENE_NAMES.filter((g) => hasGene(lineage.library & ~knownLibrary, g)).map((g) => GENES[g].label);
        say(`Part unlocked: ${found.join(', ')}`);
      }
      knownLibrary = lineage.library;
      if (self.cyst > 0 && designedFor !== self) {
        designedFor = self;
        editor.open(lineage, (design, final) => room.send(final ? 'design' : 'draft', design));
      }
      const genes = GENE_NAMES.filter((g) => hasGene(self.genome, g))
        .map((g) => GENES[g].label + (copiesOf(self.genome, g) > 1 ? ` ×${copiesOf(self.genome, g)}` : '')).join(', ') || 'no genes';
      const ready = (s: number) => (s > 0 ? `${s.toFixed(1)}s` : 'ready');
      const abilities = [
        TOXINS.some((t) => hasGene(self.genome, t.gene)) ? `toxin ${ready(self.toxinCooldown)}` : '',
        hasGene(self.genome, 'endospore') ? (self.spore > 0 ? 'DORMANT' : `spore ${ready(self.sporeCooldown)}`) : '',
        self.infection > 0 ? `INFECTED ${self.infection.toFixed(1)}s` : '',
        self.cyst > 0 ? 'DIVIDING' : '',
      ].filter(Boolean).join(' · ');
      hud.textContent = `mass ${self.mass.toFixed(1)} · health ${Math.ceil(self.health)}/${healthMaxOf(self.genome)}`
        + (abilities ? ` · ${abilities}` : '') + ` · ${genes}`
        + ` · DNA ${Math.floor(lineage.dna)} · children ${lineage.children} · gen ${lineage.generation} · ${players.size} cell${players.size === 1 ? '' : 's'}`
        + (import.meta.env.DEV ? ` · ${Math.round(fps)} fps` : '')
        + (now < noticeUntil ? ` — ${notice}` : '');
    }

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
