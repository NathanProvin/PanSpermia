import {
  DEFAULT_SEGMENTS, GENES, type Placement, type Player, SEGMENT_BLEND, SIDEROPHORE_REACH, TIER2, TIER3, animalRim, catalogFor,
  deform, hasGene, radiusOf, shapeUniform,
} from '@panspermia/shared';
import * as THREE from 'three';
import { NOISE } from './glsl.ts';

/** Quad half-size in cell radii: room for the wobble, halo and the siderophore reach ring. */
const QUAD_HALF = 1.9;

// Living membrane: wobbling rim, translucent cytoplasm thickening toward the edge (reads as a
// sphere), drifting granules, a diffuse nucleoid (bacteria have no nucleus), a wet specular glint.
// Whole-body genes are drawn here: capsule gel shell, thick dark wall, the dotted siderophore ring at
// the absorption reach, the warm exoenzyme halo. Placed parts are separate quads (see PART_FRAGMENT).
// A phage infection darkens the cytoplasm and fills it with new virions; a division cyst pinches the
// cell across its axis around two separating nucleoids; an endospore is a hard pale husk.
// Eukaryotes (uTier = 1) carry a true nucleus (envelope + nucleolus) and a few vacuoles instead of a nucleoid.
// Animals (uTier = 2) are a smooth union of body segments (uSeg: x, y, r), tissue made of many small cells,
// grooves where segments meet, a gut along the spine; a carapace is a glossy shell over the body.
const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform vec3 uColor;
uniform float uHeading;
uniform float uSidero;
uniform float uExo;
uniform float uReach;
uniform float uCapsule;
uniform float uWall;
uniform float uSpore;
uniform float uInfect;
uniform float uCyst;
uniform float uTier;
uniform vec3 uShape; // stretch x, stretch y, bend (shared/shapes.ts)
uniform float uCentre;
uniform vec3 uSeg[8];
uniform int uSegN;
uniform float uCarapace;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 p = (vUv * 2.0 - 1.0) * ${QUAD_HALF.toFixed(2)}; // body frame (the quad turns with the cell), cell radii
  // Body shape: undo the bend, then the stretch, so everything below draws the canonical unit disc.
  p.y = (p.y - uShape.z * (p.x * p.x - uCentre * uShape.x * uShape.x)) / uShape.y;
  p.x /= uShape.x;
  float a = atan(p.y, p.x);
  float r = length(p);
  float t = uTime + uSeed * 100.0;
  vec2 fwd = vec2(1.0, 0.0);
  float rim = 1.0 + 0.035 * sin(3.0 * a + t * 1.1) + 0.025 * sin(5.0 * a - t * 1.6) + 0.012 * sin(9.0 * a + t * 2.4);
  // Division: the membrane pinches in where it crosses the axis (sides), a breathing furrow.
  float side = cos(a);
  rim -= uCyst * (0.16 + 0.03 * sin(t * 2.0)) * exp(-side * side * 10.0);
  float d = r - rim; // signed distance in radii, < 0 inside
  float animal = step(1.5, uTier);
  float euk = step(0.5, uTier) - animal;
  float bact = 1.0 - step(0.5, uTier);
  // Animal: segments blended into one body; remember the nearest two (grooves) and the nearest (normal).
  vec2 segC = vec2(0.0);
  float segR = 1.0;
  float groove = 0.0;
  if (animal > 0.5) {
    float sd = 1e3, d1 = 1e3, d2 = 1e3;
    for (int i = 0; i < 8; i++) {
      if (i >= uSegN) break;
      vec3 s = uSeg[i];
      float di = length(p - s.xy) - s.z * (1.0 + 0.3 * (rim - 1.0));
      float h = clamp(0.5 + 0.5 * (di - sd) / ${SEGMENT_BLEND.toFixed(3)}, 0.0, 1.0);
      sd = i == 0 ? di : mix(di, sd, h) - ${SEGMENT_BLEND.toFixed(3)} * h * (1.0 - h);
      if (di < d1) { d2 = d1; d1 = di; segC = s.xy; segR = s.z; } else if (di < d2) d2 = di;
    }
    d = sd;
    groove = exp(-pow((d2 - d1) / 0.035, 2.0));
  }
  float aa = fwidth(d) * 1.5;
  float inside = 1.0 - smoothstep(-aa, aa, d);

  float shell = smoothstep(-0.85, 0.0, d);
  float granules = valueNoise(p * 7.0 + vec2(t * 0.11, -t * 0.08));
  vec2 nucleoidAt = 0.22 * vec2(sin(t * 0.31), cos(t * 0.27));
  float nucleoid = 1.0 - smoothstep(0.0, 0.5, length(p - nucleoidAt));
  // Two daughter nucleoids drifting apart along the axis while dividing.
  float twins = max(1.0 - smoothstep(0.0, 0.35, length(p - fwd * 0.42)), 1.0 - smoothstep(0.0, 0.35, length(p + fwd * 0.42)));
  nucleoid = mix(nucleoid, twins, uCyst);
  vec3 cyto = uColor * (0.22 + 0.42 * shell + 0.22 * granules) * (1.0 - 0.3 * nucleoid * bact);
  // Animal tissue: many small cells, a gut along the spine with a slow peristaltic wave.
  float tissue = animal * (1.0 - smoothstep(0.0, 0.1, cellEdge(p * 9.0 + uSeed * 20.0, t * 0.05)));
  float gut = animal * exp(-pow(p.y / 0.07, 2.0)) * (1.0 - smoothstep(0.75, 0.95, abs(p.x + 0.05)))
    * (0.6 + 0.4 * sin(p.x * 12.0 + t * 2.0));
  cyto = cyto * (1.0 - 0.25 * tissue - 0.45 * groove * animal) + (uColor * 0.3 + 0.1) * tissue * 0.25;
  cyto = mix(cyto, uColor * 0.25 + vec3(0.12, 0.09, 0.04), gut * 0.6);
  // Eukaryote: a nucleus behind the middle (envelope, darker nucleoplasm, bright nucleolus) and vacuoles.
  vec2 nucleusAt = -fwd * 0.18 + 0.05 * vec2(sin(t * 0.2), cos(t * 0.23));
  float nd = length(p - nucleusAt) - 0.34;
  float nucleus = euk * (1.0 - smoothstep(0.0, 0.02, nd));
  float envelope = euk * (1.0 - smoothstep(0.0, 0.025, abs(nd + 0.015)));
  float nucleolus = euk * exp(-dot(p - nucleusAt - vec2(0.08, 0.06), p - nucleusAt - vec2(0.08, 0.06)) * 120.0);
  float vacuoles = 0.0;
  for (int i = 0; i < 3; i++) {
    vec2 at = 0.5 * vec2(cos(float(i) * 2.1 + uSeed * 9.0 + t * 0.05), sin(float(i) * 2.1 + uSeed * 9.0 + t * 0.05));
    vacuoles += 1.0 - smoothstep(0.1, 0.13, length(p - at));
  }
  vacuoles *= euk;
  cyto = mix(cyto, uColor * 0.35 + 0.05, nucleus * 0.7);
  cyto += (uColor * 0.4 + 0.25) * vacuoles * 0.35;
  float furrow = uCyst * exp(-pow(dot(p, fwd) / 0.08, 2.0)) * inside;
  cyto *= 1.0 - 0.6 * furrow;
  float cytoAlpha = inside * (0.6 + 0.35 * shell);

  float wall = 0.025 + 0.04 * max(uWall, uSpore);
  float membrane = 1.0 - smoothstep(wall, wall + aa, abs(d + wall + 0.005));
  vec3 membraneCol = mix(uColor * 0.85 + 0.04, uColor * 0.45 + vec3(0.09, 0.07, 0.04), uWall);
  membraneCol *= 1.0 - 0.45 * animal; // tissue, not a single glowing membrane
  membraneCol += uCyst * (0.25 + 0.15 * sin(t * 3.0)) * vec3(0.6, 1.0, 0.8); // dividing: a living glow

  // Siderophores: a faint dotted ring where they reach, slowly rotating.
  float ring = uSidero * exp(-pow((r - uReach) / 0.025, 2.0)) * step(0.5, fract(a * 48.0 / 6.2831853 + t * 0.15)) * 0.45;

  // Capsule: a translucent slime shell around the membrane.
  float gel = uCapsule * smoothstep(-0.02, 0.02, d) * (1.0 - smoothstep(0.18, 0.28, d));

  // Phage infection: a violet tint and pale virions crowding the cytoplasm, flickering as they assemble.
  vec2 vg = p * 8.0 + vec2(0.0, t * 0.05);
  vec2 vf = fract(vg) - 0.5;
  float virions = uInfect * inside * step(0.55, hash12(floor(vg) + uSeed)) * exp(-dot(vf, vf) * 70.0)
    * (0.6 + 0.4 * sin(t * 6.0 + hash12(floor(vg)) * 30.0));
  cyto = mix(cyto, cyto * vec3(0.75, 0.45, 0.95), uInfect * 0.6);

  // Wet glint from a light above-left of the screen (turned into the body frame), using the sphere normal.
  vec3 n = vec3(p / max(rim, 1e-3), sqrt(max(0.0, 1.0 - dot(p, p) / (rim * rim))));
  if (animal > 0.5) { // each segment bulges like its own sphere
    vec2 q = (p - segC) / segR;
    n = vec3(q, sqrt(max(0.0, 1.0 - dot(q, q))));
  }
  float ch = cos(uHeading), sh = sin(uHeading);
  vec2 lightXY = vec2(ch * -0.45 + sh * 0.55, -sh * -0.45 + ch * 0.55);
  float glint = pow(max(0.0, dot(n, normalize(vec3(lightXY, 0.7)))), 28.0 - 18.0 * uCarapace) * inside * (1.0 + 0.8 * uCarapace);
  // Carapace: a hard translucent shell, a pale thick rim and a sheen over the back.
  membraneCol = mix(membraneCol, vec3(0.85, 0.8, 0.65), uCarapace * 0.6);
  wall = mix(wall, 0.07, uCarapace);
  membrane = max(membrane, uCarapace * (1.0 - smoothstep(wall, wall + aa, abs(d + wall + 0.005))));
  cyto += uCarapace * vec3(0.06, 0.055, 0.04) * smoothstep(-0.6, 0.0, d) * inside;

  float halo = exp(-max(d, 0.0) * (12.0 - 6.0 * uExo)) * (1.0 - inside) * (0.22 + 0.25 * uExo);
  vec3 haloCol = mix(uColor, vec3(1.0, 0.42, 0.18), uExo);

  // Gene features vanish inside the spore coat.
  float live = 1.0 - uSpore;
  ring *= live; gel *= live; virions *= live; halo *= live;
  cyto = mix(cyto, vec3(0.8, 0.84, 0.74) * (0.3 + 0.45 * shell), uSpore);
  membraneCol = mix(membraneCol, vec3(0.95, 0.97, 0.88), uSpore);

  // Premultiplied alpha.
  vec3 color = cyto * cytoAlpha + membraneCol * membrane + vec3(1.0) * glint * 0.55 + haloCol * halo * 0.6
    + (uColor * 0.5 + 0.35) * envelope * inside + vec3(1.0, 0.95, 0.8) * nucleolus * 0.8 * inside
    + vec3(0.7, 0.95, 0.85) * ring + (uColor * 0.3 + 0.08) * gel * 0.5 + vec3(1.0, 0.3, 0.25) * virions * 1.2;
  float alpha = clamp(cytoAlpha + membrane + halo * 0.5 + ring + gel * 0.35 + virions, 0.0, 1.0);
  gl_FragColor = vec4(color, alpha);
}
`;

/** Part kinds: a tier-1 gene's catalog index, KIND2 + a tier-2 gene's index, or KIND3 + a tier-3 one. */
const KIND2 = 16;
const KIND3 = 32;

// Placed parts, one quad each in the cell's frame. In the quad, +x points away from the body (the
// membrane normal for membrane parts), so every shape grows outward from its base at x = -1. The
// kind is the gene's catalog index.
const PART_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform float uKind;
uniform float uActive;
uniform vec3 uColor;
varying vec2 vUv;
${NOISE}
float segment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  return length(p - a - ab * clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0));
}
float dots(vec2 p, vec2 at, float size) { return exp(-dot(p - at, p - at) / (size * size)); }
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float t = uTime + uSeed * 50.0;
  int k = int(uKind + 0.5);
  vec3 col = vec3(0.0);
  float a = 0.0;
  if (k == ${GENES.pili.index}) { // a tuft of fine swaying hairs
    for (int i = 0; i < 6; i++) {
      float fi = float(i) - 2.5;
      float dir = fi * 0.2 + 0.12 * sin(t * 1.3 + fi * 1.7);
      vec2 base = vec2(-0.9, fi * 0.18);
      float len = 1.2 + 0.4 * hash12(vec2(fi, uSeed * 7.0));
      float h = segment(p, base, base + len * vec2(cos(dir), sin(dir)));
      a = max(a, (1.0 - smoothstep(0.02, 0.055, h)) * (1.0 - 0.5 * smoothstep(-0.9, 0.9, p.x)));
    }
    col = uColor * 0.8 + 0.15;
  } else if (k == ${GENES.chemoreceptor.index}) { // glowing receptor arrays
    a = dots(p, vec2(-0.3, -0.45), 0.2) + dots(p, vec2(-0.1, 0.0), 0.22) + dots(p, vec2(-0.3, 0.45), 0.2);
    col = vec3(1.0, 0.85, 0.55) * 1.6;
  } else if (k == ${GENES.transporters.index}) { // bright pores studding the membrane
    for (int i = -1; i <= 1; i++) {
      float rr = length(p - vec2(-0.1, float(i) * 0.55));
      a = max(a, exp(-pow((rr - 0.17) / 0.07, 2.0)));
    }
    col = vec3(0.9, 1.0, 0.8) * 1.4;
  } else if (k == ${GENES.siderophores.index}) { // a cluster of iron-scavenging granules
    for (int i = 0; i < 5; i++) {
      vec2 at = 0.55 * vec2(hash12(vec2(float(i), uSeed)) - 0.5, hash12(vec2(uSeed, float(i))) - 0.5) * 2.0;
      at += 0.06 * vec2(sin(t + float(i)), cos(t * 1.3 + float(i)));
      a = max(a, dots(p, at, 0.16));
    }
    col = vec3(0.45, 0.95, 1.0) * 1.3;
  } else if (k == ${GENES.exoenzymes.index}) { // an enzyme vesicle
    float rr = length(p);
    a = (1.0 - smoothstep(0.55, 0.65, rr)) * (0.35 + 0.65 * smoothstep(0.4, 0.6, rr))
      + 0.6 * dots(p, 0.2 * vec2(sin(t), cos(t * 0.8)), 0.15);
    col = vec3(1.0, 0.55, 0.2) * 1.2;
  } else if (k == ${GENES.bacteriocin.index} || k == ${GENES.poreFormer.index}) { // a secretion gland
    vec2 q = p - vec2(-0.55, 0.0);
    float blob = length(q * vec2(1.0, 0.8));
    float pulse = 0.8 + 0.2 * sin(t * 2.5);
    a = (1.0 - smoothstep(0.5, 0.62, blob)) * (0.5 + 0.5 * smoothstep(0.2, 0.55, blob)) * pulse;
    col = k == ${GENES.bacteriocin.index} ? vec3(1.0, 0.22, 0.25) * 1.4 : vec3(1.0, 0.45, 0.15) * 1.4; // danger: red
  } else if (k == ${GENES.t6ss.index}) { // a tapered molecular syringe
    float s = (p.x + 0.9) / 1.8; // 0 at the base, 1 at the tip
    float w = 0.28 * (1.0 - s);
    a = step(0.0, s) * step(s, 1.0) * (1.0 - smoothstep(w - 0.03, w + 0.03, abs(p.y)));
    col = vec3(0.85, 0.9, 1.0) * 1.1;
  } else if (k == ${GENES.effluxPump.index}) { // orange pump beads
    a = dots(p, vec2(-0.2, -0.35), 0.24) + dots(p, vec2(-0.2, 0.35), 0.24);
    col = vec3(1.0, 0.6, 0.2) * 1.4;
  } else if (k == ${KIND2 + TIER2.GENES.cilia.index}) { // a comb of short cilia beating in a travelling wave
    for (int i = 0; i < 9; i++) {
      float fi = float(i) - 4.0;
      float beat = sin(t * 9.0 - fi * 0.9);
      vec2 base = vec2(-0.85, fi * 0.2);
      vec2 tip = base + 0.9 * vec2(cos(beat * 0.5), sin(beat * 0.5));
      a = max(a, (1.0 - smoothstep(0.025, 0.06, segment(p, base, tip))));
    }
    col = uColor * 0.7 + 0.3;
  } else if (k == ${KIND2 + TIER2.GENES.filter.index}) { // a frilled funnel mouth, bristles combing the water
    float rr = length(p - vec2(-0.1, 0.0));
    float ang = atan(p.y, p.x + 0.1);
    float funnel = (1.0 - smoothstep(0.42, 0.5, rr)) * smoothstep(0.18, 0.32, rr);
    float bristles = step(0.45, rr) * (1.0 - smoothstep(0.7, 0.9, rr))
      * smoothstep(0.6, 0.9, sin(ang * 14.0 + sin(t * 3.0) * 0.6)) * step(-0.6, p.x);
    float gullet = 1.0 - smoothstep(0.12, 0.2, rr);
    a = max(max(funnel, bristles * 0.9), gullet * 0.8);
    col = mix(vec3(0.75, 1.0, 0.55), vec3(0.15, 0.25, 0.1), gullet);
  } else if (k == ${KIND3 + TIER3.GENES.paddle.index}) { // a jointed leg rowing, a fan of bristles at its tip
    float row = 0.55 * sin(t * 4.0);
    vec2 base = vec2(-0.9, 0.0);
    vec2 knee = base + 0.6 * vec2(cos(row * 0.6), sin(row * 0.6));
    vec2 tip = knee + 0.5 * vec2(cos(row), sin(row));
    float limb = min(segment(p, base, knee), segment(p, knee, tip));
    a = 1.0 - smoothstep(0.13 - 0.04 * smoothstep(-0.9, 0.3, p.x), 0.17, limb); // stout, tapering
    for (int i = 0; i < 7; i++) { // a broad fan of swimming bristles: the paddle blade
      float dir = row + (float(i) - 3.0) * 0.2;
      a = max(a, 0.85 * (1.0 - smoothstep(0.03, 0.06, segment(p, tip, tip + 0.5 * vec2(cos(dir), sin(dir))))));
    }
    col = uColor * 0.6 + vec3(0.35, 0.32, 0.25);
  } else if (k == ${KIND3 + TIER3.GENES.filterComb.index}) { // feathery combs beating in a wave, sieving the water
    for (int i = 0; i < 5; i++) {
      float fi = float(i) - 2.0;
      float beat = 0.35 * sin(t * 7.0 - fi * 0.9);
      vec2 base = vec2(-0.85, fi * 0.3);
      vec2 dir = vec2(cos(beat), sin(beat));
      float along = clamp(dot(p - base, dir), 0.0, 1.2);
      float stem = length(p - base - dir * along);
      float hairs = smoothstep(0.6, 0.95, sin(along * 30.0)) * (1.0 - smoothstep(0.02, 0.12, stem)) * step(0.1, along);
      a = max(a, max(1.0 - smoothstep(0.025, 0.05, stem), hairs * 0.7) * (1.0 - smoothstep(1.0, 1.2, along)));
    }
    col = vec3(0.92, 0.95, 0.85);
  } else if (k == ${KIND2 + TIER2.GENES.jaw.index} || k == ${KIND3 + TIER3.GENES.mandible.index}) { // two hooked mandibles snapping
    float open = 0.28 + 0.16 * sin(t * 4.0);
    for (int side = -1; side <= 1; side += 2) {
      float s = float(side);
      vec2 base = vec2(-0.8, s * 0.22);
      vec2 mid = base + 0.9 * vec2(cos(s * open), sin(s * open));
      vec2 tip = mid + 0.5 * vec2(cos(-s * 0.9), sin(-s * 0.9)); // hooked inward
      float d = min(segment(p, base, mid), segment(p, mid, tip));
      float w = 0.13 - 0.08 * smoothstep(-0.8, 0.8, p.x);
      a = max(a, 1.0 - smoothstep(w - 0.03, w + 0.02, d));
    }
    col = vec3(1.0, 0.86, 0.68);
  } else if (k == ${KIND2 + TIER2.GENES.spike.index}) { // a long bony spike
    float s = (p.x + 0.95) / 1.9;
    float w = 0.3 * (1.0 - s);
    a = step(0.0, s) * step(s, 1.0) * (1.0 - smoothstep(w - 0.04, w + 0.03, abs(p.y)));
    col = mix(vec3(0.75, 0.6, 0.45), vec3(1.0, 0.95, 0.85), s);
  } else if (k == ${KIND2 + TIER2.GENES.poison.index}) { // a swollen poison gland, bubbling green
    vec2 q = p - vec2(-0.45, 0.0);
    float blob = length(q * vec2(0.9, 1.0));
    float bubbles = smoothstep(0.7, 0.9, valueNoise(q * 6.0 + vec2(0.0, -t * 1.5)));
    a = (1.0 - smoothstep(0.48, 0.58, blob)) * (0.55 + 0.45 * bubbles);
    col = vec3(0.9, 0.12, 0.1) * (1.2 + 0.3 * sin(t * 3.0)); // danger: red
  } else if (k == ${KIND2 + TIER2.GENES.electric.index}) { // an electric organ crackling with arcs
    float lens = 1.0 - smoothstep(0.55, 0.65, length(p * vec2(1.0, 1.4)));
    float arcs = 1.0 - smoothstep(0.0, 0.06, abs(valueNoise(p * 4.0 + floor(t * 12.0) * 1.7) - 0.5));
    a = max(lens * 0.6, arcs * smoothstep(0.95, 0.4, length(p)));
    col = vec3(0.55, 0.8, 1.0) * (1.2 + arcs);
  } else if (k == ${KIND2 + TIER2.GENES.jet.index}) { // a nozzle; a bubbling plume while dashing
    float s = (p.x + 0.9) / 1.3; // along the nozzle
    float w = mix(0.14, 0.42, clamp(s, 0.0, 1.0));
    float shell = step(-0.9, p.x) * step(p.x, 0.4) * (1.0 - smoothstep(w - 0.03, w + 0.03, abs(p.y)));
    float rim = exp(-pow((p.x - 0.4) / 0.05, 2.0)) * step(abs(p.y), 0.42);
    float plume = uActive * step(0.4, p.x) * (1.0 - smoothstep(0.1, 0.45, abs(p.y)))
      * smoothstep(0.55, 0.85, valueNoise(p * 7.0 - vec2(t * 14.0, 0.0)));
    a = max(max(shell * 0.85, rim), plume);
    col = mix(vec3(0.85, 0.75, 0.6), vec3(0.8, 0.95, 1.0), plume);
  } else if (k == ${KIND2 + TIER2.GENES.eye.index} || k == ${KIND3 + TIER3.GENES.eye.index}) { // a Spore-cell eye: sclera, wandering pupil, glint
    float rr = length(p);
    float sclera = 1.0 - smoothstep(0.8, 0.88, rr);
    vec2 look = vec2(0.32, 0.0) + 0.08 * vec2(sin(t * 0.7 + uSeed * 9.0), sin(t * 1.1));
    float pupil = 1.0 - smoothstep(0.32, 0.38, length(p - look));
    float glint = 1.0 - smoothstep(0.08, 0.12, length(p - look - vec2(0.1, 0.12)));
    float outline = sclera * smoothstep(0.7, 0.82, rr);
    a = sclera;
    col = mix(vec3(0.95), vec3(0.05, 0.05, 0.08), max(pupil, outline * 0.8)) + glint * 0.9;
  } else if (k == ${GENES.adhesin.index}) { // adhesins: a fringe of barbed hooks for clinging to a host
    for (int i = -2; i <= 2; i++) {
      float y = float(i) * 0.3;
      vec2 base = vec2(-0.8, y);
      vec2 tip = base + vec2(1.2, 0.0);
      float stalk = segment(p, base, tip);
      float barb = segment(p, tip, tip + vec2(-0.3, 0.25));
      a = max(a, 1.0 - smoothstep(0.03, 0.07, min(stalk, barb)));
    }
    col = vec3(0.95, 0.75, 0.55);
  } else if (k == ${GENES.thylakoid.index}) { // stacked photosynthetic membranes, glowing green
    float stacks = 0.0;
    for (int i = -1; i <= 1; i++) {
      float y = float(i) * 0.3 + 0.04 * sin(p.x * 7.0 + t + float(i));
      stacks = max(stacks, (1.0 - smoothstep(0.035, 0.07, abs(p.y - y))) * (1.0 - smoothstep(0.55, 0.75, abs(p.x))));
    }
    a = stacks;
    col = vec3(0.35, 1.0, 0.4) * 1.3;
  } else if (k == ${KIND2 + TIER2.GENES.mitochondrion.index}) { // a mitochondrion: bean with folded cristae
    vec2 q = p * vec2(1.0, 1.7);
    float bean = 1.0 - smoothstep(0.62, 0.7, length(q));
    float cristae = smoothstep(0.55, 0.9, sin(p.x * 14.0 + sin(p.y * 9.0) * 1.5)) * (1.0 - smoothstep(0.45, 0.6, length(q)));
    a = bean * (0.55 + 0.45 * cristae);
    col = mix(vec3(1.0, 0.5, 0.2), vec3(1.0, 0.85, 0.55), cristae);
  } else if (k == ${KIND2 + TIER2.GENES.chloroplast.index}) { // a chloroplast: green lens with grana stacks
    vec2 q = p * vec2(1.0, 1.5);
    float lens = 1.0 - smoothstep(0.62, 0.7, length(q));
    vec2 g = fract(p * vec2(4.0, 6.0)) - 0.5;
    float grana = (1.0 - smoothstep(0.18, 0.28, length(g))) * (1.0 - smoothstep(0.5, 0.62, length(q)));
    a = lens * (0.5 + 0.5 * grana);
    col = mix(vec3(0.2, 0.7, 0.25), vec3(0.6, 1.0, 0.45), grana);
  } else if (k == ${GENES.endospore.index}) { // the dormant core waiting inside
    float rr = length(p * vec2(1.0, 1.4));
    a = (1.0 - smoothstep(0.6, 0.7, rr)) * (0.3 + 0.7 * smoothstep(0.45, 0.65, rr));
    col = vec3(0.95, 0.97, 0.85);
  }
  a = clamp(a, 0.0, 1.0);
  gl_FragColor = vec4(col * a, a); // premultiplied
}
`;
const kindOf = (tier: number, gene: string) => [0, 0, KIND2, KIND3][tier]! + catalogFor(tier).GENES[gene]!.index;
/** Quad size (cell radii) and how far its centre sits outward from the attachment point (in sizes). */
const PART_SHAPE: Record<number, { size: number; out: number }> = {
  [KIND2 + TIER2.GENES.cilia.index]: { size: 0.7, out: 0.25 },
  [KIND2 + TIER2.GENES.filter.index]: { size: 0.55, out: 0.2 },
  [KIND2 + TIER2.GENES.jaw.index]: { size: 0.6, out: 0.4 },
  [KIND2 + TIER2.GENES.spike.index]: { size: 0.6, out: 0.45 },
  [KIND2 + TIER2.GENES.poison.index]: { size: 0.45, out: 0.1 },
  [KIND2 + TIER2.GENES.electric.index]: { size: 0.5, out: 0 },
  [KIND2 + TIER2.GENES.jet.index]: { size: 0.6, out: 0.35 },
  [KIND2 + TIER2.GENES.eye.index]: { size: 0.32, out: 0 },
  [KIND3 + TIER3.GENES.paddle.index]: { size: 0.7, out: 0.35 },
  [KIND3 + TIER3.GENES.filterComb.index]: { size: 0.45, out: 0.3 },
  [KIND3 + TIER3.GENES.mandible.index]: { size: 0.45, out: 0.35 },
  [KIND3 + TIER3.GENES.eye.index]: { size: 0.22, out: 0 },
  [GENES.thylakoid.index]: { size: 0.45, out: 0 },
  [GENES.adhesin.index]: { size: 0.4, out: 0.35 },
  [KIND2 + TIER2.GENES.mitochondrion.index]: { size: 0.38, out: 0 },
  [KIND2 + TIER2.GENES.chloroplast.index]: { size: 0.4, out: 0 },
  [GENES.pili.index]: { size: 0.6, out: 0.35 },
  [GENES.chemoreceptor.index]: { size: 0.32, out: 0 },
  [GENES.transporters.index]: { size: 0.36, out: 0 },
  [GENES.siderophores.index]: { size: 0.45, out: 0 },
  [GENES.exoenzymes.index]: { size: 0.4, out: 0 },
  [GENES.bacteriocin.index]: { size: 0.4, out: 0.1 },
  [GENES.poreFormer.index]: { size: 0.4, out: 0.1 },
  [GENES.t6ss.index]: { size: 0.5, out: 0.45 },
  [GENES.effluxPump.index]: { size: 0.32, out: 0 },
  [GENES.endospore.index]: { size: 0.5, out: 0 },
};

