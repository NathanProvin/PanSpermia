import { expect, test } from 'vitest';
import type { CardData } from './card.ts';
import { collapse, createHistory, layout } from './history.ts';

const design = (tier: number, generation: number, genes: string[]): CardData => ({
  name: 'Testus', hue: 0.3, tier, shape: 0, parts: genes.map((gene) => ({ gene, x: 1, y: 0, angle: 0, scale: 1, group: 0 })),
  plan: 0, radii: [1, 1, 1], generation, dna: 0, kills: 0, fate: 'living',
});

test('the tree collapses repeated designs, keeps phases in order, caps its nodes, forks earlier species off the root', () => {
  const h = createHistory();
  h.begin(design(1, 1, []));
  h.death();
  h.end('extinct'); // an earlier species died out
  h.begin(design(1, 1, ['pili']));
  h.track(design(1, 2, ['pili'])); // same design: one node ×2
  h.death();
  h.unlock({ gene: 'flagellum' });
  h.track(design(1, 3, ['pili', 'flagellum']));
  for (let g = 4; g < 60; g++) h.track(design(g < 20 ? 2 : g < 40 ? 3 : 4, g, [`p${g}`])); // every generation a new design
  h.end('evolved');

  const tree = layout(h.runs);
  const [trunk, dead] = tree.branches;
  expect(trunk!.trunk && !dead!.trunk).toBe(true);
  expect(collapse(h.runs[1]!.nodes)[0]).toMatchObject({ gens: 2, deaths: 1, unlocks: [{ gene: 'flagellum' }] });
  expect(trunk!.nodes.length).toBeLessThanOrEqual(24);
  const tiers = trunk!.nodes.map((n) => n.gen.design.tier);
  expect(tiers).toEqual([...tiers].sort()); // phases left to right
  expect(trunk!.nodes.filter((n) => n.jump).length).toBe(3); // each phase jump survives the cap
  const xs = trunk!.nodes.map((n) => n.x);
  expect(xs).toEqual([...xs].sort((a, b) => a - b));
  expect(tree.land!.x).toBeGreaterThan(xs.at(-1)!);
  expect(dead!.nodes[0]!.y).not.toBe(trunk!.nodes[0]!.y); // its own lane
  expect(trunk!.nodes.reduce((s, n) => s + n.gen.gens, 0)).toBe(59); // capping merges, never loses generations
});
