import { EGG_RADIUS, EGG_TIME, type Egg, TICK_RATE } from '@panspermia/shared';
import { createSprites } from './sprites.ts';

// Animal egg clutches in the focal plane: a few translucent eggs, each with an embryo curled inside that
// grows and stirs as hatching nears. Egg count in the integer part of aSeed, development (0 laid → 1 hatching)
// in the fraction.
const FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
void main() {
  float count = floor(vSeed);
  float grown = fract(vSeed);
  vec2 p = vUv * 2.0 - 1.0;
  vec3 color = vec3(0.0);
  float jelly = 0.0;
  for (int i = 0; i < 6; i++) {
    if (float(i) >= count) break;
    float a = float(i) * 2.4 + 0.3;
    vec2 at = count < 1.5 ? vec2(0.0) : 0.4 * vec2(cos(a), sin(a)) * (0.6 + 0.4 * fract(float(i) * 0.618));
    vec2 q = p - at;
    float r = length(q);
    jelly = max(jelly, 1.0 - smoothstep(0.3, 0.5, r));
    float shell = exp(-pow((r - 0.3) / 0.035, 2.0));
    float yolk = (1.0 - smoothstep(0.22, 0.3, r)) * (0.45 + 0.15 * smoothstep(0.25, 0.0, r));
    // The embryo: a comma that grows and twitches.
    float t = uTime * (1.0 + 4.0 * grown) + float(i) * 1.7;
    vec2 e = q - 0.05 * vec2(sin(t), cos(t * 1.3)) * grown;
    float embryo = (1.0 - smoothstep(0.05 + 0.13 * grown, 0.08 + 0.13 * grown, length(e * vec2(1.0, 1.6))));
    color += vec3(1.0, 0.9, 0.7) * shell * 1.1 + vec3(0.95, 0.62, 0.22) * yolk + vec3(1.0, 0.85, 0.6) * embryo * 1.2;
  }
  color += vec3(0.5, 0.45, 0.3) * jelly * 0.12; // the jelly that binds the clutch
  gl_FragColor = vec4(color, 1.0);
}
`;
const CAPACITY = 64;
const SIZE = EGG_RADIUS * 3.2;

export function createEggs() {
  const sprites = createSprites(CAPACITY, FRAGMENT, 6);
  return {
    objects: [sprites.mesh],
    update(eggs: Iterable<Egg>, tick: number, time: number, focus: number) {
      let i = 0;
      for (const egg of eggs) {
        if (i >= CAPACITY) break;
        sprites.offsets[i * 3] = egg.x;
        sprites.offsets[i * 3 + 1] = egg.y;
        sprites.offsets[i * 3 + 2] = 0;
        sprites.sizes[i] = SIZE;
        const grown = 1 - (egg.hatchTick - tick) / (EGG_TIME * TICK_RATE);
        sprites.seeds[i] = egg.count + Math.min(0.999, Math.max(0, grown));
        i++;
      }
      sprites.commit(i);
      sprites.setFrame(time, focus);
    },
  };
}
