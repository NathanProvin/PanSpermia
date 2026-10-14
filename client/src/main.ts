import { Callbacks, Client, Predict, type Reconciler } from '@colyseus/sdk';
import {
  GENES, GENE_NAMES, Input, PoolState, ROOM_NAME, SERVER_PORT, TICK_DT, clampSteer, hasGene, radiusOf, stepCell,
} from '@panspermia/shared';
import * as THREE from 'three';
import { createCells } from './scene/cells.ts';
import { createNutrients } from './scene/nutrients.ts';
import { createPlankton } from './scene/plankton.ts';
import { createPool } from './scene/pool.ts';
import { createPost } from './scene/post.ts';

const hud = document.getElementById('hud')!;
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
scene.add(...pool.objects, ...plankton.objects, ...nutrientLayer.objects);

// Steering: pointer offset from the screen centre (where your cell is drawn).
// Full throttle at a quarter of the short screen side; `clampSteer` caps anything beyond.
const pointer = { x: 0, y: 0 };
addEventListener('pointermove', (e) => {
  pointer.x = e.clientX - innerWidth / 2;
  pointer.y = innerHeight / 2 - e.clientY;
});
const throttleScale = () => Math.min(innerWidth, innerHeight) / 4;

let notice = '';
let fps = 0; // dev readout, exponential moving average
let noticeUntil = 0;

try {
  const room = await new Client(endpoint).joinOrCreate(ROOM_NAME, {}, PoolState);
  room.onLeave(() => { hud.textContent = 'Disconnected'; });
  room.onMessage('died', ({ cause }: { cause: string }) => {
    notice = cause === 'starvation' ? 'You starved. A new cell drifts in…' : 'You died.';
    noticeUntil = performance.now() + 4000;
  });

  const input = room.input({ type: Input, mode: 'reliable' });
  const predict = Predict.get(room, { mode: 'lerp', delay: 100 });
  predict.attachAll('players', { x: 'lerp', y: 'lerp' });
  predict.attachAll('players', { heading: { mode: 'lerp', angle: true } }); // angles lerp the short way round

  // Own cell: predicted locally, reconciled against the server. Death replaces the
  // Player instance, so rebind whenever our entry is (re)added.
  const callbacks = Callbacks.get<PoolState>(room);
  callbacks.onAdd('nutrients', (n, id) => nutrientLayer.add(id, n));
  callbacks.onRemove('nutrients', (_, id) => nutrientLayer.remove(id));

  let me: Reconciler | undefined;
  callbacks.onAdd('players', (player, id) => {
    if (id !== room.sessionId) return;
    me?.dispose();
    me = predict.reconciler(player, {
      input,
      fields: ['x', 'y', 'heading', 'tumble', 'rng'],
      // Mass, genome and the sim clock are server-driven; replay reads their latest values and
      // smoothing absorbs the tiny resulting drift (currents change slowly).
      step: (ctx, state, cmd) => stepCell(state, player.mass, player.genome, cmd.dirX, cmd.dirY, ctx.dt, room.state.tick * TICK_DT),
      warnOnDivergence: import.meta.env.DEV ? 1 : undefined, // console warning if client and server sims drift apart
    });
  });

  if (import.meta.env.DEV) {
    // Dev cheat (server must run with --dev, else it kicks us): number keys toggle genes.
    addEventListener('keydown', (e) => {
      const gene = GENE_NAMES[Number(e.key) - 1];
      if (gene) room.send('dev:toggleGene', gene);
    });
  }

  let last = performance.now();
  let lastTick = -1;
  let tickArrivedAt = 0;
  renderer.setAnimationLoop((now) => {
    // Send the due inputs before reading any predicted value (see Predict.tick).
    for (let due = predict.tick(now); due > 0; due--) {
      input.data.dirX = pointer.x / throttleScale();
      input.data.dirY = pointer.y / throttleScale();
      clampSteer(input.data); // same sanitizer as the server, so prediction replays the real command
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

    cells.update(players, room.sessionId, time, dt, (p) => ({
      x: predict.value(p, 'x'), y: predict.value(p, 'y'), heading: predict.value(p, 'heading'), tumble: predict.value(p, 'tumble'),
    }));
    const self = players.get(room.sessionId);
    const selfMesh = cells.get(room.sessionId);
    if (self && selfMesh) {
      // Follow the cell; zoom out as it grows.
      const targetZ = 140 + 12 * radiusOf(self.mass); // spawn ≈ 290, cap ≈ 620
      camera.position.set(selfMesh.position.x, selfMesh.position.y, camera.position.z + (targetZ - camera.position.z) * 0.05);
      const genes = GENE_NAMES.filter((g) => hasGene(self.genome, g)).map((g) => GENES[g].label).join(', ') || 'no genes';
      hud.textContent = `mass ${self.mass.toFixed(1)} · health ${Math.ceil(self.health)} · ${genes} · ${players.size} cell${players.size === 1 ? '' : 's'}`
        + (import.meta.env.DEV ? ` · ${Math.round(fps)} fps` : '')
        + (now < noticeUntil ? ` — ${notice}` : '');
    }

    const focus = camera.position.z; // distance to the gameplay plane
    pool.update(time);
    plankton.update(time, dt, focus);
    nutrientLayer.update(tick, (now - tickArrivedAt) / 1000, seeps, time, focus);
    post.render();
  });
} catch (err) {
  hud.textContent = `Cannot reach server at ${endpoint}`;
  console.error(err);
}
