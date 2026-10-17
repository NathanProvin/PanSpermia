import {
  DEFAULT_SEGMENTS, GENES, type Placement, type Player, type Segment, speedOf, SIDEROPHORE_REACH, MOLLUSK, TIER2, TIER3, TIER4, animalRim, catalogFor,
  deform, hasGene, isAnimal, radiusOf, shapeUniform, wrapAngle,
} from '@panspermia/shared';
import * as THREE from 'three';
import { NOISE } from './glsl.ts';
import { type Chain, type Spring, chain, segmentTurn, spring, stepSpine, stepSpring, stepWhip } from './rig.ts';

/** Quad half-size in cell radii: room for the wobble, halo and the siderophore reach ring. */
const QUAD_HALF = 1.9;
/** An animal's quad while it calls a mate: room for the pulsing rings around a long curled body. */
const ANIMAL_HALF = 2.8;
/** How far a segment's drawing reaches beyond its centre, in its radii (plate, legs; the head's antennae further). */
const REACH = 2.4;
const HEAD_REACH = 2.9;
/**
 * An animal's shape is its segments', not a stretch of the whole body (which would pull bent segments apart):
 * the shape lays the spine out (longer, or curved) and sets each plate's proportions (half-length along its
 * own axis, half-width across), per shape id: compact, long, curved.
 */
const PLATE: readonly (readonly [number, number])[] = [[0.82, 1], [1.25, 0.78], [1.15, 0.75]];

// Living membrane: wobbling rim, translucent cytoplasm thickening toward the edge (reads as a
// sphere), drifting granules, a diffuse nucleoid (bacteria have no nucleus), a wet specular glint.
// Whole-body genes are drawn here: capsule gel shell, thick dark wall, the dotted siderophore ring at
// the absorption reach, the warm exoenzyme halo. Placed parts are separate quads (see PART_FRAGMENT).
// A phage infection darkens the cytoplasm and fills it with new virions; a division cyst pinches the
// cell across its axis around two separating nucleoids; an endospore is a hard pale husk.
// Eukaryotes (uTier = 1) carry a true nucleus (envelope + nucleolus) and a few vacuoles instead of a nucleoid.
// Animals (uTier = 2) are not cells and have their own branch (drawAnimal): see there.
// The membrane reacts: it wobbles more as the cell swims (stretching along its course), jiggles on impacts,
// flattens where it presses on a neighbour, dimples in where it takes up a packet (pinocytosis: a vesicle
// pinches off and sinks inward), and flashes red when hurt.
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
uniform float uCall;
uniform float uTier;
uniform vec3 uShape; // stretch x, stretch y, bend (shared/shapes.ts)
uniform float uCentre;
uniform vec3 uSeg[8]; // canonical frame, moved every frame by the soft rig (the spine bends)
uniform int uSegN;
uniform float uRadial; // radial plan: segment 0 is the centre, the others hang off it
uniform float uCarapace;
uniform float uJiggle; // 0..1, impacts
uniform float uSpeed; // 0..1 of its top speed
uniform vec2 uContact; // body-frame angle, depth 0..1
uniform vec2 uGulp[4]; // body-frame angle, age 0..1 (≥ 1: none)
uniform float uHurt; // 0..1 flash
uniform vec4 uQuad; // the quad in the body frame: centre xy, half extents zw (cell radii)
uniform vec2 uPlate; // animals: a plate's half-length along its segment's axis and half-width across, × its radius
uniform float uBody; // 0 a tier-3 animal, 1 an arthropod, 2 a mollusk
uniform float uShell; // a mollusk's shell...
uniform vec3 uShellAt; // ...over this spot (body frame xy, radius)
uniform float uFoot; // a mollusk's foot skirt
varying vec2 vUv;
${NOISE}
float angDiff(float x, float y) { float d = x - y; return atan(sin(d), cos(d)); }
float segment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  return length(p - a - ab * clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0));
}
vec2 turn(vec2 v, float a) { return vec2(cos(a) * v.x - sin(a) * v.y, sin(a) * v.x + cos(a) * v.y); }
/** Light from above-left of the screen, turned into the body frame. */
vec3 lightDir() {
  float ch = cos(uHeading), sh = sin(uHeading);
  return normalize(vec3(ch * -0.45 + sh * 0.55, -sh * -0.45 + ch * 0.55, 0.7));
}

