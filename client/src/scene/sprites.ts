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
varying vec2 vUv;
varying float vSeed;
varying float vSize;
varying float vSharp;
void main() {
  vec4 view = modelViewMatrix * vec4(aOffset, 1.0);
  float blur = uAperture * abs(-view.z - uFocus);
  float quad = aSize + 2.0 * blur;
  vSharp = aSize / quad;
  view.xy += position.xy * quad;
  vUv = uv;
  vSeed = aSeed;
  vSize = aSize;
  gl_Position = projectionMatrix * view;
}
`;

export type Sprites = ReturnType<typeof createSprites>;

/** `fragmentShader` receives vUv, vSeed, vSize, vSharp (1 = in focus) and uniform uTime; additive output. */
export function createSprites(capacity: number, fragmentShader: string, renderOrder: number) {
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
    uniforms: { uTime: { value: 0 }, uFocus: { value: 1 }, uAperture: { value: APERTURE } },
    vertexShader: VERTEX,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
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
