import { type Player, SIDEROPHORE_REACH, hasGene, radiusOf } from '@panspermia/shared';
import * as THREE from 'three';
import { NOISE } from './glsl.ts';

/** Quad half-size in cell radii: room for the wobble, pili, halo and the siderophore reach ring. */
const QUAD_HALF = 1.9;

// Living membrane: wobbling rim, translucent cytoplasm thickening toward the edge (reads as a
// sphere), drifting granules, a diffuse nucleoid (bacteria have no nucleus), a wet specular glint.
// Gene features drawn on top: pili hairs around the rim, chemoreceptor clusters at the leading pole,
// transporter pores in the membrane, a dotted siderophore ring at the absorption reach, a warm
// exoenzyme halo.
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
uniform float uPili;
uniform float uChemo;
uniform float uTrans;
uniform float uSidero;
uniform float uExo;
uniform float uReach;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 p = (vUv * 2.0 - 1.0) * ${QUAD_HALF.toFixed(2)}; // in cell radii
  float a = atan(p.y, p.x);
  float r = length(p);
  float t = uTime + uSeed * 100.0;
  float rim = 1.0 + 0.035 * sin(3.0 * a + t * 1.1) + 0.025 * sin(5.0 * a - t * 1.6) + 0.012 * sin(9.0 * a + t * 2.4);
  float d = r - rim; // signed distance in radii, < 0 inside
  float aa = fwidth(d) * 1.5;
  float inside = 1.0 - smoothstep(-aa, aa, d);

  float shell = smoothstep(-0.85, 0.0, d);
  float granules = valueNoise(p * 7.0 + vec2(t * 0.11, -t * 0.08));
  vec2 nucleoidAt = 0.22 * vec2(sin(t * 0.31), cos(t * 0.27));
  float nucleoid = 1.0 - smoothstep(0.0, 0.5, length(p - nucleoidAt));
  vec3 cyto = uColor * (0.22 + 0.42 * shell + 0.22 * granules) * (1.0 - 0.3 * nucleoid);
  float cytoAlpha = inside * (0.6 + 0.35 * shell);

  float membrane = 1.0 - smoothstep(0.025, 0.025 + aa, abs(d + 0.03));
  vec3 membraneCol = uColor * 0.85 + 0.04;

  // Pili: fine swaying hairs of varied length bristling from the rim.
  float k = a * 26.0 / 6.2831853 + 0.12 * sin(t * 0.9 + d * 18.0);
  float hairLen = 0.08 + 0.12 * hash12(vec2(floor(k), uSeed * 13.0));
  float across = abs(fract(k) - 0.5);
  float hair = uPili * (1.0 - smoothstep(0.04, 0.04 + fwidth(k) * 1.5, across))
    * smoothstep(-0.01, 0.01, d) * (1.0 - smoothstep(hairLen * 0.6, hairLen, d));

  // Chemoreceptor arrays: a few glowing clusters at the leading pole.
  float receptors = 0.0;
  for (int i = -1; i <= 1; i++) {
    float o = uHeading + float(i) * 0.32;
    vec2 at = 0.9 * vec2(cos(o), sin(o));
    receptors += exp(-dot(p - at, p - at) * 700.0);
  }
  receptors *= uChemo;

  // Transporters: bright pores studding the membrane.
  float pores = uTrans * smoothstep(0.7, 0.95, sin(a * 21.0 + t * 0.25)) * (1.0 - smoothstep(0.0, 0.05, abs(d + 0.03)));

  // Siderophores: a faint dotted ring where they reach, slowly rotating.
  float ring = uSidero * exp(-pow((r - uReach) / 0.025, 2.0)) * step(0.5, fract(a * 48.0 / 6.2831853 + t * 0.15)) * 0.45;

  // Wet glint from a light above-left, using the sphere normal the disc implies.
  vec3 n = vec3(p / max(rim, 1e-3), sqrt(max(0.0, 1.0 - dot(p, p) / (rim * rim))));
  float glint = pow(max(0.0, dot(n, normalize(vec3(-0.45, 0.55, 0.7)))), 28.0) * inside;

  float halo = exp(-max(d, 0.0) * (12.0 - 6.0 * uExo)) * (1.0 - inside) * (0.22 + 0.25 * uExo);
  vec3 haloCol = mix(uColor, vec3(1.0, 0.42, 0.18), uExo);

  // Premultiplied alpha.
  vec3 color = cyto * cytoAlpha + membraneCol * (membrane + hair * 0.8) + vec3(1.0) * glint * 0.55
    + haloCol * halo * 0.6 + vec3(1.0, 0.85, 0.55) * receptors * 1.6 + vec3(0.9, 1.0, 0.8) * pores * 1.4
    + vec3(0.7, 0.95, 0.85) * ring;
  float alpha = clamp(cytoAlpha + membrane + hair * 0.7 + halo * 0.5 + receptors + pores + ring, 0.0, 1.0);
  gl_FragColor = vec4(color, alpha);
}
`;

// Flagellum: a tapered whip behind the cell, its helical beat seen side-on as a travelling wave.
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

const bodyGeometry = new THREE.PlaneGeometry(2 * QUAD_HALF, 2 * QUAD_HALF);
const bodyMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 }, uSeed: { value: 0 }, uColor: { value: new THREE.Color() },
    uHeading: { value: 0 }, uPili: { value: 0 }, uChemo: { value: 0 },
    uTrans: { value: 0 }, uSidero: { value: 0 }, uExo: { value: 0 }, uReach: { value: SIDEROPHORE_REACH },
  },
  vertexShader: VERTEX,
  fragmentShader: FRAGMENT,
  transparent: true,
  depthWrite: false,
  premultipliedAlpha: true,
});
const flagellumGeometry = new THREE.PlaneGeometry(1, 1, 48, 1).translate(0.5, 0, 0);
const flagellumMaterial = new THREE.ShaderMaterial({
  uniforms: { uBeat: { value: 0 }, uColor: { value: new THREE.Color() } },
  vertexShader: FLAGELLUM_VERTEX,
  fragmentShader: FLAGELLUM_FRAGMENT,
  transparent: true,
  depthWrite: false,
  premultipliedAlpha: true,
});

/** Stable pseudo-random [0, 1) from a string id. */
function hashId(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 2 ** 32;
}

/** Rendered (predicted or smoothed) pose of a cell. */
export interface Pose { x: number; y: number; heading: number; tumble: number }

interface CellView {
  body: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  flagellum: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
}

export function createCells(scene: THREE.Scene) {
  const views = new Map<string, CellView>();

  const createView = (id: string, isSelf: boolean): CellView => {
    const seed = hashId(id);
    // Species colours arrive with the editor (P4); until then self is green, others hashed hues.
    const color = new THREE.Color().setHSL(isSelf ? 0.42 : seed, 0.8, 0.42);
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial.clone()); // clones share the program
    body.material.uniforms.uColor!.value = color;
    body.material.uniforms.uSeed!.value = seed;
    body.renderOrder = 10;
    const flagellum = new THREE.Mesh(flagellumGeometry, flagellumMaterial.clone());
    flagellum.material.uniforms.uColor!.value = color;
    flagellum.material.uniforms.uBeat!.value = seed * 100;
    flagellum.renderOrder = 9;
    scene.add(body, flagellum);
    return { body, flagellum };
  };

  return {
    update(
      players: Iterable<[string, Player]> & { has(id: string): boolean },
      selfId: string, time: number, dt: number, pose: (p: Player) => Pose,
    ) {
      // ponytail: full diff every frame, fine for ~100 cells; switch to state callbacks if it shows in profiles.
      for (const [id, p] of players) {
        let view = views.get(id);
        if (!view) views.set(id, (view = createView(id, id === selfId)));
        const { x, y, heading, tumble } = pose(p);
        const radius = radiusOf(p.mass);
        const u = view.body.material.uniforms;
        view.body.position.set(x, y, 0);
        view.body.scale.setScalar(radius);
        u.uTime!.value = time;
        u.uHeading!.value = heading;
        u.uPili!.value = hasGene(p.genome, 'pili') ? 1 : 0;
        u.uChemo!.value = hasGene(p.genome, 'chemoreceptor') ? 1 : 0;
        u.uTrans!.value = hasGene(p.genome, 'transporters') ? 1 : 0;
        u.uSidero!.value = hasGene(p.genome, 'siderophores') ? 1 : 0;
        u.uExo!.value = hasGene(p.genome, 'exoenzymes') ? 1 : 0;

        const f = view.flagellum;
        f.visible = hasGene(p.genome, 'flagellum');
        if (f.visible) {
          f.position.set(x - Math.cos(heading) * radius * 0.92, y - Math.sin(heading) * radius * 0.92, 0);
          f.rotation.z = heading + Math.PI;
          f.scale.set(radius * FLAGELLUM_LENGTH, radius, 1);
          f.material.uniforms.uBeat!.value += dt * (tumble > 0 ? BEAT_TUMBLE : BEAT_RUN);
        }
      }
      for (const [id, view] of views) {
        if (!players.has(id)) {
          scene.remove(view.body, view.flagellum);
          view.body.material.dispose();
          view.flagellum.material.dispose();
          views.delete(id);
        }
      }
    },
    get: (id: string) => views.get(id)?.body,
  };
}