// Animals: many-celled bodies, a real step up from a cell. An opaque segmented body: cuticle plates a little
// shorter along the spine than across it (a worm's rings, an insect's tergites), dark furrows between them, a
// paler dorsal ridge, mottling, lit as solid bulging segments; legs rowing along the sides in a wave running
// down the body (metachronal, faster as it swims), antennae on the head and two tail filaments. Radial bodies
// wave tentacles instead. The segments come from the soft rig (the body bends as it follows its head).
// No membrane, nucleus or glow.
// Tier 4 (uBody): an arthropod is hard, crisply jointed chitin plates with dark sutures and a glossy sheen, and
// walks on the legs placed in the editor (no generic legs); a mollusk is one soft, slick body with eye stalks,
// gliding on a rippling foot skirt (foot), the biggest segment under a coiled shell (shell).
vec2 segAxis(int i) { // a segment's forward direction: toward the one ahead (the head: away from the next)
  if (uRadial > 0.5) return i == 0 ? vec2(1.0, 0.0) : normalize(uSeg[i].xy - uSeg[0].xy);
  if (i == 0) return uSegN > 1 ? normalize(uSeg[0].xy - uSeg[1].xy) : vec2(1.0, 0.0);
  return normalize(uSeg[i - 1].xy - uSeg[i].xy);
}
vec4 drawAnimal(vec2 p, float t) {
  float sd = 1e3, d1 = 1e3, d2 = 1e3, limbs = 1e3, eyes = 1e3;
  vec2 q1 = vec2(0.0);
  float r1 = 1.0;
  float row = 3.0 + 9.0 * uSpeed; // leg strokes, rad/s
  float mollusk = step(1.5, uBody);
  float arthropod = step(0.5, uBody) * (1.0 - mollusk);
  float blend = mix(mix(0.06, 0.025, arthropod), 0.28, mollusk); // crisp chitin joints, one soft mollusk body
  for (int i = 0; i < 8; i++) {
    if (i >= uSegN) break;
    vec3 s = uSeg[i];
    // Beyond everything this segment draws (plate, legs; the head's antennae reach further): skip it. Most of an
    // animal's quad is open water, and this loop is the costliest shader in the game.
    float reach = s.z * (i == 0 && uRadial < 0.5 ? ${HEAD_REACH.toFixed(2)} : ${REACH.toFixed(2)});
    if (dot(p - s.xy, p - s.xy) > reach * reach) continue;
    vec2 ax = segAxis(i);
    vec2 side = vec2(-ax.y, ax.x);
    vec2 q = vec2(dot(p - s.xy, ax), dot(p - s.xy, side));
    float di = (length(q / uPlate) - s.z) * min(uPlate.x, uPlate.y);
    if (uJiggle > 0.001) di += uJiggle * 0.03 * s.z * sin(atan(q.y, q.x) * 5.0 + t * 15.0); // impacts only
    float h = clamp(0.5 + 0.5 * (di - sd) / blend, 0.0, 1.0);
    sd = i == 0 ? di : mix(di, sd, h) - blend * h * (1.0 - h); // joined, but each plate still reads
    if (di < d1) { d2 = d1; d1 = di; q1 = q; r1 = s.z; } else if (di < d2) d2 = di;
    for (int k = -1; k <= 1; k += 2) {
      float fk = float(k);
      if (uRadial > 0.5) { // a tentacle waving out of each lobe
        if (i == 0) continue;
        vec2 base = s.xy + ax * s.z * uPlate.x + side * fk * s.z * 0.3 * uPlate.y;
        vec2 dir = turn(ax, fk * 0.25 + 0.3 * sin(t * 1.8 + float(i) * 1.7 + fk));
        vec2 mid = base + dir * s.z * 0.7;
        vec2 tip = mid + turn(dir, 0.5 * sin(t * 2.3 + float(i))) * s.z * 0.6;
        limbs = min(limbs, min(segment(p, base, mid) - 0.05 * s.z, segment(p, mid, tip) - 0.03 * s.z));
      } else if (i == 0 && mollusk > 0.5) { // eye stalks with an eye at each tip, and short oral tentacles below
        vec2 base = s.xy + ax * s.z * 0.55 + side * fk * s.z * 0.35;
        vec2 tip = base + turn(ax, fk * (0.35 + 0.08 * sin(t * 1.3 + fk))) * s.z * (0.95 + 0.1 * sin(t * 0.9 + fk));
        limbs = min(limbs, segment(p, base, tip) - mix(0.08, 0.05, clamp(dot(p - base, ax) / s.z, 0.0, 1.0)) * s.z);
        eyes = min(eyes, length(p - tip) - 0.1 * s.z);
        vec2 oral = s.xy + ax * s.z * 0.85 + side * fk * s.z * 0.18;
        limbs = min(limbs, segment(p, oral, oral + turn(ax, fk * (0.9 + 0.15 * sin(t * 2.0 + fk))) * s.z * 0.45) - 0.05 * s.z);
      } else if (i == 0) { // antennae
        vec2 base = s.xy + ax * s.z * 0.85 * uPlate.x + side * fk * s.z * 0.3 * uPlate.y;
        vec2 dir = turn(ax, fk * (0.45 + 0.1 * sin(t * 1.7 + fk)));
        vec2 mid = base + dir * s.z * (0.9 + 0.3 * arthropod);
        vec2 tip = mid + turn(dir, fk * (0.35 + 0.15 * sin(t * 2.1 - fk))) * s.z * (0.8 + 0.4 * arthropod);
        limbs = min(limbs, min(segment(p, base, mid), segment(p, mid, tip)) - 0.025 * s.z);
      } else if (uBody < 0.5) { // tier 3: a jointed leg each side, swept back, rowing (left and right in antiphase)
        float b = 0.55 + 0.4 * sin(t * row - float(i) * 1.2 + (fk > 0.0 ? 0.0 : 3.14159));
        vec2 base = s.xy + side * fk * s.z * 0.95 * uPlate.y;
        vec2 knee = base + (side * fk * cos(b) - ax * sin(b)) * s.z * 0.6;
        vec2 foot = knee + (side * fk * cos(b + 0.7) - ax * sin(b + 0.7)) * s.z * 0.5;
        limbs = min(limbs, min(segment(p, base, knee) - 0.07 * s.z, segment(p, knee, foot) - 0.045 * s.z));
        if (i == uSegN - 1) { // two tail filaments
          vec2 cb = s.xy - ax * s.z * 0.85 * uPlate.x + side * fk * s.z * 0.25 * uPlate.y;
          vec2 tip = cb + turn(-ax, -fk * (0.3 + 0.12 * sin(t * 2.0 + fk))) * s.z * 0.9;
          limbs = min(limbs, segment(p, cb, tip) - 0.025 * s.z);
        }
      }
    }
  }
  limbs = min(limbs, eyes);
  // Edge softness from the pixel size, not fwidth(sd): skipped segments leave sd and limbs at 1e3, and that
  // jump between neighbouring pixels made fwidth huge along each skip circle (drew faint rings around bodies).
  float aa = length(fwidth(p)) * 1.2;
  float body = 1.0 - smoothstep(-aa, aa, sd);
  // A mollusk's foot: a translucent muscular skirt around the body, its rim rippling with pedal waves.
  float pa = atan(p.y, p.x);
  float skirtW = uFoot * mollusk * (0.11 + 0.025 * sin(pa * 14.0 - t * 3.0));
  float skirt = (1.0 - smoothstep(skirtW - aa, skirtW + aa, sd)) * (1.0 - body) * step(0.001, skirtW);
  float limb = (1.0 - smoothstep(-aa, aa, limbs)) * (1.0 - body);
  if (body + limb + skirt <= 0.0 && uCall <= 0.0) return vec4(0.0); // open water: most of the quad, skip the shading
  // Each plate bulges like a squashed sphere (a mollusk is one soft mound).
  vec2 qn = q1 / uPlate / r1;
  vec3 n = normalize(vec3(qn * mix(0.9, 0.6, mollusk), sqrt(max(0.0, 1.0 - dot(qn, qn)))));
  vec3 L = lightDir();
  float lambert = max(0.0, dot(n, L));
  float furrow = exp(-pow((d2 - d1) / mix(0.03, 0.022, arthropod), 2.0)) * (1.0 - mollusk);
  float ridge = exp(-pow(q1.y / (r1 * 0.22), 2.0));
  float edge = smoothstep(-0.12, 0.0, sd);
  float mottle = valueNoise(p * 9.0 + uSeed * 30.0);
  // Earthy, not a glowing cell: chitin is browner, a mollusk's skin paler and greyer.
  vec3 base = mix(uColor, mix(mix(vec3(0.32, 0.26, 0.17), vec3(0.36, 0.22, 0.12), arthropod), vec3(0.55, 0.52, 0.45), mollusk),
    0.35 + 0.1 * arthropod);
  vec3 col = base * (0.35 + 0.65 * lambert) * (0.85 + 0.25 * mottle);
  col = mix(col, base * 1.25 + 0.03, ridge * 0.35 * (1.0 - mollusk));
  col *= 1.0 - (0.55 + 0.3 * arthropod) * furrow - (0.35 + 0.2 * arthropod) * edge;
  float hard = max(uCarapace, arthropod * 0.6);
  col += pow(max(0.0, dot(reflect(-L, n), vec3(0.0, 0.0, 1.0))), 20.0 - 12.0 * hard) * (0.1 + 0.3 * hard);
  col = mix(col, col * 1.1 + vec3(0.05, 0.045, 0.03), uCarapace * 0.5 * (1.0 - mollusk)); // a carapace: a paler, glossier shell
  // Mollusk skin: dark speckles and a wet, broad sheen.
  col *= 1.0 - mollusk * 0.25 * smoothstep(0.5, 0.9, valueNoise(p * 6.0 + uSeed * 11.0));
  col += mollusk * 0.12 * pow(lambert, 6.0);
  // The shell: a coiled cone over the biggest segment (body frame centre, radius), whorls spiralling out from an apex
  // set back toward the tail, growth lines across them, banded, glossy.
  float shellD = length(p - uShellAt.xy) - uShellAt.z * (1.0 + 0.04 * sin(atan(p.y - uShellAt.y, p.x - uShellAt.x) * 3.0));
  float shell = uShell * mollusk * (1.0 - smoothstep(-aa, aa, shellD));
  if (shell > 0.0) {
    vec2 c = p - uShellAt.xy + uShellAt.z * vec2(0.3, 0.12); // the apex, off-centre
    float rho = max(length(c), 1e-3) / uShellAt.z;
    float theta = atan(c.y, c.x) / 6.2831853;
    float whorl = fract(log(rho) * 0.95 - theta); // a few broad whorls, each a rounded tube wound round the apex
    float suture = smoothstep(0.07, 0.0, whorl) + smoothstep(0.96, 1.0, whorl);
    float tube = sin(whorl * 3.14159);
    float band = smoothstep(0.5, 0.56, whorl) * smoothstep(0.78, 0.72, whorl); // a coloured band along each whorl
    float growth = 0.5 + 0.5 * sin(theta * 160.0 + rho * 6.0);
    vec3 shellCol = mix(vec3(0.86, 0.76, 0.58), vec3(0.45, 0.28, 0.16), band) * (0.6 + 0.4 * tube);
    shellCol = mix(shellCol, uColor * 0.5 + 0.25, 0.2);
    vec3 sn = normalize(vec3(-(p - uShellAt.xy) / uShellAt.z * 0.8, 0.7));
    shellCol *= (0.45 + 0.55 * max(0.0, dot(sn, L))) * (0.92 + 0.08 * growth) * (1.0 - 0.45 * suture);
    shellCol *= 1.0 - 0.4 * smoothstep(-0.08, 0.0, shellD); // the lip's shadow on the body
    shellCol += pow(max(0.0, dot(reflect(-L, sn), vec3(0.0, 0.0, 1.0))), 30.0) * 0.35;
    col = mix(col, shellCol, shell);
  }
  col = mix(col, vec3(0.8, 0.1, 0.06), uHurt * 0.45);
  // Mate call: rings pulsing out from a calling animal.
  float ping = fract(t * 0.6);
  float callRing = uCall * exp(-pow((length(p) - (1.5 + 0.7 * ping)) / 0.04, 2.0)) * (1.0 - ping) * (1.0 - body);
  vec3 limbCol = mix(base * 0.45, base * 0.75, mollusk);
  limbCol = mix(limbCol, vec3(0.03), mollusk * (1.0 - smoothstep(-aa, aa, eyes))); // eyes on the stalks
  vec3 skirtCol = (base * 1.1 + 0.05) * (0.6 + 0.15 * sin(sd * 90.0 - t * 4.0)); // pedal waves
  vec3 color = col * max(body, shell) + limbCol * limb * 0.9 + skirtCol * skirt * 0.55 + (uColor * 0.4 + 0.55) * callRing * 0.5;
  return vec4(color, clamp(max(body, shell) + limb * 0.9 + skirt * 0.55 + callRing, 0.0, 1.0)); // premultiplied
}

