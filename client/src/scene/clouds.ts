import { type Cloud, INK, TICK_DT, TOXINS, cloudRadius, currentAt, drift } from '@panspermia/shared';
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
  } else if (kind > 3.5 && kind < 4.5) {
    // Trichocysts: a burst of harpoon threads shot out from the middle, pale and fast-fading.
    float a = atan(p.y, p.x);
    float threads = smoothstep(0.82, 1.0, cos(a * 13.0 + floor(life * 3.0) * 1.7)) * (1.0 - smoothstep(0.2, 1.0, r)) * smoothstep(0.0, 0.15, r);
    float tips = exp(-pow((r - 0.2 - 0.7 * sqrt(life)) / 0.05, 2.0)) * smoothstep(0.6, 1.0, cos(a * 13.0 + floor(life * 3.0) * 1.7));
    color = vec3(0.85, 0.92, 1.0) * (threads * 0.55 + tips * 0.8) * fade;
  } else if (kind > 4.5) {
    // Nematocysts: violet stinging threads lashing out all round, coiled at their roots.
    float a = atan(p.y, p.x);
    float lash = smoothstep(0.75, 1.0, cos(a * 18.0 + sin(r * 12.0 - uTime * 8.0))) * (1.0 - smoothstep(0.3, 1.0, r));
    float coil = exp(-pow((r - 0.25) / 0.08, 2.0)) * (0.5 + 0.5 * sin(a * 30.0 + uTime * 10.0));
    color = vec3(0.7, 0.5, 1.0) * (lash * 0.6 + coil * 0.35) * fade;
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
// A mollusk's ink is matter, not light: dark sepia billows drawn over the water (premultiplied alpha), thick at
// first, curling and thinning out as it spreads.
const INK_FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
${NOISE}
void main() {
  float life = fract(vSeed);
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  vec2 swirl = vec2(valueNoise(p * 2.0 + uTime * 0.15), valueNoise(p * 2.0 - uTime * 0.12 + 7.0)) - 0.5;
  float billows = valueNoise(p * 3.5 + swirl * 2.5) * 0.6 + valueNoise(p * 7.0 - swirl * 3.0) * 0.4;
  // Dense: the water behind is already dark in linear light, so half-transparent ink barely shows. Opaque at the core.
  float edge = 1.0 - smoothstep(0.5 + 0.3 * billows, 1.0, r);
  float a = min(1.0, edge * (0.8 + 0.35 * billows)) * (0.97 - 0.85 * life * life);
  // A flat sepia: the billows live in the alpha. (Colour mixed by billows blew up into white bloom in the browser.)
  gl_FragColor = vec4(vec3(0.05, 0.035, 0.03) * a, a); // premultiplied
}
`;
const CAPACITY = 400;

interface Puff { x: number; y: number; tick: number; tick0: number; kind: number }

export function createClouds() {
  const sprites = createSprites(CAPACITY, FRAGMENT, 12);
  const ink = createSprites(64, INK_FRAGMENT, 12, true);
  const puffs = new Map<string, Puff>();
  const flow = { x: 0, y: 0 };
  return {
    objects: [sprites.mesh, ink.mesh],
    add(id: string, c: Cloud) {
      puffs.set(id, { x: c.x0, y: c.y0, tick: c.tick0, tick0: c.tick0, kind: c.kind });
    },
    remove(id: string) { puffs.delete(id); },
    /** `clock`: the server's sim time in fractional ticks, smoothed (timeline.ts). */
    update(clock: number, time: number, focus: number) {
      const tick = Math.floor(clock);
      let i = 0;
      let j = 0;
      for (const p of puffs.values()) {
        if (i >= CAPACITY || j >= 64) break;
        drift(p, tick);
        currentAt(p.x, p.y, tick * TICK_DT, flow);
        const age = (clock - p.tick0) * TICK_DT;
        const ahead = (clock - p.tick) * TICK_DT; // drift steps every DRIFT_TICKS: glide since the last step
        const layer = p.kind === INK ? ink : sprites;
        const k = p.kind === INK ? j++ : i++;
        layer.offsets[k * 3] = p.x + flow.x * ahead;
        layer.offsets[k * 3 + 1] = p.y + flow.y * ahead;
        layer.offsets[k * 3 + 2] = 0;
        layer.sizes[k] = 2 * cloudRadius(p.kind, age);
        layer.seeds[k] = p.kind + Math.min(0.999, age / TOXINS[p.kind]!.life);
      }
      sprites.commit(i);
      sprites.setFrame(time, focus);
      ink.commit(j);
      ink.setFrame(time, focus);
    },
  };
}
