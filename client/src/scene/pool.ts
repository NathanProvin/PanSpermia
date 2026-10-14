import { WORLD_RADIUS } from '@panspermia/shared';
import * as THREE from 'three';
import { NOISE } from './glsl.ts';

const WORLD_VERTEX = /* glsl */ `
varying vec2 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xy;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

// Pool floor far below the gameplay plane: lit water with slow caustics. Its depth gives parallax
// for free; low-frequency, soft-edged caustics stand in for the defocus at that distance.
const FLOOR_DEPTH = -1400;
const FLOOR_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uRadius;
varying vec2 vWorld;
${NOISE}
void main() {
  vec2 p = vWorld / 520.0;
  p += 0.55 * vec2(sin(p.y * 1.3 + uTime * 0.21), cos(p.x * 1.1 - uTime * 0.17));
  // Fine warp curves the straight Voronoi edges into wavy refracted-light filaments.
  p += 0.32 * (vec2(valueNoise(p * 2.3 + uTime * 0.12), valueNoise(p * 2.3 + 17.0 - uTime * 0.1)) - 0.5);
  // Thin bright filaments, softened (the floor is far out of focus) and patchy.
  float c1 = exp(-cellEdge(p, uTime * 0.35) * 9.0);
  float c2 = exp(-cellEdge(p * 1.63 + 7.1, uTime * 0.47) * 11.0);
  float caustics = (c1 * c1 * 0.6 + c2 * c2 * 0.4) * (0.35 + valueNoise(vWorld / 1500.0 - uTime * 0.02));

  // Sunlit pool: brighter toward the middle, shading into the rock beyond the rim.
  float r = length(vWorld) / (uRadius * 1.6);
  float light = 1.0 - smoothstep(0.1, 1.0, r);
  float murk = valueNoise(vWorld / 900.0 + uTime * 0.01);
  vec3 deep = vec3(0.004, 0.022, 0.032);
  vec3 lit = vec3(0.016, 0.085, 0.10) * (0.8 + 0.4 * murk);
  vec3 color = mix(deep, lit, light) + vec3(0.05, 0.16, 0.15) * caustics * (0.1 + 0.5 * light);
  gl_FragColor = vec4(color, 1.0);
}
`;

// Rocky rim of the tide pool at the gameplay plane: the playable disc ends where the rock begins.
const RIM_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uRadius;
varying vec2 vWorld;
${NOISE}
void main() {
  float a = atan(vWorld.y, vWorld.x);
  float jag = (valueNoise(vec2(a * 18.0, 0.0)) - 0.5) * 70.0 + (valueNoise(vWorld / 60.0) - 0.5) * 30.0;
  float d = length(vWorld) - uRadius - 25.0 + jag;
  float rock = smoothstep(-6.0, 6.0, d);
  float grain = valueNoise(vWorld / 140.0) * 0.6 + valueNoise(vWorld / 45.0) * 0.4;
  vec3 rockColor = mix(vec3(0.006, 0.012, 0.014), vec3(0.025, 0.04, 0.038), grain) * (1.0 - smoothstep(0.0, 700.0, d) * 0.7);
  float lip = exp(-abs(d) / 4.0) * 0.35; // wet edge catching the light
  vec3 color = rockColor * rock + vec3(0.25, 0.55, 0.5) * lip;
  gl_FragColor = vec4(color, max(rock, lip)); // premultiplied
}
`;

export function createPool() {
  const uniforms = { uTime: { value: 0 }, uRadius: { value: WORLD_RADIUS } };

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(30000, 30000),
    new THREE.ShaderMaterial({ uniforms, vertexShader: WORLD_VERTEX, fragmentShader: FLOOR_FRAGMENT, depthWrite: false }),
  );
  floor.position.z = FLOOR_DEPTH;
  floor.renderOrder = 0;

  const rim = new THREE.Mesh(
    new THREE.RingGeometry(WORLD_RADIUS - 120, WORLD_RADIUS + 8000, 256, 1),
    new THREE.ShaderMaterial({
      uniforms, vertexShader: WORLD_VERTEX, fragmentShader: RIM_FRAGMENT,
      transparent: true, depthWrite: false, premultipliedAlpha: true,
    }),
  );
  rim.renderOrder = 30; // over plankton and cells that brush the edge

  return {
    objects: [floor, rim],
    update(time: number) { uniforms.uTime.value = time; },
  };
}
