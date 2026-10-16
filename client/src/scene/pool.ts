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

// A rock pool on a salty shore, far below the gameplay plane and seen through a lot of water.
// Everything is low frequency (it is far out of focus). Large slow fields pick each region's bottom —
// bright clear sand flats with soft ripples, dark rock outcrops, green-to-olive seaweed meadows, silt —
// and its depth: shallow water is turquoise or sea green and shows the bottom, deep holes are blue to
// navy and swallow it. Sunlight arrives as broad, heavily blurred patches.
const FLOOR_DEPTH = -1400;
/**
 * The bottom's static fields (sand, rock, weed, depth, water tint, how lit) are baked once into two
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
// Pass 0: water colour + clarity. Pass 1: bottom colour + light (fades away from the pool).
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

  float ripples = 0.5 + 0.5 * sin(dot(w, vec2(0.011, 0.005)) + fbm(w / 420.0) * 5.0);
  vec3 sand = mix(vec3(0.12, 0.11, 0.08), vec3(0.19, 0.17, 0.12), ripples * 0.5 + 0.3 * fbm(w / 190.0));
  vec3 silt = mix(vec3(0.02, 0.028, 0.026), vec3(0.04, 0.046, 0.036), fbm(w / 300.0));
  vec3 rock = mix(vec3(0.008, 0.011, 0.014), vec3(0.03, 0.033, 0.036), fbm(w / 150.0 + 9.0));
  vec3 weed = mix(vec3(0.014, 0.055, 0.03), vec3(0.05, 0.05, 0.018), fbm(w / 260.0 + 3.0)); // green to olive-brown
  vec3 bottom = mix(silt, sand, smoothstep(0.35, 0.6, sandF));
  bottom = mix(bottom, weed, smoothstep(0.56, 0.72, weedF));
  bottom = mix(bottom, rock, smoothstep(0.58, 0.67, rockF)); // outcrops: firmer edges than the soft sand

  vec3 turquoise = vec3(0.02, 0.1, 0.105);
  vec3 seaGreen = vec3(0.025, 0.082, 0.05);
  vec3 blue = vec3(0.012, 0.048, 0.085);
  vec3 navy = vec3(0.006, 0.022, 0.055);
  float depth = smoothstep(0.35, 0.7, deepF); // 0 shallow, 1 a deep hole
  vec3 water = mix(mix(turquoise, seaGreen, smoothstep(0.4, 0.7, tint)), mix(blue, navy, smoothstep(0.4, 0.7, tint)), depth);
  float clarity = 0.7 - 0.45 * depth; // shallow water shows the bottom
  float lit = 1.0 - smoothstep(0.2, 1.0, length(w) / (uRadius * 1.7));
  gl_FragColor = uPass < 0.5 ? vec4(water, clarity) : vec4(bottom, lit);
}
`;
// Live: the baked fields, plus what moves — broad sun patches and blurred caustics.
const FLOOR_FRAGMENT = /* glsl */ `
uniform float uTime;
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
  float lit = b.a;
  float depth = (0.7 - clarity) / 0.45;
  vec2 cp = w / 950.0 + 0.6 * vec2(sin(w.y / 1400.0 + uTime * 0.05), cos(w.x / 1300.0 - uTime * 0.04));
  float glow = smoothstep(0.45, 0.0, cellEdge(cp, uTime * 0.1));
  float sun = 0.5 + 0.5 * fbm2(w / 2100.0 - uTime * 0.006);
  vec3 color = mix(a.rgb, b.rgb * (0.75 + 0.6 * sun), clarity) * (0.4 + 0.75 * lit)
    + vec3(0.05, 0.07, 0.055) * glow * 0.3 * lit * sun * (1.0 - depth * 0.6);
  gl_FragColor = vec4(color, 1.0);
}
`;

// The water column between the bottom and the gameplay plane: an uneven veil of suspended matter — clear
// blue-green water in places, murky with warm brown silt and olive organic haze in others — with faint
// slanted sun shafts. It sits at its own depth, so it slides against the floor and the creatures beyond it:
// atmospheric perspective and parallax for depth. Two-octave noise: it is broad and far out of focus.
const HAZE_DEPTH = -650;
const HAZE_FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec2 vWorld;
${NOISE}
float fbm2(vec2 p) { return (valueNoise(p) * 0.5 + valueNoise(p * 2.03 + 17.1) * 0.25) / 0.75; }
void main() {
  vec2 w = vWorld;
  float density = fbm2(w / 1900.0 + uTime * 0.004);
  float silt = smoothstep(0.35, 0.75, fbm2(w / 2600.0 + 9.0 - uTime * 0.002)); // murky, sediment-laden patches
  vec3 clear = mix(vec3(0.02, 0.06, 0.075), vec3(0.03, 0.07, 0.05), valueNoise(w / 4100.0 + 3.0));
  vec3 murk = mix(vec3(0.075, 0.06, 0.035), vec3(0.05, 0.06, 0.03), valueNoise(w / 1700.0 + 5.0)); // brown silt to olive
  vec3 fog = mix(clear, murk, silt);
  float along = dot(w, normalize(vec2(1.0, 0.35)));
  // Broad, soft, broken-up shafts: wide bands, warped by noise and faded in and out, never a hard line.
  float shafts = pow(0.5 + 0.5 * sin(along / 520.0 + valueNoise(w / 1300.0 + uTime * 0.02) * 6.0 + uTime * 0.05), 3.0);
  shafts *= smoothstep(0.3, 0.7, valueNoise(w / 2000.0 - uTime * 0.01)) * 0.6 * (1.0 - 0.5 * silt);
  float alpha = 0.16 + 0.16 * density + 0.1 * silt;
  vec3 color = fog * (0.8 + 0.5 * density) + vec3(0.07, 0.09, 0.065) * shafts * 0.3;
  gl_FragColor = vec4(color * alpha + vec3(0.05, 0.07, 0.05) * shafts * 0.1, alpha); // premultiplied
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

  const baked = [0, 1].map(() => new THREE.WebGLRenderTarget(BAKE_SIZE, BAKE_SIZE, { type: THREE.HalfFloatType, depthBuffer: false }));
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(30000, 30000),
    new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uWater: { value: baked[0]!.texture }, uBottom: { value: baked[1]!.texture } },
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
