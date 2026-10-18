import { NUTRIENT_CAP, NUTRIENT_LIFETIME, type Nutrient, NutrientKind, SEEP_COUNT, TICK_DT, TICK_RATE, currentAt, drift } from '@panspermia/shared';
import { createSprites } from './sprites.ts';

// Drifting packets in the focal plane, in one colour code: food is white or plant-coloured (dissolved motes, ragged
// debris, big meat chunks of a dead eukaryote; algae leafy green, cyanobacteria filaments green, fungal hyphae yellow),
// dangers are red (phages: heads on a tail with splayed fibres; giant viruses: furred capsids). DNA is mossy green like
// the HUD's helix (fragments, plasmids, meteor shards), in its own layer drawn as matter (DNA_FRAGMENT), growing with
// the camera's height a little (smaller and fainter again from the animal phases' heights). Seeps are warm glows just below the plane where plumes of food
// rise. Kept below the bloom threshold: they read, they don't glare.
// Kind rides in the integer part of aSeed (15 = seep), the per-sprite random seed in the fraction.
const FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uFocus;
varying vec2 vUv;
varying float vSeed;
float h(float seed, float n) { return fract(sin(seed * 91.7 + n * 13.13) * 43758.5453); } // per-packet random numbers
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
    color = vec3(0.5, 0.86, 0.3) * (cell * 0.35 + rim * 0.6) + vec3(0.75, 1.0, 0.5) * plastids * 0.4; // algae: leafy green
  } else if (kind < 6.5) {
    float a = atan(p.y, p.x);
    float edge = 0.55 + 0.1 * sin(a * 4.0 + seed * 40.0) + 0.07 * sin(a * 9.0 - seed * 17.0);
    float chunk = 1.0 - smoothstep(edge - 0.06, edge, sqrt(r2));
    float inner = smoothstep(edge - 0.25, edge - 0.05, sqrt(r2));
    color = vec3(0.9, 0.86, 0.78) * chunk * (0.5 + 0.9 * inner) + vec3(1.0) * exp(-r2 * 5.0) * 0.12; // food: white
  } else if (kind < 8.5) {
    // A giant virus: a big icosahedral capsid furred with fibres (like mimivirus), slowly turning.
    vec2 q = rotate(p, seed * 6.2831 + uTime * 0.2);
    float hex = max(abs(q.y) * 0.866 + abs(q.x) * 0.5, abs(q.x));
    float capsid = 1.0 - smoothstep(0.42, 0.46, hex);
    float shell = capsid * smoothstep(0.3, 0.44, hex);
    float a = atan(q.y, q.x);
    float fur = (1.0 - capsid) * (1.0 - smoothstep(0.46, 0.66, hex)) * smoothstep(0.5, 0.9, sin(a * 40.0 + seed * 9.0));
    color = vec3(1.0, 0.32, 0.26) * (shell * 0.9 + capsid * 0.2 + fur * 0.5) + vec3(0.9, 0.2, 0.15) * exp(-r2 * 3.0) * 0.12; // danger: red
  } else if (kind < 9.5) {
    // Cyanobacteria: a trichome — a chain of green cells with one larger, paler heterocyst. Each one its own length,
    // curl and waviness (from its seed).
    float len = 0.35 + 0.55 * h(seed, 1.0);
    vec2 q = rotate(p, seed * 6.2831 + 0.15 * sin(uTime * 0.5 + seed * 7.0));
    float off = q.y - (0.04 + 0.16 * h(seed, 2.0)) * sin(q.x * (2.0 + 4.0 * h(seed, 3.0)) + seed * 11.0 + uTime * 0.6)
      - 0.25 * (h(seed, 4.0) - 0.5) * q.x * q.x; // a gentle arc
    float idx = floor(q.x * 6.0 + 0.5);
    float local = (q.x * 6.0 - idx) / 6.0;
    float hetero = step(abs(idx - floor((h(seed, 5.0) - 0.5) * len * 10.0)), 0.5);
    float cr = mix(0.072, 0.095, hetero);
    float d = length(vec2(local * 1.15, off)) - cr;
    float cell = (1.0 - smoothstep(-0.012, 0.012, d)) * (1.0 - step(len, abs(q.x)));
    float rim = cell * smoothstep(-0.04, 0.0, d);
    color = mix(vec3(0.18, 0.78, 0.26), vec3(0.75, 0.9, 0.4), hetero) * (cell * 0.6 + rim * 0.5); // green: cyanobacteria
  } else if (kind < 10.5) {
    // Fungal hyphae: a thin yellow thread of mycelium with septa and swollen tips, branching once to three times —
    // each one its own length, kinks and branches (from its seed).
    vec2 q = rotate(p, seed * 6.2831);
    float len = 0.5 + 0.38 * h(seed, 1.0);
    vec2 a0 = vec2(-len, 0.25 * (h(seed, 2.0) - 0.5));
    vec2 a1 = vec2(-0.35 + 0.3 * h(seed, 3.0), 0.3 * (h(seed, 4.0) - 0.5));
    vec2 a2 = vec2(0.15 + 0.3 * h(seed, 5.0), 0.3 * (h(seed, 6.0) - 0.5));
    vec2 a3 = vec2(len, 0.25 * (h(seed, 7.0) - 0.5));
    float s1 = h(seed, 8.0) < 0.5 ? 1.0 : -1.0;
    vec2 b1 = a1 + vec2(0.2 + 0.3 * h(seed, 9.0), s1 * (0.35 + 0.3 * h(seed, 10.0)));
    vec2 b2 = a2 + vec2(0.15 + 0.3 * h(seed, 11.0), -s1 * (0.3 + 0.3 * h(seed, 12.0)));
    vec2 b3 = mix(a1, b1, 0.55) + vec2(-0.2 + 0.4 * h(seed, 13.0), s1 * 0.3);
    float two = step(0.35, h(seed, 14.0));
    float three = step(0.6, h(seed, 15.0));
    float d = min(min(segment(q, a0, a1), segment(q, a1, a2)), segment(q, a2, a3));
    d = min(d, segment(q, a1, b1));
    d = min(d, mix(1e3, segment(q, a2, b2), two));
    d = min(d, mix(1e3, segment(q, mix(a1, b1, 0.55), b3), three));
    float thread = exp(-pow(d / 0.022, 2.0));
    float tips = exp(-dot(q - a0, q - a0) / 0.003) + exp(-dot(q - a3, q - a3) / 0.003) + exp(-dot(q - b1, q - b1) / 0.003)
      + two * exp(-dot(q - b2, q - b2) / 0.003) + three * exp(-dot(q - b3, q - b3) / 0.003);
    float septa = thread * smoothstep(0.8, 0.98, sin((q.x + q.y) * 40.0));
    color = vec3(1.0, 0.86, 0.28) * (thread * 0.75 + tips * 0.6 + septa * 0.3); // yellow: mycelium
  } else {
    float breathe = 0.75 + 0.25 * sin(uTime * 0.6 + seed * 6.0);
    color = vec3(0.8, 0.74, 0.58) * exp(-r2 * 3.5) * 0.1 * breathe; // a food source: a soft warm glow
  }
  // Seen from high up (big bodies), a plume's ~60 packets pile up additively into a white bloom: dim them with height.
  color *= mix(1.0, 0.35, smoothstep(700.0, 3000.0, uFocus));
  gl_FragColor = vec4(color, 1.0);
}
`;
// DNA (fragments, plasmids, meteor shards) is drawn as matter, not light (user: really mossy green — added light only
// ever reads pale on the bright sand): saturated mossy strands with a lit edge and a soft green halo, on any background.
const DNA_FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
uniform float uFade;
vec2 rotate(vec2 p, float a) { return vec2(cos(a) * p.x - sin(a) * p.y, sin(a) * p.x + cos(a) * p.y); }
void main() {
  float kind = floor(vSeed);
  float seed = fract(vSeed);
  vec2 p = vUv * 2.0 - 1.0;
  float r2 = dot(p, p);
  float r = sqrt(r2);
  vec3 moss = vec3(0.17, 0.36, 0.035);
  vec3 lit = vec3(0.42, 0.66, 0.12);
  float body = 0.0;
  float light = 0.0;
  float halo = 0.0;
  if (kind < 2.5) { // a fragment: a short double helix
    vec2 q = rotate(p, seed * 6.2831 + uTime * 0.3);
    float phase = q.x * 7.0 + uTime * 1.5;
    float span = 1.0 - smoothstep(0.6, 0.75, abs(q.x));
    float s1 = exp(-pow((q.y - 0.2 * sin(phase)) / 0.07, 2.0));
    float s2 = exp(-pow((q.y + 0.2 * sin(phase)) / 0.07, 2.0));
    float rungs = step(abs(q.y), 0.2 * abs(sin(phase))) * smoothstep(0.7, 0.95, cos(q.x * 40.0));
    body = max(max(s1, s2), rungs * 0.7) * span;
    light = s1 * span * 0.6;
    halo = exp(-r2 * 3.0) * 0.25;
  } else if (kind < 3.5) { // a plasmid: a supercoiled ring of double-stranded DNA, slowly turning, one gene lit
    float a = atan(p.y, p.x) + uTime * 0.35 + seed * 6.2831;
    float ringR = 0.5 + 0.04 * sin(a * 2.0 + uTime * 0.8);
    float tw = sin(a * 9.0 + uTime * 1.2);
    float s1 = exp(-pow((r - ringR - 0.08 * tw) / 0.05, 2.0));
    float s2 = exp(-pow((r - ringR + 0.08 * tw) / 0.05, 2.0));
    float pairs = (1.0 - smoothstep(0.0, 0.08 * abs(tw) + 0.01, abs(r - ringR))) * smoothstep(0.6, 0.95, cos(a * 36.0));
    float gene = smoothstep(0.6, 0.95, sin(a + seed * 20.0));
    body = max(max(s1, s2), pairs * 0.8);
    light = max(s1, s2) * (0.25 + 0.75 * gene) * smoothstep(0.2, -0.6, p.x + p.y); // the lit upper-left, the gene
    halo = exp(-pow((r - ringR) / 0.24, 2.0)) * 0.3;
  } else { // a meteor shard: a faceted crystal, glinting
    vec2 q = rotate(p, seed * 6.2831 + uTime * 0.5);
    float facet = max(abs(q.x) * 0.9 + abs(q.y) * 0.45, abs(q.y) * 1.2);
    body = 1.0 - smoothstep(0.42, 0.48, facet);
    light = body * (smoothstep(-0.1, 0.4, q.x) * 0.6 + pow(max(0.0, sin(uTime * 3.0 + seed * 20.0)), 8.0));
    halo = exp(-r2 * 4.0) * 0.3;
  }
  float a = clamp(body * 0.95 + halo * (1.0 - body), 0.0, 1.0);
  vec3 col = mix(moss, lit, clamp(light, 0.0, 1.0)) * body + vec3(0.3, 0.55, 0.1) * halo * (1.0 - body);
  gl_FragColor = vec4(col, a) * uFade; // premultiplied; fainter from an animal's height
}
`;
// The phases' plants (user direction: grazing for herbivores), drawn as matter like DNA so they read as solid organisms
// at any height: spirulina (eukaryotes: a vivid turquoise corkscrew of cells), diatoms (plankton: glassy silica
// frustules, round or boat-shaped, golden-brown chloroplasts inside), dinoflagellates (plankton: armoured red-orange
// cells, three-horned or round, a girdle groove and a trailing flagellum) and macroalgae (animals: an olive kelp of
// long blades with air bladders, a bright ruffled sea lettuce, or crimson branching red fronds). Each one's shape comes
// from its seed; a new plant grows in and an old one shrinks away (its size, see update). A plant fades in with the camera's
// height: a phase sees its own plants, and the next phase's appearing as it grows — never a kelp blade filling a
// bacterium's screen.
const FLORA_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uFocus;
varying vec2 vUv;
varying float vSeed;
vec2 rotate(vec2 p, float a) { return vec2(cos(a) * p.x - sin(a) * p.y, sin(a) * p.x + cos(a) * p.y); }
float h(float seed, float n) { return fract(sin(seed * 91.7 + n * 13.13) * 43758.5453); }
float segment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  return length(p - a - ab * clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0));
}
void main() {
  float kind = floor(vSeed);
  float seed = fract(vSeed);
  vec2 p = vUv * 2.0 - 1.0;
  float aa = length(fwidth(p)) * 1.2;
  vec3 col = vec3(0.0);
  float a = 0.0;
  if (kind < 11.5) {
    // Spirulina: a corkscrew filament, its turns lit on the near side, septa between the cells.
    vec2 q = rotate(p, seed * 6.2831 + 0.1 * sin(uTime * 0.4 + seed * 5.0));
    float len = 0.55 + 0.35 * h(seed, 1.0);
    float k = 13.0 + 7.0 * h(seed, 2.0);
    float ph = q.x * k + uTime * 0.8 + seed * 20.0;
    float amp = 0.12 + 0.06 * h(seed, 3.0);
    float bowY = 0.2 * (h(seed, 4.0) - 0.5) * q.x * q.x;
    float d = abs(q.y - bowY - amp * sin(ph)) - (0.045 + 0.015 * cos(ph));
    float body = (1.0 - smoothstep(-aa, aa, d)) * (1.0 - smoothstep(len - 0.03, len, abs(q.x)));
    float near = 0.5 + 0.5 * cos(ph);
    float septa = smoothstep(0.85, 1.0, cos(q.x * 70.0));
    col = mix(vec3(0.02, 0.38, 0.42), vec3(0.2, 0.9, 0.82), near) * (1.0 - 0.35 * septa);
    a = body * 0.95;
  } else if (kind < 12.5) {
    // A diatom: a glassy frustule — round (centric: radial rows of pores) or a boat (pennate: a central raphe, ribs).
    vec2 q = rotate(p, seed * 6.2831 + uTime * 0.05);
    float centric = step(0.5, h(seed, 1.0));
    float r = length(q);
    float ang = atan(q.y, q.x);
    float boat = length(q * vec2(1.0, 2.6 + 1.4 * h(seed, 2.0)));
    float shape = mix(boat, r * 1.2, centric) - 0.62;
    float body = 1.0 - smoothstep(-aa, aa, shape);
    float rim = smoothstep(-0.12, -0.02, shape) * body;
    float pores = mix(smoothstep(0.55, 0.9, cos(q.x * 55.0)), smoothstep(0.5, 0.9, cos(ang * 36.0)) * smoothstep(0.08, 0.2, r), centric);
    float raphe = (1.0 - centric) * (1.0 - smoothstep(0.0, 0.015, abs(q.y))) * step(abs(q.x), 0.5);
    float plastid = smoothstep(0.25, 0.75, sin(q.x * 5.0 + seed * 9.0) * sin(q.y * 7.0 + seed * 4.0) + 0.3) * smoothstep(-0.05, -0.2, shape);
    col = mix(vec3(0.72, 0.78, 0.7), vec3(0.62, 0.42, 0.1), plastid * 0.85) * (1.0 - 0.25 * pores) + rim * 0.35 - raphe * 0.3;
    a = body * mix(0.55, 0.92, max(rim, plastid));
  } else if (kind < 13.5) {
    // A dinoflagellate: an armoured theca in red-orange plates around a girdle groove, horns (Ceratium) or round
    // (Peridinium), a flagellum trailing in waves.
    vec2 q = rotate(p, seed * 6.2831 + 0.2 * sin(uTime * 0.7 + seed * 7.0));
    float horned = step(0.45, h(seed, 1.0));
    float cell = length(q * vec2(1.0, 1.15)) - 0.36;
    float horns = min(segment(q, vec2(0.0, 0.2), vec2(0.0, 0.85)) - 0.07 * (1.0 - smoothstep(0.2, 0.85, q.y)) - 0.02,
      min(segment(q, vec2(-0.1, -0.2), vec2(-0.55, -0.75)), segment(q, vec2(0.1, -0.2), vec2(0.4, -0.8))) - 0.05);
    float shape = mix(cell, min(cell, horns), horned);
    float body = 1.0 - smoothstep(-aa, aa, shape);
    float girdle = (1.0 - smoothstep(0.0, 0.035, abs(q.y + 0.05 * sin(q.x * 6.0)))) * step(cell, 0.0);
    vec2 cellId = floor(q * 6.5 + seed * 3.0);
    float plates = smoothstep(0.86, 0.98, max(abs(fract(q.x * 6.5 + seed * 3.0) - 0.5), abs(fract(q.y * 6.5 + seed * 3.0) - 0.5)) * 2.0);
    float flag = segment(q, vec2(0.05, -0.3), vec2(0.05 + 0.08 * sin(uTime * 6.0 + q.y * 20.0), -0.95));
    float whip = (1.0 - smoothstep(0.012, 0.03, flag)) * (1.0 - body);
    float shade = 0.75 + 0.25 * fract(sin(dot(cellId, vec2(12.9, 78.2))) * 437.5);
    col = vec3(0.88, 0.3, 0.12) * shade * (1.0 - 0.35 * plates) * (1.0 - 0.55 * girdle) + vec3(0.95, 0.75, 0.55) * whip;
    a = body * 0.92 + whip * 0.6;
  } else {
    // A macroalga (from a holdfast at one end): kelp, sea lettuce or a red alga.
    vec2 q = rotate(p, seed * 6.2831 + 0.06 * sin(uTime * 0.5 + seed * 3.0));
    float type = h(seed, 1.0);
    vec2 hold = vec2(-0.75, 0.0);
    if (type < 0.4) {
      // Kelp: a stipe, then long wavy blades fanning out with a midrib, an air bladder at each blade's base.
      float d = 1e3;
      float mid = 1e3;
      float bladder = 1e3;
      for (int i = 0; i < 5; i++) {
        float t = float(i) / 4.0 - 0.5;
        vec2 base = hold + vec2(0.3, 0.0);
        float ang = t * (0.9 + 0.5 * h(seed, 2.0 + float(i))) + 0.15 * sin(uTime * 0.6 + float(i));
        vec2 dir = vec2(cos(ang), sin(ang));
        vec2 rel = q - base;
        float along = dot(rel, dir);
        float across = dot(rel, vec2(-dir.y, dir.x));
        float bl = 0.95 + 0.4 * h(seed, 8.0 + float(i));
        float w = 0.09 * sin(3.1416 * clamp(along / bl, 0.0, 1.0)) * (1.0 + 0.25 * sin(along * 30.0 + seed * 9.0));
        d = min(d, max(abs(across) - w, max(-along, along - bl)));
        mid = min(mid, max(abs(across), max(-along, along - bl)));
        bladder = min(bladder, length(rel - dir * 0.1) - 0.045);
      }
      float stipe = segment(q, hold, hold + vec2(0.3, 0.0)) - 0.025;
      float body = 1.0 - smoothstep(-aa, aa, min(min(d, stipe), bladder));
      col = vec3(0.42, 0.36, 0.1) * (1.0 - 0.4 * (1.0 - smoothstep(0.0, 0.012, mid))) + vec3(0.2, 0.18, 0.04) * (1.0 - smoothstep(-aa, aa, bladder));
      a = body * 0.93;
    } else if (type < 0.7) {
      // Sea lettuce: one bright green ruffled sheet, translucent, its veins and its frilled edge.
      vec2 c = q - vec2(0.05, 0.0);
      float ang = atan(c.y, c.x);
      float edge = 0.62 + 0.14 * sin(ang * 5.0 + seed * 20.0) + 0.07 * sin(ang * 13.0 - seed * 9.0) + 0.02 * sin(uTime + ang * 3.0);
      float sd = length(c) - edge;
      float body = 1.0 - smoothstep(-aa, aa, sd);
      float frill = smoothstep(-0.08, 0.0, sd) * body;
      float veins = smoothstep(0.9, 1.0, cos(ang * 18.0 + length(c) * 6.0));
      col = vec3(0.3, 0.78, 0.2) * (0.85 + 0.25 * frill) * (1.0 - 0.2 * veins);
      a = body * (0.7 + 0.25 * frill);
    } else {
      // A red alga: crimson fronds branching twice from the holdfast.
      float d = 1e3;
      for (int i = 0; i < 3; i++) {
        float t = float(i) - 1.0;
        vec2 a1 = hold + vec2(0.55, t * 0.35 * (0.7 + 0.6 * h(seed, 2.0 + float(i))));
        vec2 a2 = a1 + vec2(0.55, t * 0.3 + 0.25 * (h(seed, 5.0 + float(i)) - 0.5));
        vec2 b1 = a1 + vec2(0.35, 0.3 + 0.2 * h(seed, 8.0 + float(i)));
        vec2 b2 = a1 + vec2(0.35, -0.3 - 0.2 * h(seed, 11.0 + float(i)));
        d = min(d, min(segment(q, hold, a1) - 0.04, segment(q, a1, a2) - 0.03));
        d = min(d, min(segment(q, a1, b1), segment(q, a1, b2)) - 0.022);
      }
      float body = 1.0 - smoothstep(-aa, aa, d);
      col = vec3(0.72, 0.1, 0.2) * (0.85 + 0.2 * sin(q.x * 9.0 + seed * 5.0));
      a = body * 0.92;
    }
  }
  // Camera heights where each phase's plants fade in (bacteria ~300–620, eukaryotes ~930–1970, plankton ~2540–4420).
  float from = kind < 11.5 ? 500.0 : kind < 13.5 ? 1500.0 : 3500.0;
  a *= smoothstep(from, from * 1.5, uFocus);
  // and recedes to half once the next phase looks down on it (still food, no longer the scenery).
  float past = kind < 11.5 ? 2600.0 : kind < 13.5 ? 4600.0 : 1e9;
  a *= 1.0 - 0.5 * smoothstep(past, past * 1.2, uFocus);
  gl_FragColor = vec4(col * a, a); // premultiplied
}
`;
const FLORA_CAP = 1024;
/** Plant sprites (world units): each a little bigger than the phase that grazes it can swallow at a gulp. */
const FLORA_SIZE: Record<number, number> = {
  [NutrientKind.spirulina]: 150, [NutrientKind.diatom]: 260, [NutrientKind.dinoflagellate]: 300, [NutrientKind.macroalga]: 1300,
  [NutrientKind.wallAlga]: 1300,
};
/** A plant grows in over its first seconds and shrinks away over its last (it lives NUTRIENT_LIFETIME). */
const GROW = 4;
const DNA_CAP = 2048;
const SIZE: Record<number, number> = {
  [NutrientKind.dissolved]: 19, [NutrientKind.debris]: 22, [NutrientKind.fragment]: 22, [NutrientKind.plasmid]: 40,
  [NutrientKind.phage]: 26, [NutrientKind.algae]: 34, [NutrientKind.chunk]: 42, [NutrientKind.shard]: 36, [NutrientKind.virus]: 44,
  [NutrientKind.cyano]: 70, [NutrientKind.hypha]: 80,
};
const SEEP_SIZE = 260;
const SEEP_DEPTH = -15;

/** `fx`, `fy`: the current where it was after its last drift (it glides on it until the next); flowTick < 0: none yet. */
interface Packet { x: number; y: number; tick: number; born: number; kind: number; seed: number; fx: number; fy: number; flowTick: number }
/** World units beyond the view edge still drawn (the biggest sprite is a seep glow). */
const VIEW_MARGIN = Math.max(SEEP_SIZE, FLORA_SIZE[NutrientKind.macroalga]! / 2);
/**
 * Every packet drifts lazily on its own period (catch-ups spread over frames by its seed; `drift` catches up
 * exactly from the packet's own tick, so skipping steps costs no accuracy). One in view: every 1–2 × NEAR_TICKS,
 * gliding on its last flow in between (over 0.8 s the change in current moves it ~1 unit). One off-screen: only once its stale
 * position could have drifted into the drawn area — the current moves it at most MAX_CURRENT u/s
 * (Σ amplitude·|k| ≈ 60), so a packet d units outside can wait d / MAX_CURRENT seconds.
 */
const NEAR_TICKS = 8;
/** The packets that pay DNA (drawn mossy green). */
export const isDna = (kind: number) => kind === NutrientKind.fragment || kind === NutrientKind.plasmid || kind === NutrientKind.shard;
const MAX_CURRENT = 65;

export function createNutrients() {
  const sprites = createSprites(NUTRIENT_CAP + SEEP_COUNT, FRAGMENT, 5);
  const dnaSprites = createSprites(DNA_CAP, DNA_FRAGMENT, 6, true);
  const flora = createSprites(FLORA_CAP, FLORA_FRAGMENT, 4, true); // under the motes and DNA
  const packets = new Map<string, Packet>();
  const flow = { x: 0, y: 0 };

  return {
    /** Dev: the mirrored packets (console inspection). */
    packets,
    objects: [flora.mesh, sprites.mesh, dnaSprites.mesh],
    /** Mirror a synced packet; its path is rebuilt locally by `drift`, never synced. */
    add(id: string, n: Nutrient) {
      // Wall seaweed's seed is its heading: its holdfast (the sprite's −x end) against the rock, its fronds into the water.
      const seed = n.kind === NutrientKind.wallAlga ? (((Math.PI - Math.atan2(n.y0, n.x0)) / (2 * Math.PI)) % 1 + 1) % 1 : (Number(id) * 0.618034) % 1;
      packets.set(id, { x: n.x0, y: n.y0, tick: n.tick0, born: n.tick0, kind: n.kind, seed, fx: 0, fy: 0, flowTick: -1 });
    },
    /** Forget a packet; returns where it was last drawn (a cell eating it gets a gulp there). */
    remove(id: string) {
      const p = packets.get(id);
      packets.delete(id);
      return p && { x: p.x, y: p.y, kind: p.kind };
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
      // DNA grows a little with the camera's height so a eukaryote still sees it; from the animal phases' heights it
      // stays small and fades to half (user: less visible there).
      const dnaGrow = Math.min(1.6, Math.max(1, focus / 800));
      const high = Math.min(1, Math.max(0, (focus - 1600) / 1400));
      dnaSprites.mesh.material.uniforms.uFade!.value = 1 - 0.5 * high * high * (3 - 2 * high);
      const halfW = view.halfW + VIEW_MARGIN;
      const halfH = view.halfH + VIEW_MARGIN;
      let i = 0;
      let n = 0; // DNA packets, in their own layer
      let g = 0; // plants, in theirs
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
        const plant = FLORA_SIZE[p.kind];
        if (plant) {
          if (g >= FLORA_CAP) continue;
          const ahead = (tick - p.tick) * TICK_DT + glide;
          const age = (tick - p.born) * TICK_DT + glide;
          const grow = Math.min(1, age / GROW, (NUTRIENT_LIFETIME - age) / GROW);
          flora.offsets[g * 3] = p.x + p.fx * ahead;
          flora.offsets[g * 3 + 1] = p.y + p.fy * ahead;
          flora.offsets[g * 3 + 2] = 0;
          flora.sizes[g] = plant * Math.max(0.05, grow * (2 - grow)); // eased
          flora.seeds[g] = p.kind + p.seed;
          g++;
          continue;
        }
        if (isDna(p.kind)) {
          if (n >= DNA_CAP) continue;
          const ahead = (tick - p.tick) * TICK_DT + glide;
          dnaSprites.offsets[n * 3] = p.x + p.fx * ahead;
          dnaSprites.offsets[n * 3 + 1] = p.y + p.fy * ahead;
          dnaSprites.offsets[n * 3 + 2] = 0;
          dnaSprites.sizes[n] = (SIZE[p.kind] ?? 16) * dnaGrow;
          dnaSprites.seeds[n] = p.kind + p.seed;
          n++;
          continue;
        }
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
        sprites.seeds[i] = 15 + (s++ * 0.37) % 1; // a seep (above every packet kind)
        i++;
      }
      sprites.commit(i);
      sprites.setFrame(time, focus);
      dnaSprites.commit(n);
      flora.commit(g);
      flora.setFrame(time, focus);
      dnaSprites.setFrame(time, focus);
    },
  };
}
