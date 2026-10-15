// Headless balancing sim: a pool of bots run at full speed with the real world rules, no network.
//   npm run balance -w server -- [minutes=20] [bots=30]
// Targets (ROADMAP "Numbers"): ~4 min from spawn to the tier-1 cap; kills and phages should matter
// without wiping the pool; no species should dominate or starve out.
import { BOT_SPECIES, MASS_CAP, PoolState, TICK_RATE } from '@panspermia/shared';
import { type Bots, fillBots, rebirth, stepBots } from './bots.ts';
import { PHAGE_KILLER, initPool, stepWorld } from './world.ts';

const minutes = Number(process.argv[2] ?? 20);
const count = Number(process.argv[3] ?? 30);

const state = new PoolState();
initPool(state);
const bots: Bots = new Map();
fillBots(state, bots, count);

const rows = BOT_SPECIES.map((s) => ({
  species: s.name, archetype: s.archetype, lives: 0, kills: 0, lysed: 0, phage: 0, starved: 0,
  capped: 0, capMin: 0, lifeMin: 0, massNow: 0, topKiller: '',
}));
const killedBy = BOT_SPECIES.map(() => BOT_SPECIES.map(() => 0)); // [victim][killer]
const speciesOf = (id: string) => bots.get(id)!.species;
for (const b of bots.values()) rows[b.species]!.lives++;
const cappedAt = new Map<string, number>(); // id → tick its current life hit the cap
const lifeMin = new Map<number, number[]>(); // species → lifetimes, minutes
let infections = 0;

const started = performance.now();
const ticks = minutes * 60 * TICK_RATE;
for (let t = 0; t < ticks; t++) {
  const infectedBefore = new Map([...state.players].map(([id, p]) => [id, p.infection]));
  stepBots(state, bots);
  const deaths = stepWorld(state);
  for (const [id, p] of state.players) if (p.infection > (infectedBefore.get(id) ?? 0)) infections++;

  for (const { id, by } of deaths) {
    const s = speciesOf(id);
    const row = rows[s]!;
    if (by === PHAGE_KILLER) row.phage++;
    else if (by) {
      row.lysed++;
      if (bots.has(by)) {
        rows[speciesOf(by)]!.kills++;
        killedBy[s]![speciesOf(by)]!++;
      }
    } else row.starved++;
    const life = (state.tick - bots.get(id)!.born) / TICK_RATE / 60;
    lifeMin.set(s, [...(lifeMin.get(s) ?? []), life]);
    cappedAt.delete(id);
    row.lives++;
  }
  rebirth(state, bots, deaths);

  for (const [id, b] of bots) {
    const p = state.players.get(id)!;
    if (p.mass >= MASS_CAP - 1 && !cappedAt.has(id)) { // metabolism shaves the clamp within the same tick
      cappedAt.set(id, state.tick);
      const row = rows[b.species]!;
      row.capMin += ((state.tick - b.born) / TICK_RATE / 60 - row.capMin) / ++row.capped; // running mean
    }
  }
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
for (const [s, row] of rows.entries()) {
  // Lives still running count toward lifetime as censored (survived at least this long).
  const running = [...bots].filter(([, b]) => b.species === s).map(([id, b]) => {
    row.massNow += state.players.get(id)!.mass;
    return (state.tick - b.born) / TICK_RATE / 60;
  });
  row.lifeMin = mean([...(lifeMin.get(s) ?? []), ...running]);
  row.massNow /= running.length || 1;
  const k = killedBy[s]!;
  const top = k.indexOf(Math.max(...k));
  if (k[top]) row.topKiller = `${BOT_SPECIES[top]!.name} (${Math.round((100 * k[top]) / row.lysed)}%)`;
}
const round = (x: number) => Math.round(x * 10) / 10;
console.table(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? round(v) : v]))));

const wall = (performance.now() - started) / 1000;
const kills = rows.reduce((a, r) => a + r.kills, 0);
const deaths = rows.reduce((a, r) => a + r.lysed + r.phage + r.starved, 0);
const kinds = [...state.nutrients.values()].reduce((a, n) => ((a[n.kind] = (a[n.kind] ?? 0) + 1), a), [] as number[]);
console.log([
  `${minutes} min, ${count} bots, ${round((minutes * 60) / wall)}× real time`,
  `deaths ${deaths} (${round(deaths / minutes)}/min), bot kills ${round(kills / minutes)}/min, infections ${round(infections / minutes)}/min`,
  `packets now: dissolved ${kinds[0] ?? 0}, debris ${kinds[1] ?? 0}, fragments ${kinds[2] ?? 0}, plasmids ${kinds[3] ?? 0}, phages ${kinds[4] ?? 0}`,
].join('\n'));
