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

// A sunny rock pool on a salty shore, far below the gameplay plane and seen through clear water. Everything is
// low frequency (it is far out of focus). Large slow fields pick each region's bottom — cream-to-pale-yellow sand
// flats with wind ripples, grey cracked rock outcrops, mossy-to-leaf-green weed meadows, warm silty sand — and its
// water: bright cyan shallows (pale sand under strong, wave-like caustic filaments), turquoise and sea-green open
// water, a few deeper blue holes. Sunlight arrives as broad blurred patches and refracted-light filaments.
const FLOOR_DEPTH = -1400;
/**
 * The bottom's static fields (sand, rock, weed, depth, water tint, shallows) are baked once into two
 * textures covering BAKE_HALF around the pool centre (wider than any view of the floor): sampling them is a
 * fraction of the cost of ~14 fbm per pixel. ~23 world units per texel, finer than the floor's defocus.
 */
const BAKE_HALF = 12000;
const BAKE_SIZE = 1024;
const BAKE_VERTEX = /* glsl */ `
varying vec2 vWorld;
void main() {
  vWorld = position.xy;
  gl_Position = vec4(position.xy / ${BAKE_HALF.toFixed(1)}, 0.0, 1.0);
}
`;
// Pass 0: water colour + clarity. Pass 1: bottom colour + how much of a cyan shallow it is (caustic strength).
const FLOOR_BAKE = /* glsl */ `
uniform float uRadius;
uniform float uPass;
varying vec2 vWorld;
${NOISE}
${FBM}
void main() {
  vec2 w = vWorld;
  float sandF = fbm(w / 2600.0);
  float rockF = fbm(w / 1800.0 + 5.3);
  float weedF = fbm(w / 1500.0 + 31.7);
  float deepF = fbm(w / 3200.0 + 61.0);
  float tint = fbm(w / 3600.0 + 77.0);
  float cyanF = fbm(w / 2300.0 + 113.0);

  // Sand: cream to light yellow, wind ripples at two scales.
  float ripples = 0.5 + 0.5 * sin(dot(w, vec2(0.011, 0.005)) + fbm(w / 420.0) * 5.0);
  float ripples2 = 0.5 + 0.5 * sin(dot(w, vec2(-0.004, 0.019)) + fbm(w / 250.0 + 2.0) * 4.0);
  // Golden, not white: white food must stand out against it (user report), so the sand is warmer and darker than cream.
  vec3 sand = mix(vec3(0.24, 0.18, 0.08), vec3(0.4, 0.31, 0.14), 0.4 * ripples + 0.25 * ripples2 + 0.35 * fbm(w / 520.0));
  vec3 silt = mix(vec3(0.17, 0.155, 0.1), vec3(0.26, 0.24, 0.16), fbm(w / 700.0)); // warm silty sand
  // Rock: grey, textured, cracked — not a black hole. Broad features only: fine detail on this far, defocused layer
  // reads as grain (DECISIONS: far layers stay low-frequency).
  float cracks = smoothstep(0.05, 0.0, abs(fbm(w / 520.0 + 4.0) - 0.5));
  vec3 rock = mix(vec3(0.06, 0.062, 0.066), vec3(0.17, 0.17, 0.17), fbm(w / 600.0 + 9.0)) * (1.0 - 0.5 * cracks);
  vec3 weed = mix(vec3(0.06, 0.17, 0.04), vec3(0.17, 0.26, 0.05), fbm(w / 600.0 + 3.0)); // mossy to leaf green
  float rockM = smoothstep(0.56, 0.64, rockF);
  vec3 bottom = mix(silt, sand, smoothstep(0.3, 0.55, sandF));
  bottom = mix(bottom, weed, smoothstep(0.58, 0.72, weedF));
  bottom = mix(bottom, rock, rockM); // outcrops: firmer edges than the soft sand
  float shallows = smoothstep(0.55, 0.68, cyanF) * (1.0 - rockM);
  bottom = mix(bottom, sand * 1.05, shallows * 0.75); // sand under the cyan shallows

  vec3 turquoise = vec3(0.03, 0.33, 0.35);
  vec3 seaGreen = vec3(0.07, 0.29, 0.15);
  vec3 blue = vec3(0.015, 0.13, 0.28);
  vec3 deepBlue = vec3(0.008, 0.075, 0.2);
  vec3 cyan = vec3(0.02, 0.5, 0.58);
  float depth = smoothstep(0.48, 0.75, deepF) * (1.0 - shallows) * (1.0 - rockM); // 0 shallow, 1 a deeper hole; rock rises out of it
  vec3 water = mix(mix(turquoise, seaGreen, smoothstep(0.4, 0.7, tint)), mix(blue, deepBlue, smoothstep(0.4, 0.7, tint)), depth);
  water = mix(water, cyan, shallows);
  float clarity = 0.66 - 0.35 * depth + 0.16 * shallows + 0.22 * rockM; // clear water shows the bottom; rock rises close under it
  gl_FragColor = uPass < 0.5 ? vec4(water, clarity) : vec4(bottom, shallows);
}
`;
// Live: the baked fields, plus what moves — broad sun patches, and refracted-light caustics: warped Worley edges in
// thin bright filaments, wave-like, vivid in the cyan shallows and faint elsewhere (P2's caustics, brought back).
const FLOOR_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uRadius;
uniform sampler2D uWater;
uniform sampler2D uBottom;
varying vec2 vWorld;
${NOISE}
float fbm2(vec2 p) { return (valueNoise(p) * 0.5 + valueNoise(p * 2.03 + 17.1) * 0.25) / 0.75; }
void main() {
  vec2 w = vWorld;
  vec2 uv = w / ${(2 * BAKE_HALF).toFixed(1)} + 0.5;
  vec4 a = texture2D(uWater, uv);
  vec4 b = texture2D(uBottom, uv);
  float clarity = a.a;
  float shallow = b.a;
  float lit = 1.0 - smoothstep(0.25, 1.0, length(w) / (uRadius * 1.7)); // sunlit pool, shading off beyond the rim
  float sun = 0.5 + 0.5 * fbm2(w / 2100.0 - uTime * 0.006);
  vec2 p = w / 520.0;
  p += 0.55 * vec2(sin(p.y * 1.3 + uTime * 0.21), cos(p.x * 1.1 - uTime * 0.17));
  p += 0.32 * (vec2(valueNoise(p * 2.3 + uTime * 0.12), valueNoise(p * 2.3 + 17.0 - uTime * 0.1)) - 0.5);
  float c1 = exp(-cellEdge(p, uTime * 0.35) * 9.0);
  float c2 = shallow > 0.02 ? exp(-cellEdge(p * 1.63 + 7.1, uTime * 0.47) * 11.0) : 0.0; // the second layer only where it shows
  float caustics = (c1 * c1 * 0.6 + c2 * c2 * 0.4) * (0.25 + 0.75 * shallow) * (0.55 + 0.45 * sun);
  vec3 color = mix(a.rgb, b.rgb * (0.8 + 0.5 * sun), clarity) * (0.5 + 0.6 * lit)
    + vec3(0.3, 0.68, 0.62) * caustics * 0.8 * clarity * (0.3 + 0.7 * lit);
  gl_FragColor = vec4(color, 1.0);
}
`;

// The water column between the bottom and the gameplay plane: a thin, sunny veil — clear blue-green water with a
// few warm, faintly silty patches — and soft slanted sun shafts. It sits at its own depth, so it slides against the
// floor and the creatures beyond it: atmospheric perspective and parallax. Two-octave noise: broad, out of focus.
const HAZE_DEPTH = -650;
const HAZE_FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec2 vWorld;
${NOISE}
float fbm2(vec2 p) { return (valueNoise(p) * 0.5 + valueNoise(p * 2.03 + 17.1) * 0.25) / 0.75; }
void main() {
  vec2 w = vWorld;
  float density = fbm2(w / 1900.0 + uTime * 0.004);
  float silt = smoothstep(0.5, 0.85, fbm2(w / 2600.0 + 9.0 - uTime * 0.002)); // a few warm, silty patches
  vec3 clear = mix(vec3(0.06, 0.32, 0.33), vec3(0.1, 0.33, 0.2), valueNoise(w / 4100.0 + 3.0));
  vec3 murk = vec3(0.32, 0.29, 0.18);
  vec3 fog = mix(clear, murk, silt * 0.6);
  float along = dot(w, normalize(vec2(1.0, 0.35)));
  // Broad, soft, broken-up shafts: wide bands, warped by noise and faded in and out, never a hard line.
  float shafts = pow(0.5 + 0.5 * sin(along / 520.0 + valueNoise(w / 1300.0 + uTime * 0.02) * 6.0 + uTime * 0.05), 3.0);
  shafts *= smoothstep(0.3, 0.7, valueNoise(w / 2000.0 - uTime * 0.01)) * 0.7;
  float alpha = 0.025 + 0.045 * density + 0.03 * silt;
  vec3 color = fog * (0.85 + 0.4 * density);
  gl_FragColor = vec4(color * alpha + vec3(0.32, 0.3, 0.2) * shafts * 0.06, alpha); // premultiplied
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
  vec3 stone = mix(vec3(0.07, 0.065, 0.055), vec3(0.17, 0.155, 0.12), grain); // sun-warmed grey-brown rock
  float mossy = smoothstep(0.42, 0.68, fbm(vWorld / 260.0 + 4.0)) * (1.0 - smoothstep(0.0, 500.0, d));
  vec3 bank = mix(stone, vec3(0.08, 0.17, 0.05), mossy * 0.85) * (1.0 - smoothstep(0.0, 900.0, d) * 0.6);
  float lip = exp(-abs(d) / 10.0) * 0.15; // a wet edge catching the light
  vec3 color = bank * rock + vec3(0.3, 0.45, 0.35) * lip;
  gl_FragColor = vec4(color, max(rock, lip)); // premultiplied
}
`;