// Flagellum: a tapered whip, its helical beat seen side-on as a travelling wave.
const FLAGELLUM_VERTEX = /* glsl */ `
uniform float uBeat;
varying float vAlong;
varying float vAcross;
void main() {
  float s = position.x; // 0 at the cell, 1 at the tip
  vec3 pos = position;
  pos.y = position.y * mix(0.22, 0.06, s) + 0.24 * s * sin(s * 9.0 - uBeat);
  vAlong = s;
  vAcross = position.y * 2.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;
const FLAGELLUM_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying float vAlong;
varying float vAcross;
void main() {
  float a = (1.0 - smoothstep(0.4, 1.0, abs(vAcross))) * (1.0 - 0.6 * vAlong);
  gl_FragColor = vec4((uColor * 0.9 + 0.05) * a, a); // premultiplied
}
`;
const FLAGELLUM_LENGTH = [0, 3.2, 2.2, 1.3]; // cell radii, per tier (a eukaryote's whip is shorter; an animal's tail)
/** How thick a whip is (× part scale) and how fast it beats (× BEAT_RUN), per tier: an animal's tail is stout and slow. */
const WHIP = [{ width: 1, beat: 1 }, { width: 1, beat: 1 }, { width: 1, beat: 1 }, { width: 3, beat: 0.35 }];
const BEAT_RUN = 22; // rad/s of wave phase
const BEAT_TUMBLE = 5; // motor reversal during a tumble: the bundle flails slowly

