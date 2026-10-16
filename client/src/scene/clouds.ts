import { type Cloud, TICK_DT, TOXINS, cloudRadius, currentAt, drift } from '@panspermia/shared';
import { NOISE } from './glsl.ts';
import { createSprites } from './sprites.ts';

// Toxin clouds in the focal plane, rebuilt locally from spawn data like food. Dangers are red: bacteriocin
// a slow crimson haze, pore-former an orange-red shockwave ring, eukaryote poison a dark red bubbling mist.
// Kind rides in the integer part of aSeed, the life fraction (0 fresh → 1 spent) in the fraction.
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
  float fade = 1.0 - life;
  vec3 color;
  if (kind < 0.5) {
    float wisps = 0.55 + 0.45 * valueNoise(p * 3.2 + vec2(uTime * 0.35, -uTime * 0.27));
    float body = (1.0 - smoothstep(0.25, 1.0, r)) * wisps;
    color = vec3(1.0, 0.18, 0.22) * body * 0.42 * fade;
  } else if (kind > 1.5) {
    float mist = 0.5 + 0.5 * valueNoise(p * 2.6 + vec2(-uTime * 0.4, uTime * 0.3));
    float bubbles = smoothstep(0.75, 0.95, valueNoise(p * 9.0 + uTime * 0.8));
    float body = (1.0 - smoothstep(0.3, 1.0, r)) * mist;
    color = vec3(0.8, 0.1, 0.08) * (body * 0.45 + bubbles * body * 0.6) * fade;
  } else {
    float ring = exp(-pow((r - 0.82) / 0.07, 2.0));
    float core = (1.0 - smoothstep(0.0, 0.85, r)) * 0.25;
    color = vec3(1.0, 0.38, 0.12) * (ring * 0.9 + core) * fade;
  }
  gl_FragColor = vec4(color, 1.0);
}
`;
const CAPACITY = 400;

interface Puff { x: number; y: number; tick: number; tick0: number; kind: number }

export function createClouds() {
  const sprites = createSprites(CAPACITY, FRAGMENT, 12);
  const puffs = new Map<string, Puff>();
  const flow = { x: 0, y: 0 };
  return {
    objects: [sprites.mesh],
    add(id: string, c: Cloud) {
      puffs.set(id, { x: c.x0, y: c.y0, tick: c.tick0, tick0: c.tick0, kind: c.kind });
    },
    remove(id: string) { puffs.delete(id); },
    update(tick: number, sinceTick: number, time: number, focus: number) {
      const glide = Math.min(sinceTick, TICK_DT * 1.5);
      let i = 0;
      for (const p of puffs.values()) {
        if (i >= CAPACITY) break;
        drift(p, tick);
        currentAt(p.x, p.y, tick * TICK_DT, flow);
        const age = (tick - p.tick0) * TICK_DT + glide;
        const ahead = (tick - p.tick) * TICK_DT + glide; // drift steps every DRIFT_TICKS: glide since the last step
        sprites.offsets[i * 3] = p.x + flow.x * ahead;
        sprites.offsets[i * 3 + 1] = p.y + flow.y * ahead;
        sprites.offsets[i * 3 + 2] = 0;
        sprites.sizes[i] = 2 * cloudRadius(p.kind, age);
        sprites.seeds[i] = p.kind + Math.min(0.999, age / TOXINS[p.kind]!.life);
        i++;
      }
      sprites.commit(i);
      sprites.setFrame(time, focus);
    },
  };
}