export function createPool() {
  const uniforms = { uTime: { value: 0 }, uRadius: { value: WORLD_RADIUS } };

  const baked = [0, 1].map(() => new THREE.WebGLRenderTarget(BAKE_SIZE, BAKE_SIZE, { type: THREE.HalfFloatType, depthBuffer: false }));
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(30000, 30000),
    new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uWater: { value: baked[0]!.texture }, uBottom: { value: baked[1]!.texture } }, // uRadius: the sunlit falloff
      vertexShader: WORLD_VERTEX, fragmentShader: FLOOR_FRAGMENT, depthWrite: false,
    }),
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
    /** Far, defocused layers (post.far, rendered at reduced resolution). */
    far: [floor, haze],
    objects: [rim],
    update(time: number) { uniforms.uTime.value = time; },
    /** Bake the floor's static fields once, before the first frame. */
    bake(renderer: THREE.WebGLRenderer) {
      const material = new THREE.ShaderMaterial({
        uniforms: { uRadius: { value: WORLD_RADIUS }, uPass: { value: 0 } }, vertexShader: BAKE_VERTEX, fragmentShader: FLOOR_BAKE,
      });
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2 * BAKE_HALF, 2 * BAKE_HALF), material);
      quad.frustumCulled = false; // the vertex shader maps it straight to clip space
      const scene = new THREE.Scene().add(quad);
      for (const [pass, target] of baked.entries()) {
        material.uniforms.uPass!.value = pass;
        renderer.setRenderTarget(target);
        renderer.render(scene, new THREE.Camera());
      }
      renderer.setRenderTarget(null);
      material.dispose();
      quad.geometry.dispose();
    },
  };
}