const material = (vertexShader: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>) =>
  new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false, premultipliedAlpha: true });
const bodyGeometry = new THREE.PlaneGeometry(2 * QUAD_HALF, 2 * QUAD_HALF);
const bodyMaterial = material(VERTEX, FRAGMENT, {
  uTime: { value: 0 }, uSeed: { value: 0 }, uColor: { value: new THREE.Color() }, uHeading: { value: 0 },
  uSidero: { value: 0 }, uExo: { value: 0 }, uReach: { value: SIDEROPHORE_REACH }, uCapsule: { value: 0 },
  uWall: { value: 0 }, uSpore: { value: 0 }, uInfect: { value: 0 }, uCyst: { value: 0 }, uTier: { value: 0 },
  uShape: { value: new THREE.Vector3(1, 1, 0) }, uCentre: { value: 1 / 3 },
  uSeg: { value: Array.from({ length: 8 }, (_, i) => new THREE.Vector3(...(DEFAULT_SEGMENTS[i] ?? [0, 0, 0]))) },
  uSegN: { value: DEFAULT_SEGMENTS.length }, uCarapace: { value: 0 },
});
const partGeometry = new THREE.PlaneGeometry(1, 1);
const partMaterial = material(VERTEX, PART_FRAGMENT, {
  uTime: { value: 0 }, uSeed: { value: 0 }, uKind: { value: 0 }, uActive: { value: 0 }, uColor: { value: new THREE.Color() },
});
const flagellumGeometry = new THREE.PlaneGeometry(1, 1, 48, 1).translate(0.5, 0, 0);
const flagellumMaterial = material(FLAGELLUM_VERTEX, FLAGELLUM_FRAGMENT, { uBeat: { value: 0 }, uColor: { value: new THREE.Color() } });

