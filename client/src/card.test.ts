import { MAX_SEGMENTS } from '@panspermia/shared';
import { expect, test } from 'vitest';
import { type CardData, decodeCard, encodeCard } from './card.ts';

const card: CardData = {
  name: 'Vibrio stellaris', hue: 0.42, tier: 1, shape: 2, plan: 0, radii: [0.45, 0.75, 0.5], generation: 7, dna: 312, kills: 3, fate: 'evolved',
  parts: [{ gene: 'flagellum', x: -1, y: 0, angle: 3.14, scale: 1, group: 0 }, { gene: 'pili', x: 0.5, y: 0.87, angle: 1.05, scale: 1.5, group: 0 }],
};
const tamper = (data: unknown[]) => btoa(JSON.stringify(data)).replaceAll('+', '-').replaceAll('/', '_');

test('a card survives the link round trip (UTF-8 names included)', () => {
  expect(decodeCard(encodeCard(card))).toEqual(card);
  const eu: CardData = { ...card, tier: 2, parts: [{ gene: 'jaw', x: 1, y: 0, angle: 0, scale: 1, group: 0 }] };
  expect(decodeCard(encodeCard(eu))).toEqual(eu);
  const animal: CardData = { ...card, tier: 3, plan: 1, radii: [0.6, 0.4, 0.4, 0.4], parts: [{ gene: 'paddle', x: 0, y: 1, angle: 1.57, scale: 1, group: 0 }] };
  expect(decodeCard(encodeCard(animal))).toEqual(animal);
  const sculpted: CardData = { ...card, form: { sx: 1.3, sy: 0.7, bend: -0.2 } };
  expect(decodeCard(encodeCard(sculpted))).toEqual(sculpted);
  const curled: CardData = { ...card, tier: 3, parts: [], bends: [0, 0.6, -0.3] };
  expect(decodeCard(encodeCard(curled))).toEqual(curled);
  const star: CardData = { ...card, tier: 3, parts: [], plan: 1, radii: [0.6, 0.4, 0.3], bends: [0, 0.5], arms: 5 };
  expect(decodeCard(encodeCard(star))).toEqual(star);
  expect(decodeCard(encodeCard({ ...star, arms: 9 }))).toBeUndefined();
  const accented = { ...card, name: 'Ébauche lucida' };
  expect(decodeCard(encodeCard(accented))!.name).toBe('Ébauche lucida');
});

test('tampered or junk links are refused, never rendered', () => {
  const ok = [card.name, 0.4, 7, 312, 3, 0, [[1, -1, 0, 3.14, 1]]];
  expect(decodeCard(tamper(ok))).toBeDefined();
  for (const bad of [
    ['<img src=x onerror=alert(1)>', ...ok.slice(1)], // name gate
    [card.name, 2, ...ok.slice(2)], // hue out of range
    [card.name, 0.4, -1, ...ok.slice(3)], // negative generation
    [...ok.slice(0, 5), 9, ok[6]], // unknown fate
    [...ok.slice(0, 6), [[99, 0, 0, 0, 1]]], // unknown gene
    [...ok.slice(0, 6), [[1, 5, 0, 0, 1]]], // part far outside the body
    [...ok.slice(0, 6), Array(25).fill([1, 0, 0, 0, 1])], // too many parts
    [...ok, 3, 0, 9, [0.5, 0.5]], // unknown body plan
    [...ok, 3, 0, 0, [0.5, 5]], // segment out of range
    [...ok, 3, 0, 0, Array(MAX_SEGMENTS + 1).fill(0.5)], // too many segments
    [...ok, 1, 0, 0, [0.5, 0.5], [9, 0.7, 0]], // sculpted far beyond the limits
  ]) expect(decodeCard(tamper(bad))).toBeUndefined();
  expect(decodeCard('not base64 at all!!')).toBeUndefined();
});
