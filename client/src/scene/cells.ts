import { GENES, type Placement, type Player, SIDEROPHORE_REACH, hasGene, radiusOf } from '@panspermia/shared';
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
varying vec2 vUv;
${NOISE}
void main() {
  vec2 p = (vUv * 2.0 - 1.0) * ${QUAD_HALF.toFixed(2)}; // in cell radii
  float a = atan(p.y, p.x);
  float r = length(p);
  float t = uTime + uSeed * 100.0;
  vec2 fwd = vec2(cos(uHeading), sin(uHeading));
  float rim = 1.0 + 0.035 * sin(3.0 * a + t * 1.1) + 0.025 * sin(5.0 * a - t * 1.6) + 0.012 * sin(9.0 * a + t * 2.4);
  // Division: the membrane pinches in where it crosses the axis (sides), a breathing furrow.
  float side = cos(a - uHeading);
  rim -= uCyst * (0.16 + 0.03 * sin(t * 2.0)) * exp(-side * side * 10.0);
  float d = r - rim; // signed distance in radii, < 0 inside
  float aa = fwidth(d) * 1.5;
  float inside = 1.0 - smoothstep(-aa, aa, d);

  float shell = smoothstep(-0.85, 0.0, d);
  float granules = valueNoise(p * 7.0 + vec2(t * 0.11, -t * 0.08));
  vec2 nucleoidAt = 0.22 * vec2(sin(t * 0.31), cos(t * 0.27));
  float nucleoid = 1.0 - smoothstep(0.0, 0.5, length(p - nucleoidAt));
  // Two daughter nucleoids drifting apart along the axis while dividing.
  float twins = max(1.0 - smoothstep(0.0, 0.35, length(p - fwd * 0.42)), 1.0 - smoothstep(0.0, 0.35, length(p + fwd * 0.42)));
  nucleoid = mix(nucleoid, twins, uCyst);
  vec3 cyto = uColor * (0.22 + 0.42 * shell + 0.22 * granules) * (1.0 - 0.3 * nucleoid);
  float furrow = uCyst * exp(-pow(dot(p, fwd) / 0.08, 2.0)) * inside;
  cyto *= 1.0 - 0.6 * furrow;
  float cytoAlpha = inside * (0.6 + 0.35 * shell);

  float wall = 0.025 + 0.04 * max(uWall, uSpore);
  float membrane = 1.0 - smoothstep(wall, wall + aa, abs(d + wall + 0.005));
  vec3 membraneCol = mix(uColor * 0.85 + 0.04, uColor * 0.45 + vec3(0.09, 0.07, 0.04), uWall);
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

  // Wet glint from a light above-left, using the sphere normal the disc implies.
  vec3 n = vec3(p / max(rim, 1e-3), sqrt(max(0.0, 1.0 - dot(p, p) / (rim * rim))));
  float glint = pow(max(0.0, dot(n, normalize(vec3(-0.45, 0.55, 0.7)))), 28.0) * inside;

  float halo = exp(-max(d, 0.0) * (12.0 - 6.0 * uExo)) * (1.0 - inside) * (0.22 + 0.25 * uExo);
  vec3 haloCol = mix(uColor, vec3(1.0, 0.42, 0.18), uExo);

  // Gene features vanish inside the spore coat.
  float live = 1.0 - uSpore;
  ring *= live; gel *= live; virions *= live; halo *= live;
  cyto = mix(cyto, vec3(0.8, 0.84, 0.74) * (0.3 + 0.45 * shell), uSpore);
  membraneCol = mix(membraneCol, vec3(0.95, 0.97, 0.88), uSpore);

  // Premultiplied alpha.
  vec3 color = cyto * cytoAlpha + membraneCol * membrane + vec3(1.0) * glint * 0.55 + haloCol * halo * 0.6
    + vec3(0.7, 0.95, 0.85) * ring + (uColor * 0.3 + 0.08) * gel * 0.5 + vec3(0.86, 0.8, 1.0) * virions * 1.2;
  float alpha = clamp(cytoAlpha + membrane + halo * 0.5 + ring + gel * 0.35 + virions, 0.0, 1.0);
  gl_FragColor = vec4(color, alpha);
}
`;

// Placed parts, one quad each in the cell's frame. In the quad, +x points away from the body (the
// membrane normal for membrane parts), so every shape grows outward from its base at x = -1. The
// kind is the gene's catalog index.
const PART_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform float uKind;
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
    col = k == ${GENES.bacteriocin.index} ? vec3(0.65, 0.35, 1.0) * 1.5 : vec3(0.85, 1.0, 0.15) * 1.4;
  } else if (k == ${GENES.t6ss.index}) { // a tapered molecular syringe
    float s = (p.x + 0.9) / 1.8; // 0 at the base, 1 at the tip
    float w = 0.28 * (1.0 - s);
    a = step(0.0, s) * step(s, 1.0) * (1.0 - smoothstep(w - 0.03, w + 0.03, abs(p.y)));
    col = vec3(0.85, 0.9, 1.0) * 1.1;
  } else if (k == ${GENES.effluxPump.index}) { // orange pump beads
    a = dots(p, vec2(-0.2, -0.35), 0.24) + dots(p, vec2(-0.2, 0.35), 0.24);
    col = vec3(1.0, 0.6, 0.2) * 1.4;
  } else if (k == ${GENES.endospore.index}) { // the dormant core waiting inside
    float rr = length(p * vec2(1.0, 1.4));
    a = (1.0 - smoothstep(0.6, 0.7, rr)) * (0.3 + 0.7 * smoothstep(0.45, 0.65, rr));
    col = vec3(0.95, 0.97, 0.85);
  }
  a = clamp(a, 0.0, 1.0);
  gl_FragColor = vec4(col * a, a); // premultiplied
}
`;
/** Quad size (cell radii) and how far its centre sits outward from the attachment point (in sizes). */
const PART_SHAPE: Record<number, { size: number; out: number }> = {
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
const FLAGELLUM_LENGTH = 3.2; // cell radii
const BEAT_RUN = 22; // rad/s of wave phase
const BEAT_TUMBLE = 5; // motor reversal during a tumble: the bundle flails slowly

const material = (vertexShader: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>) =>
  new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false, premultipliedAlpha: true });
