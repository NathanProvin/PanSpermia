import * as THREE from 'three';

// Far, blurry silhouettes of bigger life — the creatures of later tiers — swimming slowly through the
// water far below the gameplay plane. They give the pond its sense of depth and scale: a water flea
// dwarfs the screen, a tadpole crosses like a whale. Translucent bodies, a faint backlit rim, edges
// softened by how far they are from the focal plane. World-anchored, so perspective adds parallax.

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
// Local frame: x along the body (head at +x), both axes in [-1, 1]. Shapes are signed distances.
const FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uKind;
uniform float uSoft;
uniform float uSeed;
uniform float uAlpha;
varying vec2 vUv;
float segment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  return length(p - a - ab * clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0));
}
float ellipse(vec2 p, vec2 c, vec2 r) { return (length((p - c) / r) - 1.0) * min(r.x, r.y); }
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float t = uTime + uSeed * 37.0;
  int k = int(uKind + 0.5);
  float d = 1.0;
  float detail = 0.0; // darker inner features (eye, gut) that make the shape read as an animal
  if (k == 0) { // water flea (daphnia): carapace, head, eye, branched swimming antennae, tail spine
    d = ellipse(p, vec2(-0.1, 0.0), vec2(0.5, 0.36));
    d = min(d, ellipse(p, vec2(0.38, 0.06), vec2(0.2, 0.18)));
    float beat = 0.25 * sin(t * 3.0);
    for (int s = -1; s <= 1; s += 2) {
      vec2 base = vec2(0.42, 0.12);
      vec2 tip = base + vec2(-0.25, float(s) * (0.55 + beat));
      d = min(d, segment(p, base, tip) - 0.025);
      d = min(d, segment(p, tip, tip + vec2(-0.25, float(s) * 0.1)) - 0.015);
    }
    d = min(d, segment(p, vec2(-0.55, -0.05), vec2(-0.95, -0.12)) - 0.02);
    detail = max(1.0 - smoothstep(0.05, 0.1 + uSoft, length(p - vec2(0.45, 0.08))), // compound eye
      0.6 * (1.0 - smoothstep(0.03, 0.06 + uSoft, segment(p, vec2(0.3, 0.0), vec2(-0.5, -0.05))))); // gut
  } else if (k == 1) { // rotifer: trunk, foot, the two spinning wheels of cilia at the head
    d = ellipse(p, vec2(-0.05, 0.0), vec2(0.5, 0.2));
    d = min(d, segment(p, vec2(-0.5, 0.0), vec2(-0.95, 0.05 * sin(t))) - 0.05);
    for (int s = -1; s <= 1; s += 2) {
      vec2 c = vec2(0.52, float(s) * 0.16);
      float a = atan(p.y - c.y, p.x - c.x) + t * 4.0 * float(s);
      d = min(d, length(p - c) - (0.13 + 0.03 * sin(a * 12.0)));
    }
    detail = 0.6 * (1.0 - smoothstep(0.05, 0.1 + uSoft, ellipse(p, vec2(0.0, 0.0), vec2(0.25, 0.08)))); // gut
  } else if (k == 2) { // nematode: a long sinuous worm
    float x = clamp(p.x, -0.92, 0.92);
    float y = 0.18 * sin(x * 7.0 - t * 2.5);
    float w = 0.05 * (1.0 - 0.6 * abs(x));
    d = length(vec2(p.x - x, p.y - y)) - w;
  } else if (k == 3) { // copepod: teardrop body, thin tail, long antennae swept back
    d = ellipse(p, vec2(0.15, 0.0), vec2(0.42, 0.24));
    d = min(d, segment(p, vec2(-0.2, 0.0), vec2(-0.8, 0.03 * sin(t * 2.0))) - 0.04);
    for (int s = -1; s <= 1; s += 2) d = min(d, segment(p, vec2(0.5, float(s) * 0.05), vec2(-0.1, float(s) * 0.85)) - 0.012);
  } else { // tadpole: big round head, wiggling tail
    d = ellipse(p, vec2(0.45, 0.0), vec2(0.38, 0.32));
    float x = clamp(p.x, -0.95, 0.15);
    float y = 0.12 * sin(x * 6.0 + t * 6.0) * (0.15 - x);
    d = min(d, length(vec2(p.x - x, p.y - y)) - 0.1 * (1.0 + x * 0.6));
  }
  // Every term must reach exactly 0 inside the quad, or its border shows as a straight line.
  float border = 1.0 - smoothstep(0.8, 0.98, max(abs(p.x), abs(p.y)));
  float body = (1.0 - smoothstep(-uSoft, uSoft, d)) * border;
  float rim = exp(-pow(d / (uSoft + 0.02), 2.0)) * border; // backlit membrane, blurred like the rest
  detail *= body;
  vec3 color = vec3(0.004, 0.014, 0.016) * body + vec3(0.09, 0.15, 0.12) * rim;
  float alpha = clamp(body * 0.8 + detail * 0.2 + rim * 0.35, 0.0, 1.0) * uAlpha;
  gl_FragColor = vec4(color * uAlpha, alpha); // premultiplied
}
`;

/**
 * Kinds: 0 water flea, 1 rotifer, 2 nematode, 3 copepod, 4 tadpole. Length in world units, depth z.
 * Few on purpose: one or two in view at a time reads as a living depth, more reads as clutter.
 */
const CAST = [
  { kind: 0, length: 1600, z: -520, speed: 60 }, // above the haze: the nearest, clearest giant
  { kind: 1, length: 1300, z: -950, speed: 35 },
  { kind: 2, length: 2600, z: -1250, speed: 45 },
  { kind: 4, length: 3600, z: -1320, speed: 70 },
] as const;
/** A giant this far from the camera re-enters on a course across the camera's area: regular sightings. */
const RECYCLE = 3200;
/** Seconds between course changes ("legs"), and the steering rate toward a new course. */
const LEG = 28;
const TURN_RATE = 0.12; // rad/s

/** Deterministic pseudo-random in [0, 1) from two numbers: same giant, same leg → same turn. */
const hash = (a: number, b: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export function createGiants() {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const giants = CAST.map((g, i) => {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uKind: { value: g.kind }, uSoft: { value: 0.1 }, uSeed: { value: i * 0.73 }, uAlpha: { value: 1 },
      },
      vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, premultipliedAlpha: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.set(g.length, g.length * (g.kind === 2 ? 0.5 : 0.75), 1);
    mesh.renderOrder = 0; // among the far layers, sorted by depth (the haze veils the deepest ones)
    const angle = (i / CAST.length) * 2 * Math.PI;
    const at = RECYCLE * 0.5;
    // Course = where it is heading this leg; heading = course plus a gentle swimming weave.
    return { ...g, i, mesh, material, x: Math.cos(angle) * at, y: Math.sin(angle) * at, course: angle + Math.PI * 0.8, target: angle + Math.PI * 0.8, leg: -1 };
  });

  return {
    objects: giants.map((g) => g.mesh),
    /**
     * Cruise by fixed rules: straight legs with a gentle weave; at each leg's end, a turn from the giant's
     * own deterministic sequence (never a random spin); out of range, re-enter across the camera's area.
     */
    update(time: number, dt: number, camera: { x: number; y: number; z: number }) {
      const cameraZ = camera.z;
      for (const g of giants) {
        const leg = Math.floor((time + g.i * 7) / LEG);
        if (leg !== g.leg) {
          g.leg = leg;
          const r = hash(g.i, leg);
          g.target = g.course + (r < 0.5 ? -1 : 1) * (0.35 + 0.5 * hash(leg, g.i)); // 20–50° to one side
        }
        if (Math.hypot(g.x - camera.x, g.y - camera.y) > RECYCLE) {
          const from = 2 * Math.PI * hash(g.i, leg + 0.5);
          g.x = camera.x + Math.cos(from) * RECYCLE * 0.8;
          g.y = camera.y + Math.sin(from) * RECYCLE * 0.8;
          g.course = g.target = from + Math.PI + (hash(leg, g.i + 0.5) - 0.5) * 0.6; // across the view
        }
        const diff = Math.atan2(Math.sin(g.target - g.course), Math.cos(g.target - g.course));
        g.course += Math.sign(diff) * Math.min(Math.abs(diff), TURN_RATE * dt);
        const heading = g.course + 0.15 * Math.sin(time * 0.35 + g.i * 2.1);
        // A water flea hops (rhythmic bursts of speed); the others glide.
        const hop = g.kind === 0 ? 0.4 + 1.6 * Math.max(0, Math.sin(time * 1.3 + g.i)) ** 4 : 1;
        g.x += Math.cos(heading) * g.speed * hop * dt;
        g.y += Math.sin(heading) * g.speed * hop * dt;
        g.mesh.position.set(g.x, g.y, g.z);
        g.mesh.rotation.z = heading;
        // Further from focus (deeper below the camera's focal plane) = blurrier and fainter.
        const defocus = (Math.abs(g.z) + 0.3 * cameraZ) / 1400;
        g.material.uniforms.uSoft!.value = 0.04 + 0.09 * defocus;
        g.material.uniforms.uAlpha!.value = 1 - 0.3 * Math.min(1, defocus);
        g.material.uniforms.uTime!.value = time;
      }
    },
  };
}
