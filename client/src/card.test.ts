import { expect, test } from 'vitest';
import { type CardData, decodeCard, encodeCard } from './card.ts';

const card: CardData = {
  name: 'Vibrio stellaris', hue: 0.42, generation: 7, dna: 312, kills: 3, fate: 'evolved',
  parts: [{ gene: 'flagellum', x: -1, y: 0, angle: 3.14, scale: 1, group: 0 }, { gene: 'pili', x: 0.5, y: 0.87, angle: 1.05, scale: 1.5, group: 0 }],
};
const tamper = (data: unknown[]) => btoa(JSON.stringify(data)).replaceAll('+', '-').replaceAll('/', '_');

test('a card survives the link round trip (UTF-8 names included)', () => {
  expect(decodeCard(encodeCard(card))).toEqual(card);
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
  ]) expect(decodeCard(tamper(bad))).toBeUndefined();
  expect(decodeCard('not base64 at all!!')).toBeUndefined();
});