/** Stable pseudo-random [0, 1) from a string id. */
export function hashId(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 2 ** 32;
}

/** Rendered (predicted or smoothed) pose of a cell. */
export interface Pose { x: number; y: number; heading: number; tumble: number; spore: number; cyst: number; dash?: number }
/** What a cell looks like: its tier, that tier's expressed genome, where its parts sit, its species hue. */
export interface Look { tier: number; genome: number; parts: readonly Placement<string>[]; hue: number; shape?: number }

type ShaderMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;

/** One drawable cell: a body plus its placed parts in a frame that turns with the heading. */
export function createCellView(parent: THREE.Object3D, seed: number) {
  const color = new THREE.Color();
  const body: ShaderMesh = new THREE.Mesh(bodyGeometry, bodyMaterial.clone()); // clones share the program
  body.material.uniforms.uColor!.value = color;
  body.material.uniforms.uSeed!.value = seed;
  body.renderOrder = 10;
  const frame = new THREE.Group(); // body frame: +x forward, units of cell radii
  parent.add(body, frame);
  let partsKey = '';
  let parts: { mesh: ShaderMesh; flagellum: boolean }[] = [];
  let beat = 1;

  const rebuild = (placements: readonly Placement<string>[], tier: number, form: number) => {
    for (const { mesh } of parts) {
      frame.remove(mesh);
      mesh.material.dispose();
    }
    parts = [];
    beat = WHIP[tier]!.beat;
    for (const [i, raw] of placements.entries()) {
      const kind = kindOf(tier, raw.gene);
      // An animal's membrane parts sit on its segmented outline, not the unit circle.
      const onRim = tier === 3 && catalogFor(3).GENES[raw.gene]!.slot === 'membrane' ? animalRim(raw.angle) : 1;
      const pl = { ...raw, x: raw.x * onRim, y: raw.y * onRim };
      if (pl.gene === 'flagellum' || pl.gene === 'tail') {
        const mesh: ShaderMesh = new THREE.Mesh(flagellumGeometry, flagellumMaterial.clone());
        mesh.material.uniforms.uColor!.value = color;
        mesh.material.uniforms.uBeat!.value = seed * 100 + i * 1.7;
        const root = deform(form, pl.x * 0.92, pl.y * 0.92, pl.angle); // where it leaves the shaped body
        mesh.position.set(root.x, root.y, 0);
        mesh.rotation.z = root.angle;
        mesh.scale.set(FLAGELLUM_LENGTH[tier]! * pl.scale, WHIP[tier]!.width * pl.scale, 1);
        mesh.renderOrder = 9;
        frame.add(mesh);
        parts.push({ mesh, flagellum: true });
        continue;
      }
      const shape = PART_SHAPE[kind];
      if (!shape) continue; // coats are drawn by the body shader
      const mesh: ShaderMesh = new THREE.Mesh(partGeometry, partMaterial.clone());
      const u = mesh.material.uniforms;
      u.uKind!.value = kind;
      u.uSeed!.value = seed + i * 0.37;
      u.uColor!.value = color;
      const size = shape.size * pl.scale;
      const at = deform(form, pl.x, pl.y, pl.angle); // on the shaped body, facing its normal there
      mesh.position.set(at.x + Math.cos(at.angle) * size * shape.out, at.y + Math.sin(at.angle) * size * shape.out, 0);
      mesh.rotation.z = at.angle;
      mesh.scale.setScalar(size);
      mesh.renderOrder = 11;
      frame.add(mesh);
      parts.push({ mesh, flagellum: false });
    }
  };

  return {
    body,
    update(pose: Pose, radius: number, look: Look, time: number, dt: number) {
      const form = look.shape ?? 0;
      const key = `${look.tier}/${form}/` + look.parts.map((p) => `${p.gene}${p.x.toFixed(3)}${p.y.toFixed(3)}${p.angle.toFixed(3)}${p.scale}`).join();
      if (key !== partsKey) {
        partsKey = key;
        rebuild(look.parts, look.tier, form);
        const s = shapeUniform(form);
        body.material.uniforms.uShape!.value.set(s.sx, s.sy, s.bend);
        body.material.uniforms.uCentre!.value = s.centre;
      }
      color.setHSL(look.hue, look.tier === 3 ? 0.55 : 0.8, 0.42); // animal tissue is less saturated than a cell
      body.position.set(pose.x, pose.y, 0);
      body.rotation.z = pose.heading; // a rod points where it swims
      body.scale.setScalar(radius);
      frame.position.set(pose.x, pose.y, 0);
      frame.rotation.z = pose.heading;
      frame.scale.setScalar(radius);
      const dormant = pose.spore > 0 || pose.cyst > 0;
      frame.visible = pose.spore === 0; // a spore coat hides every part; a dividing cell keeps them
      const u = body.material.uniforms;
      const g1 = look.tier === 1 ? look.genome : 0; // whole-body features are tier-1 genes
      u.uTime!.value = time;
      u.uHeading!.value = pose.heading;
      u.uTier!.value = look.tier - 1;
      u.uCarapace!.value = look.tier === 3 && TIER3.hasGene(look.genome, 'carapace') ? 1 : 0;
      u.uSidero!.value = hasGene(g1, 'siderophores') ? 1 : 0;
      u.uExo!.value = hasGene(g1, 'exoenzymes') ? 1 : 0;
      u.uCapsule!.value = hasGene(g1, 'capsule') ? 1 : 0;
      u.uWall!.value = hasGene(g1, 'thickWall') ? 1 : 0;
      u.uSpore!.value = pose.spore > 0 ? 1 : 0;
      u.uCyst!.value = pose.cyst > 0 ? 1 : 0;
      for (const { mesh, flagellum } of parts) {
        if (flagellum) mesh.material.uniforms.uBeat!.value += dt * beat * (dormant ? 0 : pose.tumble > 0 ? BEAT_TUMBLE : BEAT_RUN);
        else {
          mesh.material.uniforms.uTime!.value = time;
          mesh.material.uniforms.uActive!.value = (pose.dash ?? 0) > 0 ? 1 : 0; // the jet's plume
        }
      }
    },
    setInfected(infected: boolean) { body.material.uniforms.uInfect!.value = infected ? 1 : 0; },
    /** Scale the whole cell after update (the meteor hatch pop). */
    grow(k: number) {
      body.scale.multiplyScalar(k);
      frame.scale.multiplyScalar(k);
    },
    dispose() {
      rebuild([], 1, 0);
      parent.remove(body, frame);
      body.material.dispose();
    },
  };
}
export type CellView = ReturnType<typeof createCellView>;

export function createCells(scene: THREE.Scene) {
  const views = new Map<string, CellView>();
  return {
    update(
      players: Iterable<[string, Player]> & { has(id: string): boolean },
      time: number, dt: number, pose: (p: Player) => Pose, look: (id: string, p: Player) => Look,
    ) {
      // ponytail: full diff every frame, fine for ~100 cells; switch to state callbacks if it shows in profiles.
      for (const [id, p] of players) {
        let view = views.get(id);
        if (!view) views.set(id, (view = createCellView(scene, hashId(id))));
        view.update(pose(p), radiusOf(p.mass), look(id, p), time, dt);
        view.setInfected(p.infection > 0);
      }
      for (const [id, view] of views) {
        if (!players.has(id)) {
          view.dispose();
          views.delete(id);
        }
      }
    },
    get: (id: string) => views.get(id),
  };
}
