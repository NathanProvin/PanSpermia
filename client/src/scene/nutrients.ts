import { NUTRIENT_COUNT, type Nutrient } from '@panspermia/shared';
import { createSprites } from './sprites.ts';

// Dissolved nutrient motes: in the focal plane, bright cores that bloom, gentle pulse.
const FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r2 = dot(p, p);
  float pulse = 0.8 + 0.2 * sin(uTime * 2.2 + vSeed * 30.0);
  float core = exp(-r2 * 28.0) * 2.4;
  float halo = exp(-r2 * 5.0) * 0.35 * (1.0 - smoothstep(0.7, 1.0, sqrt(r2)));
  gl_FragColor = vec4(vec3(0.78, 1.0, 0.42) * (core + halo) * pulse, 1.0);
}
`;
const SIZE = 16;

export function createNutrients() {
  const sprites = createSprites(NUTRIENT_COUNT, FRAGMENT, 5);
  return {
    objects: [sprites.mesh],
    update(nutrients: Iterable<[string, Nutrient]>, time: number, focus: number) {
      let i = 0;
      for (const [id, n] of nutrients) {
        if (i >= NUTRIENT_COUNT) break;
        sprites.offsets[i * 3] = n.x;
        sprites.offsets[i * 3 + 1] = n.y;
        sprites.offsets[i * 3 + 2] = 0;
        sprites.sizes[i] = SIZE;
        sprites.seeds[i] = (Number(id) * 0.618034) % 1;
        i++;
      }
      sprites.commit(i);
      sprites.setFrame(time, focus);
    },
  };
}
