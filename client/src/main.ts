import { Client } from '@colyseus/sdk';
import { PoolState, ROOM_NAME, SERVER_PORT } from '@panspermia/shared';
import * as THREE from 'three';

const hud = document.getElementById('hud')!;
const endpoint = import.meta.env.VITE_SERVER_URL ?? `${location.protocol}//${location.hostname}:${SERVER_PORT}`;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02121a);
// Perspective top-down camera: depth layers (parallax, DOF) come in P2.
const camera = new THREE.PerspectiveCamera(50, 1, 1, 5000);
camera.position.z = 800;

const resize = () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
};
addEventListener('resize', resize);
resize();

const cellGeometry = new THREE.CircleGeometry(12, 32);
const selfMaterial = new THREE.MeshBasicMaterial({ color: 0x7dffb0 });
const otherMaterial = new THREE.MeshBasicMaterial({ color: 0x4fa8c7 });
const cells = new Map<string, THREE.Mesh>();

try {
  const room = await new Client(endpoint).joinOrCreate(ROOM_NAME, {}, PoolState);
  room.onLeave(() => { hud.textContent = 'Disconnected'; });

  renderer.setAnimationLoop(() => {
    const players = room.state.players;
    // ponytail: full diff every frame, fine for ~100 entities; switch to state callbacks if it shows in profiles.
    for (const [id, p] of players) {
      let mesh = cells.get(id);
      if (!mesh) {
        mesh = new THREE.Mesh(cellGeometry, id === room.sessionId ? selfMaterial : otherMaterial);
        scene.add(mesh);
        cells.set(id, mesh);
      }
      mesh.position.set(p.x, p.y, 0);
    }
    for (const [id, mesh] of cells) {
      if (!players.has(id)) { scene.remove(mesh); cells.delete(id); }
    }
    const self = cells.get(room.sessionId);
    if (self) camera.position.set(self.position.x, self.position.y, camera.position.z);
    hud.textContent = `${players.size} cell${players.size === 1 ? '' : 's'} in the pool`;
    renderer.render(scene, camera);
  });
} catch (err) {
  hud.textContent = `Cannot reach server at ${endpoint}`;
  console.error(err);
}
