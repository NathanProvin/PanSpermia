import { DEFAULT_SEGMENTS } from '@panspermia/shared';
import * as THREE from 'three';
import { expect, test } from 'vitest';
import { createCellView } from './cells.ts';

test('a stale part of another tier never leaves an animal body invisible (NaN) — the editor right after evolving', () => {
  const view = createCellView(new THREE.Scene(), 0.4);
  const pose = { x: 0, y: 0, heading: 0, tumble: 0, spore: 0, cyst: 0 };
  const look = { tier: 3, genome: 0, parts: [{ gene: 'jaw', x: 1, y: 0, angle: 0, scale: 1, group: 0 }], hue: 0, segments: DEFAULT_SEGMENTS };
  for (const dt of [0, 1 / 60, 1 / 60]) view.update(pose, 1, look, dt, dt); // a tier-2 jaw on a tier-3 body
  const { x, y } = view.body.scale;
  expect(Number.isFinite(x) && Number.isFinite(y) && x > 0).toBe(true);
  expect(view.body.visible).toBe(true);
});

test('the body shader never takes % of a bare uniform (% 0 is undefined: spine plankton, uArm 0, drew nothing)', () => {
  const view = createCellView(new THREE.Scene(), 0.4);
  expect(view.body.material.fragmentShader).not.toMatch(/%\s*u[A-Z]\w*/);
});