const bodyGeometry = new THREE.PlaneGeometry(2 * QUAD_HALF, 2 * QUAD_HALF);
const bodyMaterial = material(VERTEX, FRAGMENT, {
  uTime: { value: 0 }, uSeed: { value: 0 }, uColor: { value: new THREE.Color() }, uHeading: { value: 0 },
  uSidero: { value: 0 }, uExo: { value: 0 }, uReach: { value: SIDEROPHORE_REACH }, uCapsule: { value: 0 },
  uWall: { value: 0 }, uSpore: { value: 0 }, uInfect: { value: 0 }, uCyst: { value: 0 },
});
const partGeometry = new THREE.PlaneGeometry(1, 1);
const partMaterial = material(VERTEX, PART_FRAGMENT, {
  uTime: { value: 0 }, uSeed: { value: 0 }, uKind: { value: 0 }, uColor: { value: new THREE.Color() },
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
export interface Pose { x: number; y: number; heading: number; tumble: number; spore: number; cyst: number }
/** What a cell looks like: its expressed genome, where its parts sit, its species hue. */
export interface Look { genome: number; parts: readonly Placement[]; hue: number }

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

  const rebuild = (placements: readonly Placement[]) => {
    for (const { mesh } of parts) {
      frame.remove(mesh);
      mesh.material.dispose();
    }
    parts = [];
    for (const [i, pl] of placements.entries()) {
      const kind = GENES[pl.gene].index;
      if (pl.gene === 'flagellum') {
        const mesh: ShaderMesh = new THREE.Mesh(flagellumGeometry, flagellumMaterial.clone());
        mesh.material.uniforms.uColor!.value = color;
        mesh.material.uniforms.uBeat!.value = seed * 100 + i * 1.7;
        mesh.position.set(pl.x * 0.92, pl.y * 0.92, 0);
        mesh.rotation.z = pl.angle;
        mesh.scale.set(FLAGELLUM_LENGTH * pl.scale, pl.scale, 1);
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
      mesh.position.set(pl.x + Math.cos(pl.angle) * size * shape.out, pl.y + Math.sin(pl.angle) * size * shape.out, 0);
      mesh.rotation.z = pl.angle;
      mesh.scale.setScalar(size);
      mesh.renderOrder = 11;
      frame.add(mesh);
      parts.push({ mesh, flagellum: false });
    }
  };

  return {
    body,
    update(pose: Pose, radius: number, look: Look, time: number, dt: number) {
      const key = look.parts.map((p) => `${p.gene}${p.x.toFixed(3)}${p.y.toFixed(3)}${p.angle.toFixed(3)}${p.scale}`).join();
      if (key !== partsKey) {
        partsKey = key;
        rebuild(look.parts);
      }
      color.setHSL(look.hue, 0.8, 0.42);
      body.position.set(pose.x, pose.y, 0);
      body.scale.setScalar(radius);
      frame.position.set(pose.x, pose.y, 0);
      frame.rotation.z = pose.heading;
      frame.scale.setScalar(radius);
      const dormant = pose.spore > 0 || pose.cyst > 0;
      frame.visible = pose.spore === 0; // a spore coat hides every part; a dividing cell keeps them
      const u = body.material.uniforms;
      u.uTime!.value = time;
      u.uHeading!.value = pose.heading;
      u.uSidero!.value = hasGene(look.genome, 'siderophores') ? 1 : 0;
      u.uExo!.value = hasGene(look.genome, 'exoenzymes') ? 1 : 0;
      u.uCapsule!.value = hasGene(look.genome, 'capsule') ? 1 : 0;
      u.uWall!.value = hasGene(look.genome, 'thickWall') ? 1 : 0;
      u.uSpore!.value = pose.spore > 0 ? 1 : 0;
      u.uCyst!.value = pose.cyst > 0 ? 1 : 0;
      for (const { mesh, flagellum } of parts) {
        if (flagellum) mesh.material.uniforms.uBeat!.value += dt * (dormant ? 0 : pose.tumble > 0 ? BEAT_TUMBLE : BEAT_RUN);
        else mesh.material.uniforms.uTime!.value = time;
      }
    },
    setInfected(infected: boolean) { body.material.uniforms.uInfect!.value = infected ? 1 : 0; },
    /** Scale the whole cell after update (the meteor hatch pop). */
    grow(k: number) {
      body.scale.multiplyScalar(k);
      frame.scale.multiplyScalar(k);
    },
    dispose() {
      rebuild([]);
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
