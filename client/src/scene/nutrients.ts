import { NUTRIENT_CAP, type Nutrient, NutrientKind, SEEP_COUNT, TICK_DT, currentAt, drift } from '@panspermia/shared';
import { createSprites } from './sprites.ts';

// Drifting packets in the focal plane, in one colour code: food is white (dissolved motes, algae cells,
// ragged debris, big meat chunks of a dead eukaryote), bonuses are green (DNA fragments as short double
// helices, plasmids as rings of circular DNA, meteor shards as glinting crystals), dangers are red
// (phages: heads on a tail with splayed fibres; giant viruses: furred capsids). Seeps are white glows just
// below the plane where plumes of food rise. Bright cores bloom.
// Kind rides in the integer part of aSeed (9 = seep), the per-sprite random seed in the fraction.
const FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
float segment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  return length(p - a - ab * clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0));
}
vec2 rotate(vec2 p, float a) { return vec2(cos(a) * p.x - sin(a) * p.y, sin(a) * p.x + cos(a) * p.y); }
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
    color = vec3(0.95, 1.0, 0.95) * (core + halo) * pulse; // food: white
  } else if (kind < 1.5) {
    float a = atan(p.y, p.x);
    float edge = 0.45 + 0.12 * sin(a * 5.0 + seed * 40.0) + 0.08 * sin(a * 11.0 - seed * 17.0);
    float chunk = 1.0 - smoothstep(edge - 0.08, edge, sqrt(r2));
    float glow = exp(-r2 * 6.0) * 0.3;
    color = vec3(1.0, 0.95, 0.86) * (chunk * 1.3 + glow) * (0.9 + 0.1 * pulse); // food: white
  } else if (kind < 2.5) {
    vec2 q = rotate(p, seed * 6.2831 + uTime * 0.3);
    float phase = q.x * 7.0 + uTime * 1.5;
    float span = 1.0 - smoothstep(0.6, 0.75, abs(q.x));
    float strands = exp(-pow((q.y - 0.2 * sin(phase)) / 0.06, 2.0)) + exp(-pow((q.y + 0.2 * sin(phase)) / 0.06, 2.0));
    float rungs = step(abs(q.y), 0.2 * abs(sin(phase))) * smoothstep(0.7, 0.95, cos(q.x * 40.0));
    color = vec3(0.3, 1.0, 0.4) * (strands * 1.3 + rungs * 0.6 + exp(-r2 * 4.0) * 0.15) * span;
  } else if (kind < 3.5) {
    float a = atan(p.y, p.x) + uTime * 0.4;
    float ringR = 0.55 + 0.05 * sin(a * 2.0 + uTime); // a hint of supercoiling
    float ring = exp(-pow((sqrt(r2) - ringR) / 0.06, 2.0));
    float genes = ring * smoothstep(0.6, 0.9, sin(a * 6.0 + seed * 20.0));
    color = vec3(0.45, 1.0, 0.35) * (ring * 1.4 + genes * 1.5 + exp(-r2 * 3.0) * 0.25) * pulse;
  } else if (kind < 4.5) {
    vec2 q = rotate(p, seed * 6.2831 + 0.4 * sin(uTime * 0.7 + seed * 9.0));
    vec2 h = q - vec2(0.0, 0.32);
    float head = max(abs(h.y) * 0.866 + abs(h.x) * 0.5, abs(h.x)) - 0.26; // pointy-topped hexagon
    float d = min(abs(head), segment(q, vec2(0.0, 0.08), vec2(0.0, -0.4)));
    d = min(d, min(segment(q, vec2(0.0, -0.4), vec2(-0.32, -0.72)), segment(q, vec2(0.0, -0.4), vec2(0.32, -0.72))));
    d = min(d, min(segment(q, vec2(0.0, -0.4), vec2(-0.12, -0.78)), segment(q, vec2(0.0, -0.4), vec2(0.12, -0.78))));
    float fill = (1.0 - smoothstep(-0.02, 0.0, head)) * 0.25; // packed genome inside the capsid
    color = vec3(1.0, 0.3, 0.25) * (exp(-pow(d / 0.035, 2.0)) * 1.5 + fill); // danger: red
  } else if (kind < 5.5) {
    vec2 q = rotate(p, seed * 6.2831);
    float body = length(q * vec2(1.0, 1.25));
    float cell = 1.0 - smoothstep(0.62, 0.7, body);
    float rim = cell * smoothstep(0.45, 0.68, body);
    float plastids = smoothstep(0.55, 0.85, sin(q.x * 9.0 + seed * 20.0) * sin(q.y * 8.0 - seed * 11.0)) * cell;
    color = vec3(0.9, 0.95, 0.88) * (cell * 0.35 + rim * 0.8) + vec3(1.0) * plastids * 0.6; // food: white
  } else if (kind < 6.5) {
    float a = atan(p.y, p.x);
    float edge = 0.55 + 0.1 * sin(a * 4.0 + seed * 40.0) + 0.07 * sin(a * 9.0 - seed * 17.0);
    float chunk = 1.0 - smoothstep(edge - 0.06, edge, sqrt(r2));
    float inner = smoothstep(edge - 0.25, edge - 0.05, sqrt(r2));
    color = vec3(0.9, 0.86, 0.78) * chunk * (0.5 + 0.9 * inner) + vec3(1.0) * exp(-r2 * 5.0) * 0.12; // food: white
  } else if (kind < 7.5) {
    // A meteor shard: a faceted, glinting crystal shard (Spore's meteor bits) — the rare tier-2 prize.
    vec2 q = rotate(p, seed * 6.2831 + uTime * 0.5);
    float facet = max(abs(q.x) * 0.9 + abs(q.y) * 0.45, abs(q.y) * 1.2);
    float shard = 1.0 - smoothstep(0.42, 0.48, facet);
    float glint = pow(max(0.0, sin(uTime * 3.0 + seed * 20.0)), 8.0);
    color = mix(vec3(0.3, 1.0, 0.45), vec3(0.75, 1.0, 0.6), smoothstep(-0.4, 0.4, q.x)) * shard * (1.0 + glint)
      + vec3(1.0, 0.9, 0.7) * exp(-r2 * 6.0) * 0.4 * pulse;
  } else if (kind < 8.5) {
    // A giant virus: a big icosahedral capsid furred with fibres (like mimivirus), slowly turning.
    vec2 q = rotate(p, seed * 6.2831 + uTime * 0.2);
    float hex = max(abs(q.y) * 0.866 + abs(q.x) * 0.5, abs(q.x));
    float capsid = 1.0 - smoothstep(0.42, 0.46, hex);
    float shell = capsid * smoothstep(0.3, 0.44, hex);
    float a = atan(q.y, q.x);
    float fur = (1.0 - capsid) * (1.0 - smoothstep(0.46, 0.66, hex)) * smoothstep(0.5, 0.9, sin(a * 40.0 + seed * 9.0));
    color = vec3(1.0, 0.32, 0.26) * (shell * 1.3 + capsid * 0.25 + fur * 0.7) + vec3(0.9, 0.2, 0.15) * exp(-r2 * 3.0) * 0.12; // danger: red
  } else {
    float breathe = 0.75 + 0.25 * sin(uTime * 0.6 + seed * 6.0);
    color = vec3(0.85, 0.92, 0.88) * exp(-r2 * 3.5) * 0.2 * breathe; // a food source: white
  }
  gl_FragColor = vec4(color, 1.0);
}
`;
const SIZE: Record<number, number> = {
  [NutrientKind.dissolved]: 16, [NutrientKind.debris]: 22, [NutrientKind.fragment]: 20, [NutrientKind.plasmid]: 30,
  [NutrientKind.phage]: 26, [NutrientKind.algae]: 34, [NutrientKind.chunk]: 42, [NutrientKind.shard]: 36, [NutrientKind.virus]: 44,
};
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
        const ahead = (tick - p.tick) * TICK_DT + glide; // drift steps every DRIFT_TICKS: glide since the last step
        sprites.offsets[i * 3] = p.x + flow.x * ahead;
        sprites.offsets[i * 3 + 1] = p.y + flow.y * ahead;
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
        sprites.seeds[i] = 9 + (s++ * 0.37) % 1;
        i++;
      }
      sprites.commit(i);
      sprites.setFrame(time, focus);
    },
  };
}