void main() {
  vec2 p = uQuad.xy + (vUv * 2.0 - 1.0) * uQuad.zw; // body frame (the quad turns with the cell), cell radii
  // Body shape: undo the bend, then the stretch, so everything below draws the canonical unit disc.
  p.y = (p.y - uShape.z * (p.x * p.x - uCentre * uShape.x * uShape.x)) / uShape.y;
  p.x /= uShape.x;
  float t = uTime + uSeed * 100.0;
  if (uTier > 1.5) {
    gl_FragColor = drawAnimal(p, t);
    return;
  }
  float a = atan(p.y, p.x);
  float r = length(p);
  vec2 fwd = vec2(1.0, 0.0);
  float rim = 1.0 + 0.05 * sin(3.0 * a + t * 1.3) + 0.035 * sin(5.0 * a - t * 1.9) + 0.018 * sin(9.0 * a + t * 2.8)
    + 0.015 * sin(t * 2.1); // breathing
  // Swimming stretches the body along its course and sends a ripple down the sides to the back.
  rim += uSpeed * (0.05 * cos(2.0 * a) + 0.03 * sin(7.0 * a - t * 9.0) * smoothstep(0.0, -1.0, cos(a)));
  // Impacts set it jiggling (decays on the CPU side).
  rim += uJiggle * (0.07 * sin(5.0 * a + t * 15.0) + 0.04 * sin(8.0 * a - t * 21.0));
  // Pressed on a neighbour: flattened there, bulging a little to the sides (the volume goes somewhere).
  float ca = angDiff(a, uContact.x);
  rim += uContact.y * (-0.22 * exp(-ca * ca * 5.0) + 0.06 * exp(-pow(abs(ca) - 1.3, 2.0) * 6.0));
  // Division: the membrane pinches in where it crosses the axis (sides), a breathing furrow.
  float side = cos(a);
  rim -= uCyst * (0.16 + 0.03 * sin(t * 2.0)) * exp(-side * side * 10.0);
  float d = r - rim; // signed distance in radii, < 0 inside
  float euk = step(0.5, uTier);
  float bact = 1.0 - euk;
  // Pinocytosis: the membrane dimples in where a packet is taken up, then a vesicle sinks inward.
  float vesicle = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 g = uGulp[i];
    if (g.y >= 1.0) continue;
    float ga = angDiff(a, g.x);
    d += 0.16 * sin(3.14159 * g.y) * exp(-ga * ga * 30.0);
    vec2 at = vec2(cos(g.x), sin(g.x)) * (0.9 - 0.55 * g.y);
    vesicle += exp(-dot(p - at, p - at) / 0.004) * (1.0 - g.y) * smoothstep(0.0, 0.25, g.y);
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
  membraneCol += uHurt * vec3(1.0, 0.25, 0.15) * 0.9; // hurt: a red flash
  membraneCol += uCyst * (0.12 + 0.08 * sin(t * 3.0)) * vec3(0.6, 1.0, 0.8); // dividing: a living glow

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
  float glint = pow(max(0.0, dot(n, lightDir())), 28.0) * inside;

  float halo = exp(-max(d, 0.0) * (12.0 - 6.0 * uExo)) * (1.0 - inside) * (0.22 + 0.25 * uExo);
  vec3 haloCol = mix(uColor, vec3(1.0, 0.42, 0.18), uExo);

  // Gene features vanish inside the spore coat.
  float live = 1.0 - uSpore;
  ring *= live; gel *= live; virions *= live; halo *= live;
  cyto = mix(cyto, vec3(0.8, 0.84, 0.74) * (0.3 + 0.45 * shell), uSpore);
  membraneCol = mix(membraneCol, vec3(0.95, 0.97, 0.88), uSpore);

  // Premultiplied alpha.
  vec3 color = cyto * cytoAlpha + membraneCol * membrane + vec3(1.0) * glint * 0.25 + haloCol * halo * 0.3
    + (uColor * 0.5 + 0.35) * envelope * inside + vec3(1.0, 0.95, 0.8) * nucleolus * 0.5 * inside
    + vec3(0.7, 0.95, 0.85) * ring + (uColor * 0.3 + 0.08) * gel * 0.5 + vec3(1.0, 0.3, 0.25) * virions * 0.8;
  color += vec3(0.85, 1.0, 0.9) * vesicle * 0.4 * inside;
  color = mix(color, vec3(0.9, 0.12, 0.08) * cytoAlpha, uHurt * 0.35);
  float alpha = clamp(cytoAlpha + membrane + halo * 0.5 + ring + gel * 0.35 + virions, 0.0, 1.0);
  gl_FragColor = vec4(color, alpha);
}
`;

/** Part kinds: a tier-1 gene's catalog index, KIND2 + a tier-2 gene's index, KIND3 + a tier-3 one, KIND4 + a tier-4 one. */
const KIND2 = 16;
const KIND3 = 32;
const KIND4 = 48;

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
    col = vec3(1.0, 0.85, 0.55) * 0.9;
  } else if (k == ${GENES.transporters.index}) { // bright pores studding the membrane
    for (int i = -1; i <= 1; i++) {
      float rr = length(p - vec2(-0.1, float(i) * 0.55));
      a = max(a, exp(-pow((rr - 0.17) / 0.07, 2.0)));
    }
    col = vec3(0.9, 1.0, 0.8) * 0.8;
  } else if (k == ${GENES.siderophores.index}) { // a cluster of iron-scavenging granules
    for (int i = 0; i < 5; i++) {
      vec2 at = 0.55 * vec2(hash12(vec2(float(i), uSeed)) - 0.5, hash12(vec2(uSeed, float(i))) - 0.5) * 2.0;
      at += 0.06 * vec2(sin(t + float(i)), cos(t * 1.3 + float(i)));
      a = max(a, dots(p, at, 0.16));
    }
    col = vec3(0.45, 0.95, 1.0) * 0.8;
  } else if (k == ${GENES.exoenzymes.index}) { // an enzyme vesicle
    float rr = length(p);
    a = (1.0 - smoothstep(0.55, 0.65, rr)) * (0.35 + 0.65 * smoothstep(0.4, 0.6, rr))
      + 0.6 * dots(p, 0.2 * vec2(sin(t), cos(t * 0.8)), 0.15);
    col = vec3(1.0, 0.55, 0.2) * 0.8;
  } else if (k == ${GENES.bacteriocin.index} || k == ${GENES.poreFormer.index}) { // a secretion gland
    vec2 q = p - vec2(-0.55, 0.0);
    float blob = length(q * vec2(1.0, 0.8));
    float pulse = 0.8 + 0.2 * sin(t * 2.5);
    a = (1.0 - smoothstep(0.5, 0.62, blob)) * (0.5 + 0.5 * smoothstep(0.2, 0.55, blob)) * pulse;
    col = k == ${GENES.bacteriocin.index} ? vec3(1.0, 0.22, 0.25) * 0.85 : vec3(1.0, 0.45, 0.15) * 0.85; // danger: red
  } else if (k == ${GENES.t6ss.index}) { // a tapered molecular syringe
    float s = (p.x + 0.9) / 1.8; // 0 at the base, 1 at the tip
    float w = 0.28 * (1.0 - s);
    a = step(0.0, s) * step(s, 1.0) * (1.0 - smoothstep(w - 0.03, w + 0.03, abs(p.y)));
    col = vec3(0.85, 0.9, 1.0) * 0.8;
  } else if (k == ${GENES.effluxPump.index}) { // orange pump beads
    a = dots(p, vec2(-0.2, -0.35), 0.24) + dots(p, vec2(-0.2, 0.35), 0.24);
    col = vec3(1.0, 0.6, 0.2) * 0.8;
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
      * smoothstep(0.6, 0.9, sin(ang * 14.0 + sin(t * 5.0) * 1.3)) * step(-0.6, p.x); // bristles combing hard
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
      float beat = 0.55 * sin(t * 8.0 - fi * 0.9);
      vec2 base = vec2(-0.85, fi * 0.3);
      vec2 dir = vec2(cos(beat), sin(beat));
      float along = clamp(dot(p - base, dir), 0.0, 1.2);
      float stem = length(p - base - dir * along);
      float hairs = smoothstep(0.6, 0.95, sin(along * 30.0)) * (1.0 - smoothstep(0.02, 0.12, stem)) * step(0.1, along);
      a = max(a, max(1.0 - smoothstep(0.025, 0.05, stem), hairs * 0.7) * (1.0 - smoothstep(1.0, 1.2, along)));
    }
    col = vec3(0.92, 0.95, 0.85);
  } else if (k == ${KIND2 + TIER2.GENES.jaw.index} || k == ${KIND3 + TIER3.GENES.mandible.index}) { // two hooked mandibles snapping
    // Idle chewing; a bite (uActive: 0 idle, then 0 → 1 over the snap) gapes wide and slams shut.
    float open = 0.2 + 0.1 * sin(t * 3.0) + 0.85 * sin(3.14159 * uActive);
    for (int side = -1; side <= 1; side += 2) {
      float s = float(side);
      vec2 base = vec2(-0.8, s * 0.22);
      vec2 mid = base + 0.9 * vec2(cos(s * open), sin(s * open));
      vec2 tip = mid + 0.5 * vec2(cos(-s * 0.9), sin(-s * 0.9)); // hooked inward
      float d = min(segment(p, base, mid), segment(p, mid, tip));
      float w = 0.13 - 0.08 * smoothstep(-0.8, 0.8, p.x);
      a = max(a, 1.0 - smoothstep(w - 0.03, w + 0.02, d));
    }
    col = vec3(1.0, 0.86, 0.68) * (0.85 + 0.4 * smoothstep(0.5, 0.75, uActive) * (1.0 - smoothstep(0.75, 1.0, uActive)));
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
    col = vec3(0.9, 0.12, 0.1) * (0.8 + 0.2 * sin(t * 3.0)); // danger: red
  } else if (k == ${KIND2 + TIER2.GENES.electric.index}) { // an electric organ, now and then crackling with thin arcs
    // Arcs only in some 1/8 s moments (not a full new pattern 12 times a second), thin and dim: no bloom, no strobe.
    float lens = 1.0 - smoothstep(0.55, 0.65, length(p * vec2(1.0, 1.4)));
    float moment = floor(t * 8.0);
    float live = step(0.7, hash12(vec2(moment, uSeed * 13.0)));
    float arcs = live * (1.0 - smoothstep(0.0, 0.03, abs(valueNoise(p * 4.0 + moment * 1.7) - 0.5)));
    a = max(lens * 0.55, arcs * 0.6 * smoothstep(0.95, 0.4, length(p)));
    col = vec3(0.45, 0.68, 0.95) * (0.55 + 0.3 * arcs);
  } else if (k == ${KIND2 + TIER2.GENES.jet.index}) { // a nozzle; a bubbling plume while dashing
    float s = (p.x + 0.9) / 1.3; // along the nozzle
    float w = mix(0.14, 0.42, clamp(s, 0.0, 1.0));
    float shell = step(-0.9, p.x) * step(p.x, 0.4) * (1.0 - smoothstep(w - 0.03, w + 0.03, abs(p.y)));
    float rim = exp(-pow((p.x - 0.4) / 0.05, 2.0)) * step(abs(p.y), 0.42);
    float plume = uActive * step(0.4, p.x) * (1.0 - smoothstep(0.1, 0.45, abs(p.y)))
      * smoothstep(0.55, 0.85, valueNoise(p * 7.0 - vec2(t * 14.0, 0.0)));
    a = max(max(shell * 0.85, rim), plume);
    col = mix(vec3(0.85, 0.75, 0.6), vec3(0.8, 0.95, 1.0), plume);
  } else if (k == ${KIND2 + TIER2.GENES.eye.index} || k == ${KIND3 + TIER3.GENES.eye.index} || k == ${KIND4 + TIER4.GENES.eye.index}) { // a Spore-cell eye: sclera, wandering pupil, glint
    float rr = length(p);
    float sclera = 1.0 - smoothstep(0.8, 0.88, rr);
    vec2 look = vec2(0.32, 0.0) + 0.08 * vec2(sin(t * 0.7 + uSeed * 9.0), sin(t * 1.1));
    float pupil = 1.0 - smoothstep(0.32, 0.38, length(p - look));
    float glint = 1.0 - smoothstep(0.08, 0.12, length(p - look - vec2(0.1, 0.12)));
    float outline = sclera * smoothstep(0.7, 0.82, rr);
    a = sclera;
    col = mix(vec3(0.95), vec3(0.05, 0.05, 0.08), max(pupil, outline * 0.8)) + glint * 0.5;
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
    col = vec3(0.35, 1.0, 0.4) * 0.8;
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
  } else if (k == ${KIND4 + TIER4.GENES.legs.index}) { // a jointed walking leg, three segments, stepping
    float stride = sin(t * 5.0);
    vec2 base = vec2(-0.9, 0.0);
    vec2 knee = base + 0.55 * vec2(cos(0.5 + 0.25 * stride), sin(0.5 + 0.25 * stride));
    vec2 ankle = knee + 0.5 * vec2(cos(-0.35 + 0.3 * stride), sin(-0.35 + 0.3 * stride));
    vec2 tip = ankle + 0.4 * vec2(cos(-0.9 + 0.2 * stride), sin(-0.9 + 0.2 * stride));
    float d = min(min(segment(p, base, knee) - 0.12, segment(p, knee, ankle) - 0.09), segment(p, ankle, tip) - 0.05);
    float joints = min(length(p - knee), length(p - ankle)) - 0.11;
    a = 1.0 - smoothstep(-0.02, 0.02, min(d, joints));
    float shine = smoothstep(0.03, -0.06, d) * 0.25;
    col = (uColor * 0.45 + vec3(0.3, 0.24, 0.16)) * (0.8 + shine) * (1.0 - 0.35 * smoothstep(0.0, -0.06, joints));
  } else if (k == ${KIND4 + TIER4.GENES.tailFan.index}) { // a tail fan: five broad plates spreading and flapping
    float flap = 0.18 * sin(t * 4.0);
    for (int i = 0; i < 5; i++) {
      float fi = float(i) - 2.0;
      float dir = fi * (0.32 + flap);
      vec2 base = vec2(-0.8, 0.0);
      vec2 q = p - base;
      vec2 along = vec2(cos(dir), sin(dir));
      float u = dot(q, along);
      float v = dot(q, vec2(-along.y, along.x));
      float plate = step(0.0, u) * (1.0 - smoothstep(1.3, 1.45, u)) * (1.0 - smoothstep(0.1 + 0.16 * u, 0.14 + 0.16 * u, abs(v)));
      a = max(a, plate * (0.75 + 0.25 * smoothstep(0.08, 0.0, abs(v) - 0.12 * u)));
    }
    col = uColor * 0.5 + vec3(0.32, 0.26, 0.18);
  } else if (k == ${KIND4 + TIER4.GENES.claw.index}) { // a crab's claw: arm, swollen palm, a fixed finger and a hinged one that snaps
    float open = 0.12 + 0.05 * sin(t * 2.0) + 0.6 * sin(3.14159 * uActive);
    float arm = segment(p, vec2(-0.95, 0.0), vec2(-0.3, 0.0)) - 0.1;
    float palm = length((p - vec2(0.05, 0.0)) * vec2(0.8, 1.15)) - 0.34;
    float fixedFinger = segment(p, vec2(0.3, -0.13), vec2(0.95, -0.02)) - mix(0.12, 0.025, clamp((p.x - 0.3) / 0.65, 0.0, 1.0));
    vec2 hinge = vec2(0.3, 0.14);
    vec2 tip = hinge + 0.66 * vec2(cos(open - 0.12), sin(open - 0.12));
    float moving = segment(p, hinge, tip) - mix(0.1, 0.025, clamp(dot(p - hinge, normalize(tip - hinge)) / 0.66, 0.0, 1.0));
    float d = min(min(arm, palm), min(fixedFinger, moving));
    a = 1.0 - smoothstep(-0.02, 0.02, d);
    float shade = 0.75 + 0.35 * smoothstep(0.0, -0.15, palm) - 0.25 * smoothstep(-0.03, 0.0, d); // rounded, dark rim
    col = (uColor * 0.35 + vec3(0.42, 0.24, 0.14)) * shade
      + vec3(0.25, 0.2, 0.15) * smoothstep(0.5, 0.75, uActive) * (1.0 - smoothstep(0.75, 1.0, uActive));
  } else if (k == ${KIND4 + TIER4.GENES.maxillae.index}) { // grazing mouthparts: little bristly palps working at the food
    for (int i = -1; i <= 1; i += 2) {
      float s = float(i);
      float work = 0.35 * sin(t * 7.0 + s);
      vec2 base = vec2(-0.8, s * 0.25);
      vec2 tip = base + 0.9 * vec2(cos(s * (0.3 + work)), sin(s * (0.3 + work)));
      float palp = segment(p, base, tip) - 0.09;
      float hairs = smoothstep(0.55, 0.9, sin(dot(p - base, vec2(1.0, s)) * 40.0)) * (1.0 - smoothstep(0.0, 0.12, palp)) * step(0.0, palp);
      a = max(a, max(1.0 - smoothstep(-0.02, 0.02, palp), hairs * 0.6));
    }
    col = uColor * 0.4 + vec3(0.45, 0.4, 0.3);
  } else if (k == ${KIND4 + TIER4.GENES.siphon.index}) { // a muscular siphon: a funnel that pulses with each jet
    float pulse = 0.08 * sin(t * 6.0);
    float s = (p.x + 0.9) / 1.4;
    float w = mix(0.18, 0.4 + pulse, clamp(s, 0.0, 1.0));
    float tube = step(-0.9, p.x) * step(p.x, 0.5) * (1.0 - smoothstep(w - 0.03, w + 0.03, abs(p.y)));
    float lip = exp(-pow((p.x - 0.5) / 0.06, 2.0)) * step(abs(p.y), 0.42 + pulse);
    float bore = (1.0 - smoothstep(w * 0.4, w * 0.55, abs(p.y))) * smoothstep(-0.2, 0.5, p.x) * step(p.x, 0.5);
    a = max(tube * 0.9, lip);
    col = mix(uColor * 0.55 + vec3(0.3, 0.22, 0.2), vec3(0.08, 0.05, 0.06), bore * 0.8);
  } else if (k == ${KIND4 + TIER4.GENES.radula.index}) { // a radula: a ribbon of teeth rasping in and out
    float reach = 0.3 + 0.25 * sin(t * 4.0);
    float ribbon = step(-0.9, p.x) * step(p.x, -0.2 + reach) * (1.0 - smoothstep(0.22, 0.27, abs(p.y)));
    vec2 g = vec2(fract((p.x - t * 0.6) * 6.0) - 0.5, p.y * 3.0);
    float teeth = (1.0 - smoothstep(0.15, 0.3, length(g * vec2(1.0, 0.7)))) * ribbon;
    float lips = (1.0 - smoothstep(0.35, 0.42, length((p - vec2(-0.75, 0.0)) * vec2(1.6, 1.0)))) * smoothstep(0.18, 0.3, abs(p.y));
    a = max(ribbon * 0.85, lips);
    col = mix(uColor * 0.5 + vec3(0.35, 0.2, 0.2), vec3(0.95, 0.9, 0.75), teeth);
  } else if (k == ${KIND4 + TIER4.GENES.beak.index}) { // a parrot beak: two dark hooked halves of chitin
    float open = 0.08 + 0.04 * sin(t * 2.5) + 0.45 * sin(3.14159 * uActive);
    float d = 1e3;
    for (int side = -1; side <= 1; side += 2) {
      float s = float(side);
      vec2 base = vec2(-0.7, s * 0.05);
      vec2 tip = base + vec2(1.2, 0.0) + vec2(0.0, s * open);
      vec2 hook = tip + vec2(-0.12, -s * 0.22);
      float w = mix(0.3, 0.04, clamp((p.x + 0.7) / 1.2, 0.0, 1.0));
      vec2 q = p - vec2(0.0, s * open * clamp((p.x + 0.7) / 1.2, 0.0, 1.0));
      float half_ = (s * q.y > -0.02 ? abs(q.y) - w : 1e3);
      d = min(d, min(max(half_, max(-0.7 - p.x, p.x - tip.x)), segment(p, tip, hook) - 0.05));
    }
    a = 1.0 - smoothstep(-0.02, 0.02, d);
    col = vec3(0.12, 0.1, 0.09) + vec3(0.25, 0.2, 0.15) * smoothstep(0.0, -0.12, d) * 0.6;
  } else if (k == ${GENES.endospore.index}) { // the dormant core waiting inside
    float rr = length(p * vec2(1.0, 1.4));
    a = (1.0 - smoothstep(0.6, 0.7, rr)) * (0.3 + 0.7 * smoothstep(0.45, 0.65, rr));
    col = vec3(0.95, 0.97, 0.85);
  }
  a = clamp(a, 0.0, 1.0);
  gl_FragColor = vec4(col * a, a); // premultiplied
}
`;
const kindOf = (tier: number, gene: string) => [0, 0, KIND2, KIND3, KIND4][tier]! + catalogFor(tier).GENES[gene]!.index;
/** Quad size (cell radii) and how far its centre sits outward from the attachment point (in sizes). */
const PART_SHAPE: Record<number, { size: number; out: number }> = {
  [KIND2 + TIER2.GENES.cilia.index]: { size: 0.7, out: 0.25 },
  [KIND2 + TIER2.GENES.filter.index]: { size: 0.55, out: 0.2 },
  [KIND2 + TIER2.GENES.jaw.index]: { size: 0.8, out: 0.4 },
  [KIND2 + TIER2.GENES.spike.index]: { size: 0.6, out: 0.45 },
  [KIND2 + TIER2.GENES.poison.index]: { size: 0.45, out: 0.1 },
  [KIND2 + TIER2.GENES.electric.index]: { size: 0.5, out: 0 },
  [KIND2 + TIER2.GENES.jet.index]: { size: 0.6, out: 0.35 },
  [KIND2 + TIER2.GENES.eye.index]: { size: 0.32, out: 0 },
  [KIND3 + TIER3.GENES.paddle.index]: { size: 0.7, out: 0.35 },
  [KIND3 + TIER3.GENES.filterComb.index]: { size: 0.45, out: 0.3 },
  [KIND3 + TIER3.GENES.mandible.index]: { size: 0.65, out: 0.35 },
  [KIND3 + TIER3.GENES.eye.index]: { size: 0.22, out: 0 },
  [KIND4 + TIER4.GENES.legs.index]: { size: 0.75, out: 0.4 },
  [KIND4 + TIER4.GENES.tailFan.index]: { size: 0.7, out: 0.4 },
  [KIND4 + TIER4.GENES.claw.index]: { size: 1, out: 0.45 },
  [KIND4 + TIER4.GENES.maxillae.index]: { size: 0.45, out: 0.25 },
  [KIND4 + TIER4.GENES.siphon.index]: { size: 0.5, out: 0.35 },
  [KIND4 + TIER4.GENES.radula.index]: { size: 0.45, out: 0.25 },
  [KIND4 + TIER4.GENES.beak.index]: { size: 0.45, out: 0.25 },
  [KIND4 + TIER4.GENES.eye.index]: { size: 0.18, out: 0 },
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

/** Points per whip chain (the soft rig simulates them; the flagellum shader draws along them). */
const WHIP_POINTS = 12;
// Flagellum: a tapered whip laid along its simulated chain (body frame, cell radii), its helical beat seen
// side-on as a travelling wave across the chain.
const FLAGELLUM_VERTEX = /* glsl */ `
uniform float uBeat;
uniform float uWidth;
uniform vec2 uChain[${WHIP_POINTS}];
varying float vAlong;
varying float vAcross;
void main() {
  float s = position.x; // 0 at the cell, 1 at the tip
  float f = s * ${(WHIP_POINTS - 1).toFixed(1)};
  int i = int(min(floor(f), ${(WHIP_POINTS - 2).toFixed(1)}));
  vec2 a = uChain[i];
  vec2 b = uChain[i + 1];
  vec2 dir = normalize(b - a + 1e-6);
  float across = position.y * mix(0.22, 0.06, s) + 0.24 * s * sin(s * 9.0 - uBeat);
  vec2 pos = mix(a, b, f - float(i)) + vec2(-dir.y, dir.x) * across * uWidth;
  vAlong = s;
  vAcross = position.y * 2.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 0.0, 1.0);
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
/** Seconds a mouthpart snap and a pinocytosis dimple last. */
const BITE_ANIM = 0.45;
const GULP_TIME = 0.6;
const FLAGELLUM_LENGTH = [0, 3.2, 2.2, 1.3, 1.3]; // cell radii, per tier (a eukaryote's whip is shorter; an animal's tail)
/** How thick a whip is (× part scale) and how fast it beats (× BEAT_RUN), per tier: an animal's tail is stout and slow. */
const WHIP = [{ width: 1, beat: 1 }, { width: 1, beat: 1 }, { width: 1, beat: 1 }, { width: 3, beat: 0.35 }, { width: 3, beat: 0.35 }];
const BEAT_RUN = 22; // rad/s of wave phase
const BEAT_TUMBLE = 5; // motor reversal during a tumble: the bundle flails slowly
// Secondary motion (visual only): parts trail a turn and a sideways push, then spring back.
// Stiffness k (1/s²) and damping c (1/s) per part feel.
const SOFT = { k: 45, c: 5 };
const FIRM = { k: 90, c: 9 };
const STIFF = { k: 160, c: 16 };
const SOFT_PARTS = new Set(['pili', 'cilia', 'filterComb', 'adhesin', 'paddle', 'tailFan', 'maxillae']);
const STIFF_PARTS = new Set(['jaw', 'mandible', 'eye', 'spike', 't6ss', 'jet', 'filter', 'claw', 'beak', 'radula', 'siphon']);
const MOUTHS = new Set(['jaw', 'mandible', 'claw', 'beak']);
const PART_LAG = 0.08; // rad of trailing per rad/s of turning
const PART_PUSH = 0.05; // rad per cell radius/s² of sideways acceleration
const PART_SWING = 0.5; // rad, at most
const SLOSH = 0.02; // an organelle shifts this many cell radii per radius/s² of acceleration...
const SLOSH_MAX = 0.08; // ...up to this
// The body bows into a turn (rods and crescents most), on a spring so it overshoots a little as the turn ends.
const FLEX = 0.08; // extra bend per rad/s of turning
const FLEX_MAX = 0.25;
const FLEX_SPRING = { k: 60, c: 8 };
const clamp = (v: number, max: number) => Math.max(-max, Math.min(max, v));

const material = (vertexShader: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>) =>
  new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false, premultipliedAlpha: true });
const bodyGeometry = new THREE.PlaneGeometry(2 * QUAD_HALF, 2 * QUAD_HALF);
const bodyMaterial = material(VERTEX, FRAGMENT, {
  uTime: { value: 0 }, uSeed: { value: 0 }, uColor: { value: new THREE.Color() }, uHeading: { value: 0 },
  uSidero: { value: 0 }, uExo: { value: 0 }, uReach: { value: SIDEROPHORE_REACH }, uCapsule: { value: 0 },
  uWall: { value: 0 }, uSpore: { value: 0 }, uInfect: { value: 0 }, uCyst: { value: 0 }, uCall: { value: 0 }, uTier: { value: 0 },
  uJiggle: { value: 0 }, uSpeed: { value: 0 }, uContact: { value: new THREE.Vector2() }, uHurt: { value: 0 },
  uGulp: { value: Array.from({ length: 4 }, () => new THREE.Vector2(0, 1)) },
  uShape: { value: new THREE.Vector3(1, 1, 0) }, uCentre: { value: 1 / 3 },
  uSeg: { value: Array.from({ length: 8 }, (_, i) => new THREE.Vector3(...(DEFAULT_SEGMENTS[i] ?? [0, 0, 0]))) },
  uSegN: { value: DEFAULT_SEGMENTS.length }, uRadial: { value: 0 }, uCarapace: { value: 0 }, uBody: { value: 0 }, uShell: { value: 0 }, uFoot: { value: 0 }, uShellAt: { value: new THREE.Vector3() }, uQuad: { value: new THREE.Vector4(0, 0, QUAD_HALF, QUAD_HALF) }, uPlate: { value: new THREE.Vector2(...PLATE[0]!) },
});
const partGeometry = new THREE.PlaneGeometry(1, 1);
const partMaterial = material(VERTEX, PART_FRAGMENT, {
  uTime: { value: 0 }, uSeed: { value: 0 }, uKind: { value: 0 }, uActive: { value: 0 }, uColor: { value: new THREE.Color() },
});
const flagellumGeometry = new THREE.PlaneGeometry(1, 1, 48, 1).translate(0.5, 0, 0);
// The vertex shader lays a whip along its chain: bound the longest one (cell radii) so culling still works.
flagellumGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 8);
const flagellumMaterial = material(FLAGELLUM_VERTEX, FLAGELLUM_FRAGMENT, {
  uBeat: { value: 0 }, uWidth: { value: 1 }, uColor: { value: new THREE.Color() },
  uChain: { value: Array.from({ length: WHIP_POINTS }, (_, i) => new THREE.Vector2(i / (WHIP_POINTS - 1), 0)) },
});

/** Stable pseudo-random [0, 1) from a string id. */
export function hashId(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 2 ** 32;
}

/** Rendered (predicted or smoothed) pose of a cell. */
export interface Pose { x: number; y: number; heading: number; tumble: number; spore: number; cyst: number; dash?: number; call?: number }
/** What a cell looks like: its tier, that tier's expressed genome, where its parts sit, its species hue. */
export interface Look {
  tier: number; genome: number; parts: readonly Placement<string>[]; hue: number; shape?: number;
  /** An animal's body (segmentsOf); the default body when absent. */
  segments?: readonly Segment[];
  /** Its body plan (PLAN_NAMES): a tier-4 arthropod or mollusk. */
  plan?: number;
}

type ShaderMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;

/** A placed part as drawn: its canonical spot, plus the soft rig moving it. */
interface PartView {
  mesh: ShaderMesh; mouth: boolean; internal: boolean;
  /** Canonical spot and facing (a whip's root sits just inside the membrane). */
  x: number; y: number; angle: number;
  /** Quad size (or a whip's length) and outward offset, cell radii. */
  size: number; out: number;
  /** The animal segment it rides (-1: the body itself). */
  seg: number;
  /** A whip's chain; otherwise the part's springs: swing angle, slosh offset. */
  whip?: Chain; feel: { k: number; c: number }; swing: Spring; sx: Spring; sy: Spring;
}

/** Index of the segment whose outline is nearest a canonical point. */
const nearestSegment = (x: number, y: number, segments: readonly Segment[]) => {
  let best = 0;
  for (const [i, [sx, sy, r]] of segments.entries()) {
    const [bx, by, br] = segments[best]!;
    if (Math.hypot(x - sx, y - sy) - r < Math.hypot(x - bx, y - by) - br) best = i;
  }
  return best;
};

/**
 * One drawable cell: a body plus its placed parts in a frame that turns with the heading. A soft rig
 * (rig.ts, visual only) gives it secondary motion: whips trail through the water, an animal's spine follows
 * its head, the body bows into turns, parts lag and spring back.
 */
export function createCellView(parent: THREE.Object3D, seed: number) {
  const color = new THREE.Color();
  const body: ShaderMesh = new THREE.Mesh(bodyGeometry, bodyMaterial.clone()); // clones share the program
  body.material.uniforms.uColor!.value = color;
  body.material.uniforms.uSeed!.value = seed;
  body.renderOrder = 10;
  const frame = new THREE.Group(); // body frame: +x forward, units of cell radii
  parent.add(body, frame);
  let partsKey = '';
  let parts: PartView[] = [];
  /** Reactions (CPU side, decaying): impacts, hurt, smoothed contact and speed, bites, gulps. */
  const feel = { jiggle: 0, hurt: 0, depth: 0, angle: 0, speed: 0, bites: -1, biteAt: -10, health: -1 };
  const gulps: { angle: number; at: number }[] = [];
  let lastPose = { x: 0, y: 0, heading: 0, radius: 1 };
  let beat = 1;
  /** Motion seen frame to frame (world), smoothed: turn rate, velocity, acceleration. Drives the rig. */
  const motion = { live: false, x: 0, y: 0, heading: 0, omega: 0, vx: 0, vy: 0, ax: 0, ay: 0 };
  const flex = spring();
  let spine = chain(0);
  let radial = false;

  const rebuild = (placements: readonly Placement<string>[], tier: number, segments: readonly Segment[]) => {
    for (const { mesh } of parts) {
      frame.remove(mesh);
      mesh.material.dispose();
    }
    parts = [];
    beat = WHIP[tier]!.beat;
    for (const [i, raw] of placements.entries()) {
      const kind = kindOf(tier, raw.gene);
      const slot = catalogFor(tier).GENES[raw.gene]!.slot;
      const whip = raw.gene === 'flagellum' || raw.gene === 'tail';
      const shape = PART_SHAPE[kind];
      if (!whip && !shape) continue; // coats are drawn by the body shader
      // An animal's membrane parts sit on its segmented outline, not the unit circle; a whip leaves from just inside.
      const onRim = (isAnimal(tier) && slot === 'membrane' ? animalRim(raw.angle, segments) : 1) * (whip ? 0.92 : 1);
      const x = raw.x * onRim;
      const y = raw.y * onRim;
      const mesh: ShaderMesh = new THREE.Mesh(whip ? flagellumGeometry : partGeometry, (whip ? flagellumMaterial : partMaterial).clone());
      const u = mesh.material.uniforms;
      u.uColor!.value = color;
      if (whip) {
        u.uBeat!.value = seed * 100 + i * 1.7;
        u.uWidth!.value = WHIP[tier]!.width * raw.scale;
        mesh.renderOrder = 9;
      } else {
        u.uKind!.value = kind;
        u.uSeed!.value = seed + i * 0.37;
        mesh.renderOrder = 11;
      }
      frame.add(mesh);
      parts.push({
        mesh, mouth: MOUTHS.has(raw.gene), internal: slot === 'internal', x, y, angle: raw.angle,
        size: whip ? FLAGELLUM_LENGTH[tier]! * raw.scale : shape!.size * raw.scale, out: shape?.out ?? 0,
        seg: isAnimal(tier) ? nearestSegment(x, y, segments) : -1, whip: whip ? chain(WHIP_POINTS) : undefined,
        feel: SOFT_PARTS.has(raw.gene) ? SOFT : STIFF_PARTS.has(raw.gene) ? STIFF : FIRM, swing: spring(), sx: spring(), sy: spring(),
      });
    }
  };

  return {
    body,
    update(pose: Pose, radius: number, look: Look, time: number, dt: number) {
      const form = look.shape ?? 0;
      const segments = look.segments ?? DEFAULT_SEGMENTS;
      const key = `${look.tier}/${form}/${segments.flat().map((v) => v.toFixed(3))}/` + look.parts.map((p) => `${p.gene}${p.x.toFixed(3)}${p.y.toFixed(3)}${p.angle.toFixed(3)}${p.scale}`).join();
      if (key !== partsKey) {
        partsKey = key;
        rebuild(look.parts, look.tier, segments);
        const seg = body.material.uniforms.uSeg!.value as THREE.Vector3[];
        for (const [i, v] of seg.entries()) v.set(...(segments[i] ?? [0, 0, 0]));
        body.material.uniforms.uSegN!.value = segments.length;
        radial = segments[0]![0] === 0 && segments[0]![1] === 0; // segmentsOf: only a radial centre sits exactly at the origin
        body.material.uniforms.uRadial!.value = radial ? 1 : 0;
        body.material.uniforms.uCentre!.value = shapeUniform(form).centre;
        spine = chain(segments.length);
      }

      // What the body did since the last frame. No motion to react to (editor, card, first frame, a jump
      // such as a respawn): the rig snaps to rest.
      const m = motion;
      const still = dt <= 0 || !m.live || Math.hypot(pose.x - m.x, pose.y - m.y) > 2 * radius;
      if (still) {
        m.omega = m.vx = m.vy = m.ax = m.ay = 0;
        spine.live = false;
        for (const part of parts) if (part.whip) part.whip.live = false;
      } else {
        const k = Math.min(1, dt * 10);
        m.omega += (wrapAngle(pose.heading - m.heading) / dt - m.omega) * k;
        const vx = m.vx + ((pose.x - m.x) / dt - m.vx) * k;
        const vy = m.vy + ((pose.y - m.y) / dt - m.vy) * k;
        m.ax += ((vx - m.vx) / dt - m.ax) * k;
        m.ay += ((vy - m.vy) / dt - m.ay) * k;
        [m.vx, m.vy] = [vx, vy];
      }
      [m.live, m.x, m.y, m.heading] = [true, pose.x, pose.y, pose.heading];
      const step = still ? 0 : dt;
      const ch = Math.cos(pose.heading);
      const sh = Math.sin(pose.heading);
      const toWorld = (bx: number, by: number) => ({ x: pose.x + (bx * ch - by * sh) * radius, y: pose.y + (bx * sh + by * ch) * radius });
      const toBody = (wx: number, wy: number) => {
        const dx = wx - pose.x;
        const dy = wy - pose.y;
        return { x: (dx * ch + dy * sh) / radius, y: (dy * ch - dx * sh) / radius };
      };

      // Cells bow into a turn (an animal bends along its spine instead).
      const s = shapeUniform(form);
      const bow = !isAnimal(look.tier) ? 0.25 + 0.75 * (s.sx / s.sy - 1) : 0;
      stepSpring(flex, clamp(m.omega * FLEX, FLEX_MAX) * bow, FLEX_SPRING.k, FLEX_SPRING.c, step);
      if (isAnimal(look.tier)) { // the shape is in the segment layout and the plates (PLATE), not a body stretch
        body.material.uniforms.uShape!.value.set(1, 1, 0);
        (body.material.uniforms.uPlate!.value as THREE.Vector2).set(...(PLATE[form] ?? PLATE[0]!));
      } else body.material.uniforms.uShape!.value.set(s.sx, s.sy, s.bend + flex.v);

      // Animal: the head leads, the rest of the body follows it through the water.
      const seg = body.material.uniforms.uSeg!.value as THREE.Vector3[];
      const turns: number[] = [];
      // The rest layout in the body frame: the canonical design laid out by the shape (longer, or curved).
      const restBody = isAnimal(look.tier) ? segments.map(([x, y]) => deform(form, x, y)) : [];
      if (isAnimal(look.tier)) {
        const rest = restBody.map((b) => toWorld(b.x, b.y));
        stepSpine(spine, rest, radial, step, Math.hypot(m.vx, m.vy), feel.speed);
        for (const [i, [, , r]] of segments.entries()) {
          const b = toBody(spine.x[i]!, spine.y[i]!);
          seg[i]!.set(b.x, b.y, r);
          turns[i] = segmentTurn(spine, rest, i, radial);
        }
      }
      color.setHSL(look.hue, isAnimal(look.tier) ? 0.55 : 0.8, 0.42); // animal tissue is less saturated than a cell
      body.visible = true;
      // The body's quad: a cell's fixed square; an animal's the bounding box of what its segments draw this
      // frame (most of a fixed square would be open water, and the animal shader is the costliest in the game).
      const quad = body.material.uniforms.uQuad!.value as THREE.Vector4;
      if (isAnimal(look.tier) && !((pose.call ?? 0) > 0)) {
        let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
        for (let i = 0; i < segments.length; i++) {
          const v = seg[i]!;
          const reach = v.z * (i === 0 && !radial ? HEAD_REACH : REACH);
          [x0, y0, x1, y1] = [Math.min(x0, v.x - reach), Math.min(y0, v.y - reach), Math.max(x1, v.x + reach), Math.max(y1, v.y + reach)];
        }
        quad.set((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2);
      } else {
        const half = isAnimal(look.tier) ? ANIMAL_HALF : QUAD_HALF;
        quad.set(0, 0, half, half);
      }
      body.position.set(pose.x + (quad.x * ch - quad.y * sh) * radius, pose.y + (quad.x * sh + quad.y * ch) * radius, 0);
      body.rotation.z = pose.heading; // a rod points where it swims
      body.scale.set((quad.z * radius) / QUAD_HALF, (quad.w * radius) / QUAD_HALF, 1);
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
      u.uCarapace!.value = look.tier === 3 ? (TIER3.hasGene(look.genome, 'carapace') ? 1 : 0)
        : look.tier === 4 && TIER4.hasGene(look.genome, 'exoskeleton') ? 1 : 0;
      const mollusk = look.tier === 4 && look.plan === MOLLUSK;
      u.uBody!.value = look.tier === 4 ? (mollusk ? 2 : 1) : 0;
      u.uShell!.value = mollusk && TIER4.hasGene(look.genome, 'shell') ? 1 : 0;
      u.uFoot!.value = mollusk && TIER4.hasGene(look.genome, 'foot') ? 1 : 0;
      if (mollusk) { // the shell rides the biggest segment, wherever the rig has it
        let big = 0;
        for (const [i, s] of segments.entries()) if (s[2] > segments[big]![2]) big = i;
        const v = seg[big]!;
        (u.uShellAt!.value as THREE.Vector3).set(v.x, v.y, v.z * 0.92);
      }
      u.uSidero!.value = hasGene(g1, 'siderophores') ? 1 : 0;
      u.uExo!.value = hasGene(g1, 'exoenzymes') ? 1 : 0;
      u.uCapsule!.value = hasGene(g1, 'capsule') ? 1 : 0;
      u.uWall!.value = hasGene(g1, 'thickWall') ? 1 : 0;
      u.uSpore!.value = pose.spore > 0 ? 1 : 0;
      u.uCyst!.value = pose.cyst > 0 ? 1 : 0;
      u.uCall!.value = (pose.call ?? 0) > 0 ? 1 : 0;
      lastPose = { x: pose.x, y: pose.y, heading: pose.heading, radius };
      const snap = time - feel.biteAt < BITE_ANIM ? (time - feel.biteAt) / BITE_ANIM : 0;
      for (const part of parts) {
        const { mesh } = part;
        const un = mesh.material.uniforms;
        // On the shaped (and flexing) body, facing its normal there; an animal's part then rides its segment,
        // carried and turned with it (all in the body frame).
        const at = deform(form, part.x, part.y, part.angle, flex.v);
        if (part.seg >= 0) {
          const t = turns[part.seg]!;
          const dx = at.x - restBody[part.seg]!.x;
          const dy = at.y - restBody[part.seg]!.y;
          at.x = seg[part.seg]!.x + dx * Math.cos(t) - dy * Math.sin(t);
          at.y = seg[part.seg]!.y + dx * Math.sin(t) + dy * Math.cos(t);
          at.angle += t;
        }
        if (part.whip) {
          const root = toWorld(at.x, at.y);
          stepWhip(part.whip, root.x, root.y, pose.heading + at.angle, (part.size * radius) / (WHIP_POINTS - 1), step);
          const points = un.uChain!.value as THREE.Vector2[];
          for (const [i, v] of points.entries()) {
            const b = toBody(part.whip.x[i]!, part.whip.y[i]!);
            v.set(b.x, b.y);
          }
          un.uBeat!.value += dt * beat * (dormant ? 0 : pose.tumble > 0 ? BEAT_TUMBLE : BEAT_RUN);
          continue;
        }
        if (part.internal) { // organelles slosh against the acceleration
          const alx = (m.ax * ch + m.ay * sh) / radius;
          const aly = (m.ay * ch - m.ax * sh) / radius;
          stepSpring(part.sx, clamp(-alx * SLOSH, SLOSH_MAX), part.feel.k, part.feel.c, step);
          stepSpring(part.sy, clamp(-aly * SLOSH, SLOSH_MAX), part.feel.k, part.feel.c, step);
        } else { // membrane parts trail the turn and swing against a sideways push
          const phi = pose.heading + at.angle;
          const push = (m.ay * Math.cos(phi) - m.ax * Math.sin(phi)) / radius;
          stepSpring(part.swing, clamp(-m.omega * PART_LAG - push * PART_PUSH, PART_SWING), part.feel.k, part.feel.c, step);
        }
        const a = at.angle + part.swing.v;
        mesh.position.set(at.x + part.sx.v + Math.cos(a) * part.size * part.out, at.y + part.sy.v + Math.sin(a) * part.size * part.out, 0);
        mesh.rotation.z = a;
        mesh.scale.setScalar(part.size);
        un.uTime!.value = time;
        un.uActive!.value = part.mouth ? snap : (pose.dash ?? 0) > 0 ? 1 : 0; // the bite; the jet's plume
      }
      u.uJiggle!.value = feel.jiggle;
      u.uHurt!.value = feel.hurt;
      u.uSpeed!.value = feel.speed;
      (u.uContact!.value as THREE.Vector2).set(feel.angle - pose.heading, feel.depth);
      const g = u.uGulp!.value as THREE.Vector2[];
      for (let i = 0; i < 4; i++) {
        const e = gulps[i];
        g[i]!.set(e ? e.angle - pose.heading : 0, e ? (time - e.at) / GULP_TIME : 1);
      }
    },
    /** Where it was last drawn (world), for gulp and contact lookups. */
    get at() { return lastPose; },
    /**
     * Per-frame reactions from the synced state. Returns an impact strength (0 = none) when something hit it:
     * a new contact, a bite it made, or damage taken.
     */
    react(r: { contactAngle: number; contact: number; speed: number; bites: number; health: number }, time: number, dt: number) {
      let impact = 0;
      if (r.contact > feel.depth + 0.15) impact = Math.max(impact, r.contact); // a new or harder bump
      feel.depth += (r.contact - feel.depth) * Math.min(1, dt * 12);
      if (r.contact > 0) feel.angle = r.contactAngle;
      feel.speed += (r.speed - feel.speed) * Math.min(1, dt * 4);
      if (feel.bites >= 0 && r.bites !== feel.bites) {
        feel.biteAt = time;
        impact = Math.max(impact, 0.5);
      }
      feel.bites = r.bites;
      if (feel.health >= 0 && r.health < feel.health - 0.5) {
        const hit = Math.min(1, (feel.health - r.health) / 20);
        feel.hurt = Math.min(1, feel.hurt + 0.4 + hit);
        impact = Math.max(impact, hit);
      }
      feel.health = r.health;
      feel.jiggle = Math.min(1, feel.jiggle * Math.exp(-dt * 3) + impact);
      feel.hurt *= Math.exp(-dt * 4);
      while (gulps.length && time - gulps[0]!.at > GULP_TIME) gulps.shift();
      return impact;
    },
    /** It took up a packet at world angle `angle` (from its centre): a pinocytosis dimple. */
    gulp(angle: number, time: number) {
      if (gulps.length >= 4) gulps.shift();
      gulps.push({ angle, at: time });
    },
    setInfected(infected: boolean) { body.material.uniforms.uInfect!.value = infected ? 1 : 0; },
    /**
     * Off screen: keep only where it is (labels, gulps) and skip the rig, reactions and uniforms. It comes back
     * at rest, with fresh reaction baselines (no hurt flash for damage taken out of sight).
     */
    park(pose: Pose, radius: number) {
      body.position.set(pose.x, pose.y, 0);
      body.scale.setScalar(radius);
      body.visible = frame.visible = false;
      lastPose = { x: pose.x, y: pose.y, heading: pose.heading, radius };
      motion.live = false;
      feel.bites = feel.health = -1;
    },
    /** Scale the whole cell after update (the meteor hatch pop). */
    grow(k: number) {
      body.scale.multiplyScalar(k);
      frame.scale.multiplyScalar(k);
    },
    dispose() {
      rebuild([], 1, DEFAULT_SEGMENTS);
      parent.remove(body, frame);
      body.material.dispose();
    },
  };
}
export type CellView = ReturnType<typeof createCellView>;

/** `onImpact(id, strength 0..1)`: a cell bumped, bit or got hurt (the game shakes the camera for its own). */
export function createCells(scene: THREE.Scene, onImpact: (id: string, strength: number) => void = () => {}) {
  const views = new Map<string, CellView>();
  return {
    /** `seen`: the visible area on the gameplay plane (centre, half extents); cells outside it are parked. */
    update(
      players: Iterable<[string, Player]> & { has(id: string): boolean },
      time: number, dt: number, pose: (p: Player) => Pose, look: (id: string, p: Player) => Look,
      seen?: { x: number; y: number; halfW: number; halfH: number },
    ) {
      // ponytail: full diff every frame, fine for ~100 cells; switch to state callbacks if it shows in profiles.
      const all: { id: string; p: Player; pose: Pose; r: number }[] = [];
      for (const [id, p] of players) all.push({ id, p, pose: pose(p), r: radiusOf(p.mass, p.tier) });
      for (const c of all) {
        let view = views.get(c.id);
        if (!view) views.set(c.id, (view = createCellView(scene, hashId(c.id))));
        const reach = c.r * 4; // body plus its longest whip
        if (seen && (Math.abs(c.pose.x - seen.x) > seen.halfW + reach || Math.abs(c.pose.y - seen.y) > seen.halfH + reach)) {
          view.park(c.pose, c.r);
          continue;
        }
        // The neighbour it presses on hardest (cells are held at touching distance by the server).
        // ponytail: O(n²) per frame, fine for ~100 cells.
        let contact = 0;
        let contactAngle = 0;
        for (const o of all) {
          if (o === c || o.id.startsWith('~')) continue;
          const dx = o.pose.x - c.pose.x;
          const dy = o.pose.y - c.pose.y;
          const gap = Math.hypot(dx, dy) - c.r - o.r;
          const press = Math.min(1, (c.r * 0.12 - gap) / (c.r * 0.3)) * Math.min(1.5, Math.sqrt(o.r / c.r));
          if (press > contact) [contact, contactAngle] = [press, Math.atan2(dy, dx)];
        }
        const speed = Math.min(1, Math.hypot(c.p.vx, c.p.vy) / speedOf(c.p.mass, c.p.tier));
        const impact = view.react({ contactAngle, contact, speed, bites: c.p.bites, health: c.p.health }, time, dt);
        if (impact > 0) onImpact(c.id, impact);
        view.update(c.pose, c.r, look(c.id, c.p), time, dt);
        view.setInfected(c.p.infection > 0);
      }
      for (const [id, view] of views) {
        if (!players.has(id)) {
          view.dispose();
          views.delete(id);
        }
      }
    },
    get: (id: string) => views.get(id),
    /** A packet vanished at (x, y): the cell whose surface it was at took it up. */
    gulp(x: number, y: number, time: number) {
      let best: CellView | undefined;
      let bestGap = 18; // world units beyond the membrane (siderophores and mouths reach out a little)
      for (const view of views.values()) {
        const { x: cx, y: cy, radius } = view.at;
        const gap = Math.hypot(x - cx, y - cy) - radius * 1.15;
        if (gap < bestGap) [best, bestGap] = [view, gap];
      }
      if (best) best.gulp(Math.atan2(y - best.at.y, x - best.at.x), time);
    },
  };
}
