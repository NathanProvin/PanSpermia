import { currentAt } from '@panspermia/shared';
import type * as THREE from 'three';
import { createSprites } from './sprites.ts';

// Ambient life drifting on the pool currents at many depths. Depth, not distance in the plane,
// does the work: perspective gives parallax, the sprite lens gives depth of field.
const COUNT = 2400;
const FOREGROUND_SHARE = 0.12; // between camera and gameplay plane: few, large, very blurred

const FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
varying float vSize;
varying float vSharp;
void main() {
  float r = length(vUv * 2.0 - 1.0);
  float soft = max(1.0 - vSharp, 0.15);
  float disc = 1.0 - smoothstep(1.0 - soft, 1.0, r);
  // Large organisms read as translucent cells: bright membrane ring, faint interior.
  float big = smoothstep(30.0, 90.0, vSize);
  float ring = smoothstep(0.55 - soft * 0.5, 0.85, r) * disc;
  float body = mix(disc, (0.2 * disc + ring) * 0.4, big); // distant organisms: faint silhouettes
  float twinkle = 0.75 + 0.25 * sin(uTime * (0.6 + vSeed) * 2.0 + vSeed * 40.0);
  // A mixed pond community: blue-green specks, pale green algae, golden diatoms.
  float pick = fract(vSeed * 7.31);
  vec3 col = pick < 0.45 ? mix(vec3(0.28, 0.62, 0.66), vec3(0.45, 0.78, 0.6), pick / 0.45)
    : pick < 0.8 ? vec3(0.62, 0.86, 0.45) : vec3(0.85, 0.72, 0.38);
  // Energy conservation: the blurred disc covers (1/vSharp)^2 more area.
  gl_FragColor = vec4(col * body * twinkle * vSharp * vSharp * 0.35, 1.0);
}
`;

interface Mote { x: number; y: number; z: number }

export function createPlankton(camera: THREE.PerspectiveCamera) {
  const back = createSprites(COUNT, FRAGMENT, 1);
  const front = createSprites(Math.ceil(COUNT * FOREGROUND_SHARE), FRAGMENT, 20);
  const motes: Mote[] = [];
  const flow = { x: 0, y: 0 };

  const layers = [
    { sprites: back, count: COUNT - front.sizes.length, zMin: -1100, zMax: -60 },
    { sprites: front, count: front.sizes.length, zMin: 40, zMax: 160 }, // below the lowest camera (z ≈ 247)
  ];
  for (const { sprites, count, zMin, zMax } of layers) {
    for (let i = 0; i < count; i++) {
      const roll = Math.random();
      // Mostly specks, some diatom-sized, rare large drifting cells (deep only).
      sprites.sizes[i] = roll < 0.9 ? 2 + Math.random() * 4 : roll < 0.994 || zMax > 0 ? 8 + Math.random() * 14 : 90 + Math.random() * 180;
      sprites.seeds[i] = Math.random();
      motes.push({ x: (Math.random() - 0.5) * 4000, y: (Math.random() - 0.5) * 4000, z: zMin + Math.random() * (zMax - zMin) });
    }
  }

  return {
    objects: [back.mesh, front.mesh],
    /** Advect on the currents and wrap each mote within the view frustum at its own depth. */
    update(time: number, dt: number, focus: number) {
      const tanHalf = Math.tan((camera.fov * Math.PI) / 360) * 1.2;
      let m = 0;
      for (const { sprites, count } of layers) {
        for (let i = 0; i < count; i++, m++) {
          const mote = motes[m]!;
          currentAt(mote.x, mote.y, time, flow);
          mote.x += flow.x * dt;
          mote.y += flow.y * dt;
          const halfH = (camera.position.z - mote.z) * tanHalf;
          const halfW = halfH * camera.aspect;
          mote.x = camera.position.x + wrap(mote.x - camera.position.x, halfW);
          mote.y = camera.position.y + wrap(mote.y - camera.position.y, halfH);
          sprites.offsets[i * 3] = mote.x;
          sprites.offsets[i * 3 + 1] = mote.y;
          sprites.offsets[i * 3 + 2] = mote.z;
        }
        sprites.commit(count);
        sprites.setFrame(time, focus);
      }
    },
  };
}

/** Wrap v into [-half, half). */
const wrap = (v: number, half: number) => ((((v + half) % (2 * half)) + 2 * half) % (2 * half)) - half;
