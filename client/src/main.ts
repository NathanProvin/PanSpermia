import { Callbacks, Client, Predict, type Reconciler } from '@colyseus/sdk';
import {
  Input, NUTRIENT_COUNT, PoolState, ROOM_NAME, SERVER_PORT, WORLD_RADIUS, clampSteer, move, radiusOf,
} from '@panspermia/shared';
import * as THREE from 'three';

const hud = document.getElementById('hud')!;
const endpoint = import.meta.env.VITE_SERVER_URL ?? `${location.protocol}//${location.hostname}:${SERVER_PORT}`;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02121a);
// Perspective top-down camera: depth layers (parallax, DOF) come in P2.
const camera = new THREE.PerspectiveCamera(50, 1, 1, 10000);
camera.position.z = 700;

const resize = () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
};
addEventListener('resize', resize);
resize();

// Placeholder visuals; P2 replaces them with shaders.
scene.add(new THREE.Mesh(
  new THREE.RingGeometry(WORLD_RADIUS, WORLD_RADIUS + 8, 256),
  new THREE.MeshBasicMaterial({ color: 0x1d4f5c }),
));
const nutrientPositions = new Float32Array(NUTRIENT_COUNT * 3);
const nutrientGeometry = new THREE.BufferGeometry();
nutrientGeometry.setAttribute('position', new THREE.BufferAttribute(nutrientPositions, 3));
scene.add(new THREE.Points(nutrientGeometry, new THREE.PointsMaterial({ color: 0xc8f07a, size: 5 })));

const cellGeometry = new THREE.CircleGeometry(1, 48);
const selfMaterial = new THREE.MeshBasicMaterial({ color: 0x7dffb0 });
const otherMaterial = new THREE.MeshBasicMaterial({ color: 0x4fa8c7 });
const cells = new Map<string, THREE.Mesh>();

// Steering: pointer offset from the screen centre (where your cell is drawn).
// Full throttle at a quarter of the short screen side; `clampSteer` caps anything beyond.
const pointer = { x: 0, y: 0 };
addEventListener('pointermove', (e) => {
  pointer.x = e.clientX - innerWidth / 2;
  pointer.y = innerHeight / 2 - e.clientY;
});
const throttleScale = () => Math.min(innerWidth, innerHeight) / 4;

let notice = '';
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

  // Own cell: predicted locally, reconciled against the server. Death replaces the
  // Player instance, so rebind whenever our entry is (re)added.
  let me: Reconciler | undefined;
  Callbacks.get<PoolState>(room).onAdd('players', (player, id) => {
    if (id !== room.sessionId) return;
    me?.dispose();
    me = predict.reconciler(player, {
      input,
      fields: ['x', 'y'],
      // Mass is server-driven (eating, metabolism); replay reads its latest value, smoothing absorbs the drift.
      step: (ctx, state, cmd) => move(state, player.mass, cmd.dirX, cmd.dirY, ctx.dt),
      warnOnDivergence: import.meta.env.DEV ? 1 : undefined, // console warning if client and server sims drift apart
    });
  });

  renderer.setAnimationLoop((now) => {
    // Send the due inputs before reading any predicted value (see Predict.tick).
    for (let due = predict.tick(now); due > 0; due--) {
      input.data.dirX = pointer.x / throttleScale();
      input.data.dirY = pointer.y / throttleScale();
      clampSteer(input.data); // same sanitizer as the server, so prediction replays the real command
      input.send();
    }

    const { players, nutrients } = room.state;
    // ponytail: full diff every frame, fine for ~100 cells; switch to state callbacks if it shows in profiles.
    for (const [id, p] of players) {
      let mesh = cells.get(id);
      if (!mesh) {
        mesh = new THREE.Mesh(cellGeometry, id === room.sessionId ? selfMaterial : otherMaterial);
        scene.add(mesh);
        cells.set(id, mesh);
      }
      mesh.position.set(predict.value(p, 'x'), predict.value(p, 'y'), 1);
      mesh.scale.setScalar(radiusOf(p.mass));
    }
    for (const [id, mesh] of cells) {
      if (!players.has(id)) { scene.remove(mesh); cells.delete(id); }
    }

    let i = 0;
    for (const n of nutrients.values()) {
      if (i >= nutrientPositions.length) break;
      nutrientPositions[i++] = n.x;
      nutrientPositions[i++] = n.y;
      nutrientPositions[i++] = 0;
    }
    nutrientGeometry.setDrawRange(0, i / 3);
    nutrientGeometry.attributes.position!.needsUpdate = true;

    const self = players.get(room.sessionId);
    const selfMesh = cells.get(room.sessionId);
    if (self && selfMesh) {
      // Zoom out as the cell grows.
      const targetZ = 500 + 15 * radiusOf(self.mass);
      camera.position.set(selfMesh.position.x, selfMesh.position.y, camera.position.z + (targetZ - camera.position.z) * 0.05);
      hud.textContent = `mass ${self.mass.toFixed(1)} · health ${Math.ceil(self.health)} · ${players.size} cell${players.size === 1 ? '' : 's'}`
        + (now < noticeUntil ? ` — ${notice}` : '');
    }
    renderer.render(scene, camera);
  });
} catch (err) {
  hud.textContent = `Cannot reach server at ${endpoint}`;
  console.error(err);
}
