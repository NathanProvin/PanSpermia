import { NUTRIENT_CAP, type Nutrient, NutrientKind, SEEP_COUNT, TICK_DT, currentAt, drift } from '@panspermia/shared';
import { createSprites } from './sprites.ts';

// Food in the focal plane. Dissolved packets: green motes (Spore's plant food); debris: ragged red
// chunks (its meat); seeps: soft glows just below the plane where plumes rise. Bright cores bloom.
// Kind rides in the integer part of aSeed (2 = seep), the per-sprite random seed in the fraction.
const FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
void main() {
  float kind = floor(vSeed);
  float seed = fract(vSeed);
  vec2 p = vUv * 2.0 - 1.0;
  float r2 = dot(p, p);
  float pulse = 0.8 + 0.2 * sin(uTime * 2.2 + seed * 30.0);
  vec3 color;
  if (kind < 0.5) {
    float core = exp(-r2 * 28.0) * 2.4;
    float halo = exp(-r2 * 5.0) * 0.35 * (1.0 - smoothstep(0.7, 1.0, sqrt(r2)));
    color = vec3(0.78, 1.0, 0.42) * (core + halo) * pulse;
  } else if (kind < 1.5) {
    float a = atan(p.y, p.x);
    float edge = 0.45 + 0.12 * sin(a * 5.0 + seed * 40.0) + 0.08 * sin(a * 11.0 - seed * 17.0);
    float chunk = 1.0 - smoothstep(edge - 0.08, edge, sqrt(r2));
    float glow = exp(-r2 * 6.0) * 0.3;
    color = vec3(1.0, 0.32, 0.18) * (chunk * 1.6 + glow) * (0.9 + 0.1 * pulse);
  } else {
    float breathe = 0.75 + 0.25 * sin(uTime * 0.6 + seed * 6.0);
    color = vec3(0.35, 0.9, 0.55) * exp(-r2 * 3.5) * 0.22 * breathe;
  }
  gl_FragColor = vec4(color, 1.0);
}
`;
const SIZE = { [NutrientKind.dissolved]: 16, [NutrientKind.debris]: 22 } as Record<number, number>;
const SEEP_SIZE = 260;
const SEEP_DEPTH = -15;

interface Packet { x: number; y: number; tick: number; kind: number; seed: number }

export function createNutrients() {
  const sprites = createSprites(NUTRIENT_CAP + SEEP_COUNT, FRAGMENT, 5);
  const packets = new Map<string, Packet>();
  const flow = { x: 0, y: 0 };

  return {
    objects: [sprites.mesh],
    /** Mirror a synced packet; its path is rebuilt locally by `drift`, never synced. */
    add(id: string, n: Nutrient) {
      packets.set(id, { x: n.x0, y: n.y0, tick: n.tick0, kind: n.kind, seed: (Number(id) * 0.618034) % 1 });
    },
    remove(id: string) { packets.delete(id); },
    /**
     * `tick` is the latest server tick; `sinceTick` the seconds elapsed locally since it arrived,
     * used to glide packets along the current between 20 Hz ticks.
     */
    update(tick: number, sinceTick: number, seeps: Iterable<{ x: number; y: number }>, time: number, focus: number) {
      const glide = Math.min(sinceTick, TICK_DT * 1.5);
      let i = 0;
      for (const p of packets.values()) {
        if (i >= NUTRIENT_CAP) break;
        drift(p, tick); // a joining client catches each packet up from its spawn tick here
        currentAt(p.x, p.y, tick * TICK_DT, flow);
        sprites.offsets[i * 3] = p.x + flow.x * glide;
        sprites.offsets[i * 3 + 1] = p.y + flow.y * glide;
        sprites.offsets[i * 3 + 2] = 0;
        sprites.sizes[i] = SIZE[p.kind] ?? 16;
        sprites.seeds[i] = p.kind + p.seed;
        i++;
      }
      let s = 0;
      for (const seep of seeps) {
        sprites.offsets[i * 3] = seep.x;
        sprites.offsets[i * 3 + 1] = seep.y;
        sprites.offsets[i * 3 + 2] = SEEP_DEPTH;
        sprites.sizes[i] = SEEP_SIZE;
        sprites.seeds[i] = 2 + (s++ * 0.37) % 1;
        i++;
      }
      sprites.commit(i);
      sprites.setFrame(time, focus);
    },
  };
}
