import { currentAt } from '@panspermia/shared';
import type * as THREE from 'three';
import { createSprites } from './sprites.ts';

// Suspended matter drifting on the pool currents at many depths: a sunny pond's water is full of grey dust,
// brown flakes of detritus, fluffy marine snow, mossy and leaf-green algae, golden diatoms, and the odd large
// translucent organism deep down. It is matter, not light: drawn over the water (premultiplied alpha), so
// brown flakes darken it instead of glowing. Depth, not distance in the plane, does the work: perspective
// gives parallax, the sprite lens gives depth of field; every mote tumbles slowly and sinks.
const COUNT = 2400;
const FOREGROUND_SHARE = 0.12; // between camera and gameplay plane: few, large, very blurred
const SINK = [2, 9]; // world units/s, per mote

const FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uFade;
varying vec2 vUv;
varying float vSeed;
varying float vSize;
varying float vSharp;
void main() {
  float pick = fract(vSeed * 7.31);
  float tone = fract(vSeed * 13.7);
  // A slow tumble: each mote turns at its own pace, so elongated flakes show edge-on, then flat.
  float spin = vSeed * 6.2831 + uTime * (fract(vSeed * 3.7) - 0.5) * 0.5;
  vec2 p = mat2(cos(spin), sin(spin), -sin(spin), cos(spin)) * (vUv * 2.0 - 1.0);
  // Outline detail only shows in focus: a defocused mote is a soft disc.
  float detail = smoothstep(0.15, 0.6, vSharp);
  // A cheap warp (two sines, not value noise: thousands of motes are shaded every frame).
  float ragged = 0.5 * sin(p.x * 4.1 + vSeed * 31.0) * sin(p.y * 3.3 - vSeed * 17.0) * detail;
  float r;
  vec3 col;
  float opacity;
  if (pick < 0.3) { // dust: warm greys to stone
    r = length(p * vec2(1.0, 1.3)) * (1.0 + 0.3 * ragged);
    col = mix(vec3(0.15, 0.15, 0.14), vec3(0.3, 0.29, 0.25), tone);
    opacity = 0.6;
  } else if (pick < 0.55) { // detritus: ragged, elongated flakes, umber to chestnut brown
    r = length(p * vec2(1.0, 1.8 + 1.6 * fract(vSeed * 5.3))) + 0.45 * ragged;
    col = mix(vec3(0.15, 0.09, 0.04), vec3(0.34, 0.21, 0.09), tone);
    opacity = 0.85;
  } else if (pick < 0.68) { // marine snow: pale, fluffy aggregates
    r = length(p) + 0.3 * sin(p.x * 7.0 + vSeed * 13.0) * sin(p.y * 6.0 + vSeed * 23.0) * detail;
    col = mix(vec3(0.4, 0.39, 0.33), vec3(0.52, 0.5, 0.42), tone);
    opacity = 0.22; // pale and many: more would veil the pond in milk
  } else if (pick < 0.93) { // algae and moss fragments: mossy olive to fresh leaf green
    r = length(p * vec2(1.0, 1.0 + 0.8 * fract(vSeed * 2.9))) + 0.25 * ragged;
    col = mix(vec3(0.15, 0.24, 0.06), vec3(0.2, 0.46, 0.1), tone);
    opacity = 0.75;
  } else { // diatoms: golden rods
    r = length(p * vec2(1.0, 3.2));
    col = mix(vec3(0.42, 0.31, 0.1), vec3(0.56, 0.43, 0.15), tone);
    opacity = 0.75;
  }
  float soft = max(1.0 - vSharp, 0.15);
  float disc = 1.0 - smoothstep(1.0 - soft, 1.0, r);
  // Large organisms (deep only) read as translucent cells: a faint membrane ring and interior.
  float big = smoothstep(30.0, 90.0, vSize);
  float ring = smoothstep(0.55 - soft * 0.5, 0.85, length(p)) * (1.0 - smoothstep(1.0 - soft, 1.0, length(p)));
  disc = mix(disc, 0.15 * disc + 0.5 * ring, big);
  col = mix(col, vec3(0.2, 0.3, 0.22), big);
  // Depth of field: a blurred mote spreads its matter over a larger disc. Physically it fades with vSharp²;
  // vSharp^1.5 keeps the water visibly full of matter at every depth.
  float alpha = disc * opacity * pow(vSharp, 1.5) * uFade;
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

interface Mote { x: number; y: number; z: number; sink: number }

export function createPlankton(camera: THREE.PerspectiveCamera) {
  const back = createSprites(COUNT, FRAGMENT, 1, true);
  const front = createSprites(Math.ceil(COUNT * FOREGROUND_SHARE), FRAGMENT, 20, true);
  front.mesh.material.uniforms.uFade!.value = 0.3; // right in front of the lens: a faint veil, never a blot
  // Alpha is ≤ opacity × sharpness^1.5: below ~2 % coverage a mote is invisible, but its blurred quad isn't free.
  for (const s of [back, front]) s.mesh.material.uniforms.uCull!.value = 0.006;
  const motes: Mote[] = [];
  const flow = { x: 0, y: 0 };

  const layers = [
    { sprites: back, count: COUNT - front.sizes.length, zMin: -1100, zMax: -60 },
    { sprites: front, count: front.sizes.length, zMin: 40, zMax: 160 }, // below the lowest camera (z ≈ 247)
  ];
  for (const { sprites, count, zMin, zMax } of layers) {
    for (let i = 0; i < count; i++) {
      const roll = Math.random();
      // Mostly specks, some flakes, rare large drifting organisms (deep only).
      sprites.sizes[i] = roll < 0.85 ? 2 + Math.random() * 5 : roll < 0.994 || zMax > 0 ? 8 + Math.random() * 16 : 90 + Math.random() * 180;
      sprites.seeds[i] = Math.random();
      motes.push({
        x: (Math.random() - 0.5) * 4000, y: (Math.random() - 0.5) * 4000, z: zMin + Math.random() * (zMax - zMin),
        sink: SINK[0]! + Math.random() * (SINK[1]! - SINK[0]!),
      });
    }
  }

  return {
    objects: [back.mesh, front.mesh],
    /** Advect on the currents, sink, and wrap each mote within the view frustum at its own depth. */
    update(time: number, dt: number, focus: number) {
      const tanHalf = Math.tan((camera.fov * Math.PI) / 360) * 1.2;
      let m = 0;
      for (const { sprites, count, zMin, zMax } of layers) {
        for (let i = 0; i < count; i++, m++) {
          const mote = motes[m]!;
          currentAt(mote.x, mote.y, time, flow);
          mote.x += flow.x * dt;
          mote.y += flow.y * dt;
          mote.z -= mote.sink * dt;
          if (mote.z < zMin) mote.z = zMax; // settled out: a new one drifts down from above
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
