import { NOISE } from './glsl.ts';
import { createSprites } from './sprites.ts';

// Panspermia intro: a molten meteor plunges through the water layers, trailing steam, and shatters on
// the gameplay plane; your first cell hatches from the impact. Client-only cinematic, played once per
// page load (server spawn grace keeps the newcomer safe meanwhile). Kind rides in the integer part of
// aSeed (0 rock, 1 steam, 2 flash, 3 shockwave), the life fraction in the fraction.
const FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
${NOISE}
void main() {
  float kind = floor(vSeed);
  float life = fract(vSeed);
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float rim = 1.0 - smoothstep(0.6, 1.0, r); // every glow reaches 0 inside the quad: no square edges under bloom
  vec3 color;
  if (kind < 0.5) {
    float a = atan(p.y, p.x);
    float edge = 0.5 + 0.08 * valueNoise(vec2(a * 2.0, 0.0) + 3.0) + 0.04 * sin(a * 7.0);
    float rock = 1.0 - smoothstep(edge - 0.05, edge, r);
    float cracks = smoothstep(0.55, 0.8, valueNoise(p * 6.0 + uTime * 2.0));
    color = vec3(1.0, 0.45, 0.12) * (rock * (0.6 + 1.6 * cracks) + exp(-r * r * 5.0) * rim * 0.9);
  } else if (kind < 1.5) {
    float puff = exp(-r * r * 4.0) * rim * (0.7 + 0.3 * valueNoise(p * 3.0 + vSeed * 20.0));
    color = mix(vec3(1.0, 0.6, 0.3), vec3(0.75, 0.9, 1.0), smoothstep(0.0, 0.3, life)) * puff * 0.5 * (1.0 - life);
  } else if (kind < 2.5) {
    color = vec3(1.0, 0.85, 0.6) * exp(-r * r * 5.0) * rim * 3.0 * pow(1.0 - life, 2.0);
  } else {
    color = vec3(0.7, 0.95, 1.0) * exp(-pow((r - 0.9) / 0.04, 2.0)) * (1.0 - life);
  }
  gl_FragColor = vec4(color, 1.0);
}
`;
const FALL = 1.6; // s from entry to impact
const AFTER = 1.2; // s of flash and shockwave
const STEAM_LIFE = 1.1; // s
const STEAM = 90;
const ENTRY = { x: -380, y: 460 }; // lateral offset where the meteor enters, world units from the impact

interface Puff { x: number; y: number; z: number; born: number }

export function createMeteor() {
  const sprites = createSprites(STEAM + 3, FRAGMENT, 20);
  let t = -1; // seconds since start; < 0 = idle
  let steam: Puff[] = [];
  const easeOutBack = (k: number) => 1 + 2.7 * (k - 1) ** 3 + 1.7 * (k - 1) ** 2;

  return {
    objects: [sprites.mesh],
    start() {
      t = 0;
      steam = [];
    },
    get active() { return t >= 0; },
    /**
     * Advance and draw toward the impact point (the hatching cell, which drifts). `height` is the
     * camera's height above the plane: the meteor always falls from below it. Returns the cell's
     * hatch scale (0 → 1, overshooting) and the camera shake amplitude in world units.
     */
    update(dt: number, time: number, height: number, x: number, y: number) {
      if (t < 0) return { hatch: 1, shake: 0 };
      t += dt;
      let i = 0;
      const put = (px: number, py: number, pz: number, size: number, seed: number) => {
        sprites.offsets.set([px, py, pz], i * 3);
        sprites.sizes[i] = size;
        sprites.seeds[i] = seed;
        i++;
      };

      if (t < FALL) {
        const e = (t / FALL) ** 2; // accelerating plunge
        const mx = x + ENTRY.x * (1 - e);
        const my = y + ENTRY.y * (1 - e);
        const mz = height * 0.55 * (1 - e);
        steam.push({ x: mx + (Math.random() - 0.5) * 10, y: my + (Math.random() - 0.5) * 10, z: mz, born: t });
        put(mx, my, mz, 34, 0);
      }
      steam = steam.filter((s) => t - s.born < STEAM_LIFE).slice(-STEAM);
      for (const s of steam) {
        const age = t - s.born;
        put(s.x, s.y, s.z, 18 + age * 70, 1 + age / STEAM_LIFE);
      }
      const after = t - FALL;
      if (after >= 0) {
        put(x, y, 2, 160 + after * 300, 2 + Math.min(0.999, after / 0.7));
        put(x, y, 1, 30 + after * 600, 3 + Math.min(0.999, after / AFTER));
      }
      sprites.commit(i);
      sprites.setFrame(time, height);

      const hatch = after < 0 ? 0 : easeOutBack(Math.min(1, after / 0.5));
      const shake = after < 0 ? 0 : Math.max(0, 1 - after / 0.5) * 6;
      if (after >= AFTER && steam.length === 0) t = -1;
      return { hatch, shake };
    },
  };
}
