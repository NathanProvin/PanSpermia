import type { CardData } from './card.ts';

// The session's history for the end screen's evolution tree (user direction): every species played this session, each
// a run of generations — its design, the lives it lost, the parts it found, the phases it climbed. Pure: no DOM.

export interface Unlock { gene: string; icon?: string }
/** One generation (or, once collapsed, a stretch of generations with the same design). */
export interface Gen { design: CardData; gens: number; deaths: number; unlocks: Unlock[] }
export interface Run { name: string; hue: number; fate: CardData['fate']; nodes: Gen[] }

export function createHistory() {
  const runs: Run[] = [];
  const node = () => runs.at(-1)?.nodes.at(-1);
  return {
    runs,
    /** A new species was founded. */
    begin(d: CardData) {
      runs.push({ name: d.name, hue: d.hue, fate: 'living', nodes: [{ design: d, gens: 1, deaths: 0, unlocks: [] }] });
    },
    /** The species' design as it stands: a new generation (or phase) starts a node, otherwise the node follows its edits. */
    track(d: CardData) {
      const run = runs.at(-1);
      const n = node();
      if (!run || !n) return;
      Object.assign(run, { name: d.name, hue: d.hue }); // renamed or repainted in the editor
      if (d.generation !== n.design.generation || d.tier !== n.design.tier) run.nodes.push({ design: d, gens: 1, deaths: 0, unlocks: [] });
      else n.design = d;
    },
    death() { if (node()) node()!.deaths++; },
    unlock(u: Unlock) { node()?.unlocks.push(u); },
    end(fate: CardData['fate']) { if (runs.at(-1)) runs.at(-1)!.fate = fate; },
  };
}
export type History = ReturnType<typeof createHistory>;

/** What the tree draws as one design: its phase, parts and body plan (not its sculpting or colour). */
const designKey = (d: CardData) => `${d.tier}|${d.parts.map((p) => p.gene).sort().join()}|${d.plan}|${d.radii.length}|${d.arms ?? 0}`;

/** Consecutive generations of one design merge into one node (×n); its deaths and finds add up. */
export function collapse(nodes: readonly Gen[]): Gen[] {
  const out: Gen[] = [];
  for (const n of nodes) {
    const last = out.at(-1);
    if (last && designKey(last.design) === designKey(n.design)) {
      out[out.length - 1] = { design: n.design, gens: last.gens + n.gens, deaths: last.deaths + n.deaths, unlocks: [...last.unlocks, ...n.unlocks] };
    } else out.push({ ...n, unlocks: [...n.unlocks] });
  }
  return out;
}

/** At most `max` nodes: the first of each phase and the last always stay; the others are kept evenly, the rest merged in. */
export function cap(nodes: readonly Gen[], max: number): Gen[] {
  if (nodes.length <= max) return [...nodes];
  const must = new Set(nodes.flatMap((n, i) => (i === 0 || i === nodes.length - 1 || n.design.tier !== nodes[i - 1]!.design.tier ? [i] : [])));
  const free = nodes.map((_, i) => i).filter((i) => !must.has(i));
  const room = Math.max(0, max - must.size);
  for (let k = 0; k < room; k++) must.add(free[Math.floor(((k + 0.5) * free.length) / room)]!);
  const out: Gen[] = [];
  for (const [i, n] of nodes.entries()) { // a dropped node's generations, deaths and finds go to the kept one before it
    const last = out.at(-1);
    if (must.has(i) || !last) out.push({ ...n, unlocks: [...n.unlocks] });
    else out[out.length - 1] = { ...last, gens: last.gens + n.gens, deaths: last.deaths + n.deaths, unlocks: [...last.unlocks, ...n.unlocks] };
  }
  return out;
}

export interface Placed { x: number; y: number; gen: Gen; jump: boolean }
export interface Branch { run: Run; trunk: boolean; nodes: Placed[] }
export interface Tree {
  w: number; h: number;
  /** One column per phase, left to right. */
  columns: { tier: number; x0: number; x1: number }[];
  root: { x: number; y: number };
  branches: Branch[];
  /** The landing (a win): where the trunk ends. */
  land?: { x: number; y: number };
}

const TRUNK_MAX = 24;
const DEAD_MAX = 4; // nodes on an earlier species' branch
const DEAD_RUNS = 4; // earlier species shown (the latest)
const W = 1000;
const LANE = 92;

/**
 * The tree: the last run is the trunk, root on the left, through the four phase columns, to land on a win; earlier runs
 * fork off the root into lanes above and below, each ending where it died out.
 */
export function layout(runs: readonly Run[], tiers = 4): Tree {
  const trunkRun = runs.at(-1);
  const dead = runs.slice(0, -1).slice(-DEAD_RUNS);
  const lanes = [0, ...dead.map((_, i) => (i % 2 ? 1 : -1) * Math.ceil((i + 1) / 2))];
  const top = Math.min(...lanes);
  const h = (Math.max(...lanes) - top + 1) * LANE + 40;
  const laneY = (lane: number) => 20 + (lane - top + 0.5) * LANE;
  const rows = [trunkRun, ...dead].map((run, i) => (run ? cap(collapse(run.nodes), i ? DEAD_MAX : TRUNK_MAX) : []));
  // Each phase's width follows the most nodes any branch has in it (at least one slot).
  const slots = Array.from({ length: tiers }, (_, t) => Math.max(1, ...rows.map((nodes) => nodes.filter((n) => n.design.tier === t + 1).length)));
  const [x0, x1] = [90, trunkRun?.fate === 'evolved' ? 890 : 960];
  const per = (x1 - x0) / slots.reduce((a, b) => a + b, 0);
  const columns = slots.map((n, t) => ({ tier: t + 1, x0: x0 + per * slots.slice(0, t).reduce((a, b) => a + b, 0), x1: 0 }));
  for (const [t, c] of columns.entries()) c.x1 = c.x0 + per * slots[t]!;
  const root = { x: 36, y: laneY(0) };
  const branches = [trunkRun, ...dead].flatMap((run, i): Branch[] => {
    if (!run) return [];
    const nodes = rows[i]!;
    const y = laneY(lanes[i]!);
    const placed = nodes.map((gen, k): Placed => {
      const c = columns[gen.design.tier - 1]!;
      const inPhase = nodes.filter((n) => n.design.tier === gen.design.tier);
      const j = inPhase.indexOf(gen);
      const x = c.x0 + ((j + 0.5) * (c.x1 - c.x0)) / inPhase.length;
      return { x, y: y + Math.sin(x / 70 + i) * 7, gen, jump: k > 0 && gen.design.tier !== nodes[k - 1]!.design.tier };
    });
    return [{ run, trunk: i === 0, nodes: placed }];
  });
  return { w: W, h, columns, root, branches, ...(trunkRun?.fate === 'evolved' ? { land: { x: 950, y: laneY(0) } } : {}) };
}
