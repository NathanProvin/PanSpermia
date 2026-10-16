import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { off } from '../perf.ts';

/** Resolution of the far layers and of the bloom, × the screen's: both are blurry anyway. */
const FAR_SCALE = 0.5;
const BLOOM_SCALE = 0.5;

/**
 * HDR scene -> bloom -> ACES tone map + sRGB. Depth of field is baked per layer (see sprites.ts).
 * The far layers (`far`: pond floor, water haze, distant giants) are far out of focus, so they render at
 * reduced resolution into their own target, which the main scene draws as its background.
 * No MSAA: every shape antialiases itself in its shader, and 4× MSAA on the half-float target cost more
 * GPU time than everything else together (perf readout, 2026-10-16).
 */
export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, target);
  // A subtle bloom: only true highlights (threshold near white) get a soft halo.
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.25, 0.35, 0.95);
  const view = new RenderPass(scene, camera);
  composer.addPass(view);
  if (!off.has('bloom')) composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const far = new THREE.Scene();
  const farTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  scene.background = farTarget.texture;
  return {
    /** Add the far, defocused layers here, not to the main scene. */
    far,
    /** Dev: `bloom.enabled = false` from the console. */
    bloom,
    setSize(width: number, height: number, pixelRatio: number) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);
      bloom.setSize(Math.round(width * pixelRatio * BLOOM_SCALE), Math.round(height * pixelRatio * BLOOM_SCALE));
      farTarget.setSize(Math.round(width * pixelRatio * FAR_SCALE), Math.round(height * pixelRatio * FAR_SCALE));
    },
    /** Render this scene through the same pipeline (the editor swaps its own in and back). */
    render(sceneNow: THREE.Scene = scene, cameraNow: THREE.Camera = camera) {
      if (sceneNow === scene) {
        renderer.setRenderTarget(farTarget);
        renderer.render(far, cameraNow);
      }
      view.scene = sceneNow;
      view.camera = cameraNow;
      composer.render();
    },
  };
}
