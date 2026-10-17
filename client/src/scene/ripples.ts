import { createSprites } from './sprites.ts';

// Water ripples around the player's own body at key moments (polish S5): impacts and bites, a dash, hard
// acceleration, entering a strong current, hatching. Rings stay where they were made and spread out, slowing,
// each a bright crest with a darker trough just inside (a lens on the water), and a smaller ring trailing it.
// Drawn as matter (premultiplied) so they read on the bright sand and the dark water alike.
// Strength rides in the integer part of aSeed (0..9), the life fraction in the fraction.
const FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying float vSeed;
float ring(float r, float R, float w) { return exp(-pow((r - R) / w, 2.0)); }
void main() {
  float s = floor(vSeed) / 9.0;
  float life = fract(vSeed);
  float r = length(vUv * 2.0 - 1.0);
  float r0 = 1.0 / (2.0 + 2.0 * s); // starts at the body's edge
  float ease = 1.0 - (1.0 - life) * (1.0 - life);
  float R = mix(r0, 1.0, ease);
  float R2 = mix(r0, 0.8, max(0.0, ease - 0.15) / 0.85);
  float w = 0.02 + 0.025 * life;
  float fade = (1.0 - life) * (0.4 + 0.6 * s);
  float crest = ring(r, R, w) + 0.5 * ring(r, R2, w) * step(0.15, ease);
  float trough = ring(r, R - 2.2 * w, w) + 0.5 * ring(r, R2 - 2.2 * w, w) * step(0.15, ease);
  float a = (crest * 0.5 + trough * 0.3) * fade;
  gl_FragColor = vec4(vec3(0.95, 1.0, 0.97) * crest * 0.5 * fade, a); // premultiplied: light crest, dark trough
}
`;
const CAPACITY = 24;
const LIFE = 1.2; // s

export function createRipples() {
  const sprites = createSprites(CAPACITY, FRAGMENT, 8, true); // under the cells (10)
  const rings: { x: number; y: number; size: number; strength: number; born: number }[] = [];
  return {
    objects: [sprites.mesh],
    /** A ripple at (x, y) around a body of `radius`; strength 0..1 sets its reach and contrast. */
    add(x: number, y: number, radius: number, strength: number, time: number) {
      const s = Math.max(0, Math.min(1, strength));
      if (rings.length >= CAPACITY) rings.shift();
      rings.push({ x, y, size: 2 * radius * (2 + 2 * s), strength: s, born: time });
    },
    update(time: number, focus: number) {
      while (rings.length && time - rings[0]!.born > LIFE) rings.shift();
      for (const [i, g] of rings.entries()) {
        sprites.offsets[i * 3] = g.x;
        sprites.offsets[i * 3 + 1] = g.y;
        sprites.offsets[i * 3 + 2] = 0;
        sprites.sizes[i] = g.size;
        sprites.seeds[i] = Math.round(g.strength * 9) + Math.min(0.999, (time - g.born) / LIFE);
      }
      sprites.commit(rings.length);
      sprites.setFrame(time, focus);
    },
  };
}
