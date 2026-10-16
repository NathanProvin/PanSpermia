import { expect, test } from 'vitest';
import { chain, stepSpine, stepWhip } from './rig.ts';

const links = (c: ReturnType<typeof chain>) => Array.from({ length: c.x.length - 1 }, (_, i) => Math.hypot(c.x[i + 1]! - c.x[i]!, c.y[i + 1]! - c.y[i]!));
const tipAngle = (c: ReturnType<typeof chain>) => Math.atan2(c.y.at(-1)!, c.x.at(-1)!);

test('a whip trails a turning root, keeps its length, then straightens out', () => {
  const w = chain(12);
  stepWhip(w, 0, 0, 0, 1, 0); // laid out straight along +x
  expect(tipAngle(w)).toBeCloseTo(0);
  // The root swings a quarter turn in one frame: the tip lags behind instead of sweeping round rigidly.
  stepWhip(w, 0, 0, Math.PI / 2, 1, 1 / 60);
  expect(tipAngle(w)).toBeLessThan(Math.PI / 4);
  for (const l of links(w)) expect(l).toBeCloseTo(1, 6);
  for (let i = 0; i < 180; i++) stepWhip(w, 0, 0, Math.PI / 2, 1, 1 / 60); // 3 s later it points where the root does
  expect(tipAngle(w)).toBeCloseTo(Math.PI / 2, 1);
  stepWhip(w, 0, 0, 1, 1, 0.1); // a long frame stays finite
  expect(w.x.every(Number.isFinite) && w.y.every(Number.isFinite)).toBe(true);
});

test('a spine follows its head as one body: links exact, bends and curl limited, never folding', () => {
  const s = chain(5);
  const restAt = (heading: number) => [0, -1, -2, -3, -4].map((d) => ({ x: 5 + Math.cos(heading) * d, y: Math.sin(heading) * d }));
  const check = (heading: number) => {
    expect(links(s).every((l) => Math.abs(l - 1) < 1e-9)).toBe(true); // segments never come apart
    let curl = 0;
    let prev = heading + Math.PI; // the first link's rigid direction: straight back from the head
    for (let i = 0; i < 4; i++) {
      const a = Math.atan2(s.y[i + 1]! - s.y[i]!, s.x[i + 1]! - s.x[i]!);
      const bend = Math.abs(Math.atan2(Math.sin(a - prev), Math.cos(a - prev)));
      expect(bend).toBeLessThanOrEqual(0.45 + 1e-9);
      curl += bend;
      prev = a;
    }
    expect(curl).toBeLessThanOrEqual(1.2 + 1e-9);
  };
  stepSpine(s, restAt(0), false, 0);
  for (let i = 0; i < 30; i++) { // a hard turn of the head, standing still
    stepSpine(s, restAt((i / 30) * 3), false, 1 / 60);
    check((i / 30) * 3);
  }
  // The tail has not swung round with the head: the body is curved, not a rigid stick.
  const rigid = restAt(3).at(-1)!;
  expect(Math.hypot(s.x[4]! - rigid.x, s.y[4]! - rigid.y)).toBeGreaterThan(0.5);
  // Swimming straight at full speed: it undulates, still in one piece, and stays near the straight line.
  for (let i = 0; i < 300; i++) {
    stepSpine(s, restAt(0), false, 1 / 60, 200, 1);
    check(0);
  }
  expect(Math.abs(s.y[4]!)).toBeLessThan(1.2);
});
