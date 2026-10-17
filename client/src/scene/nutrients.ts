import { NUTRIENT_CAP, type Nutrient, NutrientKind, SEEP_COUNT, TICK_DT, TICK_RATE, currentAt, drift } from '@panspermia/shared';
import { createSprites } from './sprites.ts';

// Drifting packets in the focal plane, in one colour code: food is white (dissolved motes, algae cells,
// ragged debris, big meat chunks of a dead eukaryote), bonuses are green (DNA fragments as short double
// helices, plasmids as rings of circular DNA, meteor shards as glinting crystals), dangers are red
// (phages: heads on a tail with splayed fibres; giant viruses: furred capsids). Seeps are white glows just
// below the plane where plumes of food rise. Kept below the bloom threshold: they read, they don't glare.
// Kind rides in the integer part of aSeed (9 = seep), the per-sprite random seed in the fraction.
const FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uFocus;
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
    float core = exp(-r2 * 28.0) * 1.1;
    float halo = exp(-r2 * 5.0) * 0.18 * (1.0 - smoothstep(0.7, 1.0, sqrt(r2)));
    color = vec3(0.95, 1.0, 0.95) * (core + halo) * pulse; // food: white
  } else if (kind < 1.5) {
    float a = atan(p.y, p.x);
    float edge = 0.45 + 0.12 * sin(a * 5.0 + seed * 40.0) + 0.08 * sin(a * 11.0 - seed * 17.0);
    float chunk = 1.0 - smoothstep(edge - 0.08, edge, sqrt(r2));
    float glow = exp(-r2 * 6.0) * 0.3;
    color = vec3(1.0, 0.95, 0.86) * (chunk * 0.85 + glow * 0.6) * (0.9 + 0.1 * pulse); // food: white
  } else if (kind < 2.5) {
    vec2 q = rotate(p, seed * 6.2831 + uTime * 0.3);
    float phase = q.x * 7.0 + uTime * 1.5;
    float span = 1.0 - smoothstep(0.6, 0.75, abs(q.x));
    float strands = exp(-pow((q.y - 0.2 * sin(phase)) / 0.06, 2.0)) + exp(-pow((q.y + 0.2 * sin(phase)) / 0.06, 2.0));
    float rungs = step(abs(q.y), 0.2 * abs(sin(phase))) * smoothstep(0.7, 0.95, cos(q.x * 40.0));
    color = vec3(0.3, 1.0, 0.4) * (strands * 0.8 + rungs * 0.4 + exp(-r2 * 4.0) * 0.08) * span;
  } else if (kind < 3.5) {
    float a = atan(p.y, p.x) + uTime * 0.4;
    float ringR = 0.55 + 0.05 * sin(a * 2.0 + uTime); // a hint of supercoiling
    float ring = exp(-pow((sqrt(r2) - ringR) / 0.06, 2.0));
    float genes = ring * smoothstep(0.6, 0.9, sin(a * 6.0 + seed * 20.0));
    color = vec3(0.45, 1.0, 0.35) * (ring * 0.8 + genes * 0.8 + exp(-r2 * 3.0) * 0.12) * pulse;
  } else if (kind < 4.5) {
    vec2 q = rotate(p, seed * 6.2831 + 0.4 * sin(uTime * 0.7 + seed * 9.0));
    vec2 h = q - vec2(0.0, 0.32);
    float head = max(abs(h.y) * 0.866 + abs(h.x) * 0.5, abs(h.x)) - 0.26; // pointy-topped hexagon
    float d = min(abs(head), segment(q, vec2(0.0, 0.08), vec2(0.0, -0.4)));
    d = min(d, min(segment(q, vec2(0.0, -0.4), vec2(-0.32, -0.72)), segment(q, vec2(0.0, -0.4), vec2(0.32, -0.72))));
    d = min(d, min(segment(q, vec2(0.0, -0.4), vec2(-0.12, -0.78)), segment(q, vec2(0.0, -0.4), vec2(0.12, -0.78))));
    float fill = (1.0 - smoothstep(-0.02, 0.0, head)) * 0.25; // packed genome inside the capsid
    color = vec3(1.0, 0.3, 0.25) * (exp(-pow(d / 0.035, 2.0)) * 0.9 + fill); // danger: red
  } else if (kind < 5.5) {
    vec2 q = rotate(p, seed * 6.2831);
    float body = length(q * vec2(1.0, 1.25));
    float cell = 1.0 - smoothstep(0.62, 0.7, body);
    float rim = cell * smoothstep(0.45, 0.68, body);
    float plastids = smoothstep(0.55, 0.85, sin(q.x * 9.0 + seed * 20.0) * sin(q.y * 8.0 - seed * 11.0)) * cell;
    color = vec3(0.9, 0.95, 0.88) * (cell * 0.3 + rim * 0.6) + vec3(1.0) * plastids * 0.4; // food: white
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
    color = mix(vec3(0.3, 1.0, 0.45), vec3(0.75, 1.0, 0.6), smoothstep(-0.4, 0.4, q.x)) * shard * (0.7 + 0.5 * glint)
      + vec3(1.0, 0.9, 0.7) * exp(-r2 * 6.0) * 0.18 * pulse;
  } else if (kind < 8.5) {
    // A giant virus: a big icosahedral capsid furred with fibres (like mimivirus), slowly turning.
    vec2 q = rotate(p, seed * 6.2831 + uTime * 0.2);
    float hex = max(abs(q.y) * 0.866 + abs(q.x) * 0.5, abs(q.x));
    float capsid = 1.0 - smoothstep(0.42, 0.46, hex);
    float shell = capsid * smoothstep(0.3, 0.44, hex);
    float a = atan(q.y, q.x);
    float fur = (1.0 - capsid) * (1.0 - smoothstep(0.46, 0.66, hex)) * smoothstep(0.5, 0.9, sin(a * 40.0 + seed * 9.0));
    color = vec3(1.0, 0.32, 0.26) * (shell * 0.9 + capsid * 0.2 + fur * 0.5) + vec3(0.9, 0.2, 0.15) * exp(-r2 * 3.0) * 0.12; // danger: red
  } else {
    float breathe = 0.75 + 0.25 * sin(uTime * 0.6 + seed * 6.0);
    color = vec3(0.8, 0.74, 0.58) * exp(-r2 * 3.5) * 0.1 * breathe; // a food source: a soft warm glow
  }
  // Seen from high up (big bodies), a plume's ~60 packets pile up additively into a white bloom: dim them with height.
  color *= mix(1.0, 0.4, smoothstep(1500.0, 6500.0, uFocus));
  gl_FragColor = vec4(color, 1.0);
}
`;
const SIZE: Record<number, number> = {
  [NutrientKind.dissolved]: 16, [NutrientKind.debris]: 22, [NutrientKind.fragment]: 20, [NutrientKind.plasmid]: 30,
  [NutrientKind.phage]: 26, [NutrientKind.algae]: 34, [NutrientKind.chunk]: 42, [NutrientKind.shard]: 36, [NutrientKind.virus]: 44,
};
const SEEP_SIZE = 260;
const SEEP_DEPTH = -15;

/** `fx`, `fy`: the current where it was after its last drift (it glides on it until the next); flowTick < 0: none yet. */
interface Packet { x: number; y: number; tick: number; kind: number; seed: number; fx: number; fy: number; flowTick: number }
/** World units beyond the view edge still drawn (the biggest sprite is a seep glow). */
const VIEW_MARGIN = SEEP_SIZE;
/**
 * Every packet drifts lazily on its own period (catch-ups spread over frames by its seed; `drift` catches up
 * exactly from the packet's own tick, so skipping steps costs no accuracy). One in view: every 1–2 × NEAR_TICKS,
 * gliding on its last flow in between (over 0.8 s the change in current moves it ~1 unit). One off-screen: only once its stale
 * position could have drifted into the drawn area — the current moves it at most MAX_CURRENT u/s
 * (Σ amplitude·|k| ≈ 60), so a packet d units outside can wait d / MAX_CURRENT seconds.
 */
const NEAR_TICKS = 8;
const MAX_CURRENT = 65;

export function createNutrients() {
  const sprites = createSprites(NUTRIENT_CAP + SEEP_COUNT, FRAGMENT, 5);
  const packets = new Map<string, Packet>();
  const flow = { x: 0, y: 0 };

  return {
    /** Dev: the mirrored packets (console inspection). */
    packets,
    objects: [sprites.mesh],
    /** Mirror a synced packet; its path is rebuilt locally by `drift`, never synced. */
    add(id: string, n: Nutrient) {
      packets.set(id, { x: n.x0, y: n.y0, tick: n.tick0, kind: n.kind, seed: (Number(id) * 0.618034) % 1, fx: 0, fy: 0, flowTick: -1 });
    },
    /** Forget a packet; returns where it was last drawn (a cell eating it gets a gulp there). */
    remove(id: string) {
      const p = packets.get(id);
      packets.delete(id);
      return p && { x: p.x, y: p.y };
    },
    /**
     * `tick` is the latest server tick; `sinceTick` the seconds elapsed locally since it arrived,
     * used to glide packets along the current between 20 Hz ticks. Only packets within `view` (centre and
     * half extents on the gameplay plane) are drawn; packets drift lazily (NEAR_TICKS, LAZY_TICKS).
     */
    update(
      tick: number, sinceTick: number, seeps: Iterable<{ x: number; y: number }>, time: number, focus: number,
      view: { x: number; y: number; halfW: number; halfH: number },
    ) {
      const glide = Math.min(sinceTick, TICK_DT * 1.5);
      const halfW = view.halfW + VIEW_MARGIN;
      const halfH = view.halfH + VIEW_MARGIN;
      let i = 0;
      for (const p of packets.values()) {
        const out = Math.max(Math.abs(p.x - view.x) - halfW, Math.abs(p.y - view.y) - halfH); // > 0: off the drawn area
        const period = out > 0 ? (out / MAX_CURRENT) * TICK_RATE * (0.5 + 0.5 * p.seed) : NEAR_TICKS * (1 + p.seed);
        if (p.flowTick < 0 || tick - p.tick >= period) {
          drift(p, tick); // a joining client catches each packet up from its spawn tick here
          currentAt(p.x, p.y, p.tick * TICK_DT, flow);
          p.fx = flow.x; // plain stores: no array per packet (garbage in a hot loop)
          p.fy = flow.y;
          p.flowTick = p.tick;
        }
        if (out > 0 || i >= NUTRIENT_CAP) continue;
        const ahead = (tick - p.tick) * TICK_DT + glide; // glide on its flow since its last drift step
        sprites.offsets[i * 3] = p.x + p.fx * ahead;
        sprites.offsets[i * 3 + 1] = p.y + p.fy * ahead;
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
