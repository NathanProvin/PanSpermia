import { createSprites } from './sprites.ts';

// Feeding made visible (user direction): when the player kills or swallows prey, or picks up DNA, motes stream from
// where it was into the player's body along curved paths — orange droplets of energy, green twists of DNA, the HUD's
// colour code. Staggered, accelerating as they near the body, swelling and vanishing into it. Drawn as matter
// (premultiplied) above the cells so they read on sand and water alike.
// Kind rides in the integer part of aSeed (0 energy, 1 DNA), the mote's progress in the fraction.
const FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying float vSeed;
void main() {
  float kind = floor(vSeed);
  float t = fract(vSeed);
  vec2 p = vUv * 2.0 - 1.0;
  float r2 = dot(p, p);
  float core = exp(-r2 * 9.0);
  float glow = exp(-r2 * 2.5) * 0.45;
  vec3 col;
  if (kind < 0.5) {
    col = mix(vec3(1.0, 0.55, 0.16), vec3(1.0, 0.86, 0.6), core); // energy: a warm droplet
  } else {
    float a = atan(p.y, p.x);
    float twist = exp(-pow((sqrt(r2) - 0.38 - 0.1 * sin(a * 3.0 + t * 20.0)) / 0.08, 2.0)); // a tiny coiled strand
    col = mix(vec3(0.45, 0.74, 0.2), vec3(0.85, 0.97, 0.6), core);
    core = max(core * 0.7, twist);
  }
  float fade = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.88, 1.0, t));
  float a = clamp(core + glow, 0.0, 1.0) * fade;
  gl_FragColor = vec4(col * a, a * 0.85);
}
`;
const CAPACITY = 160;

interface Mote { kind: number; x: number; y: number; bend: number; delay: number; life: number; age: number; size: number }

export function createFeast() {
  const sprites = createSprites(CAPACITY, FRAGMENT, 12, true); // above the cells (10)
  const motes: Mote[] = [];
  return {
    objects: [sprites.mesh],
    /**
     * Motes of `kind` (0 energy, 1 DNA) from a disc of radius `r` at (x, y) toward the player, `count` of them,
     * each `size` world units.
     */
    burst(kind: number, x: number, y: number, r: number, count: number, size: number) {
      for (let k = 0; k < count && motes.length < CAPACITY; k++) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random()) * r;
        motes.push({
          kind, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, bend: (Math.random() - 0.5) * 1.6,
          delay: Math.random() * 0.35, life: 0.8 + Math.random() * 0.45, age: 0, size: size * (0.7 + 0.6 * Math.random()),
        });
      }
    },
    /** Move the motes toward `target` (the player's body: centre and radius). */
    update(dt: number, time: number, focus: number, target: { x: number; y: number; radius: number } | undefined) {
      let i = 0;
      for (let k = motes.length - 1; k >= 0; k--) {
        const m = motes[k]!;
        m.age += dt;
        const t = Math.max(0, m.age - m.delay) / m.life;
        if (t >= 1 || !target) {
          motes.splice(k, 1);
          continue;
        }
        // A curve from where it came from into the body: eased in (it accelerates), bowed to one side.
        const e = t * t * (3 - 2 * t) * t;
        const dx = target.x - m.x;
        const dy = target.y - m.y;
        const bow = Math.sin(Math.PI * e) * m.bend * 0.35;
        sprites.offsets[i * 3] = m.x + dx * e - dy * bow;
        sprites.offsets[i * 3 + 1] = m.y + dy * e + dx * bow;
        sprites.offsets[i * 3 + 2] = 0;
        sprites.sizes[i] = m.size * (1 + 0.6 * Math.sin(Math.PI * t));
        sprites.seeds[i] = m.kind + Math.min(0.999, t);
        i++;
      }
      sprites.commit(i);
      sprites.setFrame(time, focus);
    },
  };
}
