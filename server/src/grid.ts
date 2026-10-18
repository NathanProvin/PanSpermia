// Spatial index of the drifting packets, rebuilt once per tick by stepWorld and shared by feeding and bot
// perception. A counting sort into flat arrays: a Map of per-cell arrays rebuilt every tick for ~14k packets
// cost more than drifting them (P10a profile).
import { type Nutrient, type PoolState, RIM_MAX } from '@panspermia/shared';

const CELL = 160; // 80 before the pool grew to 9750 (+ faults): the per-tick clear and prefix sum scale with SIDE²
const SIDE = Math.ceil((2 * RIM_MAX) / CELL) + 1; // the farthest water (a fault's tip)
const cellOf = (v: number) => Math.min(SIDE - 1, Math.max(0, Math.floor((v + RIM_MAX) / CELL)));

export interface PacketGrid {
  /** Packets of cell c are items[start[c]] .. items[start[c + 1] - 1]. */
  start: Int32Array;
  items: Nutrient[];
  ids: string[];
}

/** Index packets (and their ids, same order) by where they are now. */
export function buildGrid(byIndex: Nutrient[], idByIndex: string[]): PacketGrid {
  // Index loops, no iterators: this runs over every packet every tick.
  const size = byIndex.length;
  const start = new Int32Array(SIDE * SIDE + 1);
  const cells = new Int32Array(size);
  for (let i = 0; i < size; i++) {
    const n = byIndex[i]!;
    const c = cellOf(n.y) * SIDE + cellOf(n.x);
    cells[i] = c;
    start[c + 1]!++;
  }
  for (let c = 0; c < SIDE * SIDE; c++) start[c + 1]! += start[c]!;
  const fill = start.slice(0, SIDE * SIDE);
  const items = new Array<Nutrient>(size);
  const ids = new Array<string>(size);
  for (let j = 0; j < size; j++) {
    const k = fill[cells[j]!]!++;
    items[k] = byIndex[j]!;
    ids[k] = idByIndex[j]!;
  }
  return { start, items, ids };
}

/** Visit every packet in the cells within `reach` of (x, y); callers check the exact distance. */
export function near(g: PacketGrid, x: number, y: number, reach: number, visit: (n: Nutrient, id: string) => void) {
  const x0 = cellOf(x - reach);
  const x1 = cellOf(x + reach);
  for (let gy = cellOf(y - reach), y1 = cellOf(y + reach); gy <= y1; gy++) {
    for (let k = g.start[gy * SIDE + x0]!, end = g.start[gy * SIDE + x1 + 1]!; k < end; k++) visit(g.items[k]!, g.ids[k]!);
  }
}

/** The latest grid of each pool (rooms share the process; bots read the one their room's last tick built). */
export const grids = new WeakMap<PoolState, PacketGrid>();
