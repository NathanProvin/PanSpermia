import * as THREE from 'three';

/**
 * Lens model for depth of field: blur radius (world units, at the object's depth) per unit of
 * distance from the focal plane. The focal plane is the gameplay plane z = 0.
 */
export const APERTURE = 0.035;

// Camera-facing instanced quads with depth of field baked in: each quad grows by its circle of
// confusion and dims to spread the same light over the larger disc. Transparent sprites never
// reach a depth buffer, so a post-process DOF would blur them by whatever lies behind them.
const VERTEX = /* glsl */ `
attribute vec3 aOffset;
attribute float aSize;
attribute float aSeed;
uniform float uFocus;
uniform float uAperture;
uniform float uCull;
varying vec2 vUv;
varying float vSeed;
varying float vSize;
varying float vSharp;
void main() {
  vec4 view = modelViewMatrix * vec4(aOffset, 1.0);
  float blur = uAperture * abs(-view.z - uFocus);
  float quad = aSize + 2.0 * blur;
  vSharp = aSize / quad;
  // So defocused it would cover almost nothing: skip the quad (all of its fill cost) instead of blending ~0.
  if (vSharp * vSharp < uCull) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  view.xy += position.xy * quad;
  vUv = uv;
  vSeed = aSeed;
  vSize = aSize;
  gl_Position = projectionMatrix * view;
}
`;

export type Sprites = ReturnType<typeof createSprites>;

/**
 * `fragmentShader` receives vUv, vSeed, vSize, vSharp (1 = in focus) and uniform uTime. Additive output by
 * default (light: glows, food); `opaque` = premultiplied alpha over what's behind (matter: silt, flakes).
 */
export function createSprites(capacity: number, fragmentShader: string, renderOrder: number, opaque = false) {
  const quad = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.getAttribute('position'));
  geometry.setAttribute('uv', quad.getAttribute('uv'));

  const attr = (itemSize: number) =>
    new THREE.InstancedBufferAttribute(new Float32Array(capacity * itemSize), itemSize).setUsage(THREE.DynamicDrawUsage);
  const offset = attr(3);
  const size = attr(1);
  const seed = attr(1);
  geometry.setAttribute('aOffset', offset);
  geometry.setAttribute('aSize', size);
  geometry.setAttribute('aSeed', seed);
  geometry.instanceCount = 0;

  const material = new THREE.ShaderMaterial({
    // uFade: free for the shader; uCull: sharpness² below which a sprite isn't drawn (0 = all drawn).
    uniforms: { uTime: { value: 0 }, uFocus: { value: 1 }, uAperture: { value: APERTURE }, uFade: { value: 1 }, uCull: { value: 0 } },
    vertexShader: VERTEX,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: opaque ? THREE.NormalBlending : THREE.AdditiveBlending,
    premultipliedAlpha: opaque,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false; // instances span the whole view; bounds come from the attributes, not the quad
  mesh.renderOrder = renderOrder;

  return {
    mesh,
    offsets: offset.array as Float32Array,
    sizes: size.array as Float32Array,
    seeds: seed.array as Float32Array,
    /** Upload the first `count` instances; call after writing the arrays. */
    commit(count: number) {
      geometry.instanceCount = count;
      offset.needsUpdate = size.needsUpdate = seed.needsUpdate = true;
    },
    setFrame(time: number, focus: number) {
      material.uniforms.uTime!.value = time;
      material.uniforms.uFocus!.value = focus;
    },
  };
}
