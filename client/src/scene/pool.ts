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

/** Fractal value noise in [0, 1]: smooth, natural variation at several scales. */
const FBM = /* glsl */ `
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * valueNoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.9375;
}
`;

// A pond bottom far below the gameplay plane, seen through a lot of water. Everything here is low
// frequency (it is far out of focus): large slow fields pick each region's bottom — sand with soft
// ripples and pebbles, dark silt, mossy patches, weed clumps — and its water tint (clear blue, teal,
// green). Sunlight arrives as broad, heavily blurred patches, not crisp caustic lines.
const FLOOR_DEPTH = -1400;
const FLOOR_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uRadius;
varying vec2 vWorld;
${NOISE}
${FBM}
void main() {
  vec2 w = vWorld;
  float region = fbm(w / 2600.0); // silt ↔ sand
  float green = fbm(w / 1700.0 + 31.7); // mossy patches
  float tint = fbm(w / 3400.0 + 77.0); // which water colour lies over it

  float ripples = 0.5 + 0.5 * sin(dot(w, vec2(0.011, 0.005)) + fbm(w / 420.0) * 5.0);
  vec3 sand = mix(vec3(0.075, 0.066, 0.044), vec3(0.105, 0.092, 0.062), ripples * 0.5 + 0.3 * fbm(w / 190.0));
  // (No pebbles: detail that fine is lost this far out of focus, and any grid of stones reads as a pattern.)
  vec3 silt = mix(vec3(0.018, 0.026, 0.022), vec3(0.034, 0.042, 0.03), fbm(w / 300.0));
  vec3 moss = mix(vec3(0.016, 0.05, 0.026), vec3(0.04, 0.085, 0.034), fbm(w / 230.0 + 3.0));
  float weeds = smoothstep(0.56, 0.74, fbm(w / 540.0 + 11.0));
  vec3 bottom = mix(silt, sand, smoothstep(0.35, 0.65, region));
  bottom = mix(bottom, moss, smoothstep(0.5, 0.72, green) * (1.0 - 0.5 * smoothstep(0.5, 0.7, region)));
  bottom = mix(bottom, vec3(0.01, 0.03, 0.016), weeds * 0.7);

  vec3 blue = vec3(0.012, 0.042, 0.074);
  vec3 teal = vec3(0.01, 0.05, 0.055);
  vec3 pondGreen = vec3(0.022, 0.058, 0.036);
  vec3 water = mix(mix(blue, teal, smoothstep(0.3, 0.52, tint)), pondGreen, smoothstep(0.55, 0.78, tint));

  // Sun patches: very soft, slowly wandering pools of light.
  vec2 cp = w / 950.0 + 0.6 * vec2(sin(w.y / 1400.0 + uTime * 0.05), cos(w.x / 1300.0 - uTime * 0.04));
  float glow = smoothstep(0.45, 0.0, cellEdge(cp, uTime * 0.1));
  float sun = 0.5 + 0.5 * fbm(w / 2100.0 - uTime * 0.006);
  // The pond gets darker and deeper toward and beyond its banks.
  float lit = 1.0 - smoothstep(0.2, 1.0, length(w) / (uRadius * 1.7));

  vec3 color = mix(water, bottom * (0.7 + 0.6 * sun), 0.55) * (0.4 + 0.75 * lit)
    + vec3(0.045, 0.065, 0.045) * glow * 0.3 * lit * sun;
  gl_FragColor = vec4(color, 1.0);
}
`;

// The water column between the bottom and the gameplay plane: a thin, uneven veil of suspended
// particles (blue to green) with faint slanted sun shafts. It sits at its own depth, so it slides
// against the floor and the creatures beyond it: atmospheric perspective and parallax for depth.
const HAZE_DEPTH = -650;
const HAZE_FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec2 vWorld;
${NOISE}
${FBM}
void main() {
  vec2 w = vWorld;
  float density = fbm(w / 1900.0 + uTime * 0.004);
  vec3 fog = mix(vec3(0.02, 0.06, 0.08), vec3(0.03, 0.075, 0.05), fbm(w / 3100.0 + 9.0));
  float along = dot(w, normalize(vec2(1.0, 0.35)));
  // Broad, soft, broken-up shafts: wide bands, warped by noise and faded in and out, never a hard line.
  float shafts = pow(0.5 + 0.5 * sin(along / 520.0 + fbm(w / 1300.0 + uTime * 0.02) * 6.0 + uTime * 0.05), 3.0);
  shafts *= smoothstep(0.4, 0.8, fbm(w / 2000.0 - uTime * 0.01)) * 0.6;
  float alpha = 0.16 + 0.16 * density;
  vec3 color = fog * (0.8 + 0.5 * density) + vec3(0.07, 0.1, 0.075) * shafts * 0.35;
  gl_FragColor = vec4(color * alpha + vec3(0.05, 0.08, 0.06) * shafts * 0.12, alpha); // premultiplied
}
`;

// The pond's bank at the gameplay plane: the playable disc ends at earthy, mossy rock.
const RIM_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uRadius;
varying vec2 vWorld;
${NOISE}
${FBM}
void main() {
  float a = atan(vWorld.y, vWorld.x);
  float jag = (valueNoise(vec2(a * 9.0, 0.0)) - 0.5) * 140.0 + (valueNoise(vec2(a * 31.0, 3.0)) - 0.5) * 50.0
    + (valueNoise(vWorld / 60.0) - 0.5) * 30.0;
  float d = length(vWorld) - uRadius - 25.0 + jag;
  float rock = smoothstep(-8.0, 8.0, d);
  float grain = fbm(vWorld / 160.0);
  vec3 stone = mix(vec3(0.022, 0.02, 0.015), vec3(0.055, 0.05, 0.036), grain);
  float mossy = smoothstep(0.42, 0.68, fbm(vWorld / 260.0 + 4.0)) * (1.0 - smoothstep(0.0, 500.0, d));
  vec3 bank = mix(stone, vec3(0.025, 0.065, 0.03), mossy * 0.85) * (1.0 - smoothstep(0.0, 900.0, d) * 0.75);
  float lip = exp(-abs(d) / 10.0) * 0.12; // a wet edge catching the light
  vec3 color = bank * rock + vec3(0.18, 0.3, 0.22) * lip;
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

  const haze = new THREE.Mesh(
    new THREE.PlaneGeometry(30000, 30000),
    new THREE.ShaderMaterial({
      uniforms, vertexShader: WORLD_VERTEX, fragmentShader: HAZE_FRAGMENT,
      transparent: true, depthWrite: false, premultipliedAlpha: true,
    }),
  );
  haze.position.z = HAZE_DEPTH;
  haze.renderOrder = 0; // sorted by depth among the far layers: between deep and mid-water giants

  const rim = new THREE.Mesh(
    new THREE.RingGeometry(WORLD_RADIUS - 200, WORLD_RADIUS + 8000, 256, 1),
    new THREE.ShaderMaterial({
      uniforms, vertexShader: WORLD_VERTEX, fragmentShader: RIM_FRAGMENT,
      transparent: true, depthWrite: false, premultipliedAlpha: true,
    }),
  );
  rim.renderOrder = 30; // over plankton and cells that brush the edge

  return {
    objects: [floor, haze, rim],
    update(time: number) { uniforms.uTime.value = time; },
  };
}
