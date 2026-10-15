import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/** HDR scene -> bloom -> ACES tone map + sRGB. Depth of field is baked per layer (see sprites.ts). */
export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.5, 0.7);
  const view = new RenderPass(scene, camera);
  composer.addPass(view);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  return {
    setSize(width: number, height: number, pixelRatio: number) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);
    },
    /** Render this scene through the same pipeline (the editor swaps its own in and back). */
    render(sceneNow: THREE.Scene = scene, cameraNow: THREE.Camera = camera) {
      view.scene = sceneNow;
      view.camera = cameraNow;
      composer.render();
    },
  };
}
