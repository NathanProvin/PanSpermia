import { type Player, radiusOf } from '@panspermia/shared';
import * as THREE from 'three';
import { NOISE } from './glsl.ts';

/** Quad half-size in cell radii: room for the wobble and the halo. */
const QUAD_HALF = 1.6;

// Living membrane: wobbling rim, translucent cytoplasm thickening toward the edge (reads as a
// sphere), drifting granules, a diffuse nucleoid (bacteria have no nucleus), a wet specular glint.
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

  // Wet glint from a light above-left, using the sphere normal the disc implies.
  vec3 n = vec3(p / max(rim, 1e-3), sqrt(max(0.0, 1.0 - dot(p, p) / (rim * rim))));
  float glint = pow(max(0.0, dot(n, normalize(vec3(-0.45, 0.55, 0.7)))), 28.0) * inside;

  float halo = exp(-max(d, 0.0) * 12.0) * (1.0 - inside) * 0.22;

  // Premultiplied alpha.
  vec3 color = cyto * cytoAlpha + membraneCol * membrane + vec3(1.0) * glint * 0.55 + uColor * halo * 0.6;
  float alpha = clamp(cytoAlpha + membrane + halo * 0.5, 0.0, 1.0);
  gl_FragColor = vec4(color, alpha);
}
`;
const geometry = new THREE.PlaneGeometry(2 * QUAD_HALF, 2 * QUAD_HALF);
const baseMaterial = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uSeed: { value: 0 }, uColor: { value: new THREE.Color() } },
  vertexShader: VERTEX,
  fragmentShader: FRAGMENT,
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

export function createCells(scene: THREE.Scene) {
  const meshes = new Map<string, THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>>();
  return {
    /** Sync one mesh per player; `position` returns the rendered (predicted/smoothed) position. */
    update(players: Iterable<[string, Player]> & { has(id: string): boolean }, selfId: string, time: number, position: (p: Player) => [number, number]) {
      // ponytail: full diff every frame, fine for ~100 cells; switch to state callbacks if it shows in profiles.
      for (const [id, p] of players) {
        let mesh = meshes.get(id);
        if (!mesh) {
          const material = baseMaterial.clone(); // shares the compiled program, own uniforms
          const seed = hashId(id);
          // Species colours arrive with the editor (P4); until then self is green, others hashed hues.
          material.uniforms.uColor!.value.setHSL(id === selfId ? 0.42 : seed, 0.8, 0.42);
          material.uniforms.uSeed!.value = seed;
          mesh = new THREE.Mesh(geometry, material);
          mesh.renderOrder = 10;
          scene.add(mesh);
          meshes.set(id, mesh);
        }
        const [x, y] = position(p);
        mesh.position.set(x, y, 0);
        mesh.scale.setScalar(radiusOf(p.mass));
        mesh.material.uniforms.uTime!.value = time;
      }
      for (const [id, mesh] of meshes) {
        if (!players.has(id)) {
          scene.remove(mesh);
          mesh.material.dispose();
          meshes.delete(id);
        }
      }
    },
    get: (id: string) => meshes.get(id),
  };
}
