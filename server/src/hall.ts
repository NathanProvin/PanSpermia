import { DatabaseSync } from 'node:sqlite';
import { randomSpeciesName } from '@panspermia/shared';

/** A species that walked onto land (P12 Hall of Fame). */
export interface Win {
  name: string;
  /** Sim time from founding the species to landing. */
  seconds: number;
  generations: number;
  kills: number;
}

export interface HallEntry extends Win { rank: number }
/** Today's list (since the UTC day began) and the all-time one; ranks of the win just entered (0: none). */
export interface HallLists { today: HallEntry[]; allTime: HallEntry[]; rankToday: number; rankAll: number }

const DAY = 86_400_000;

/** The global Hall of Fame: fastest to land first, then fewest generations. `:memory:` for dev and tests. */
export function openHall(path: string) {
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE IF NOT EXISTS wins (name TEXT NOT NULL, seconds REAL NOT NULL, generations INTEGER NOT NULL, kills INTEGER NOT NULL, at INTEGER NOT NULL)');
  const insert = db.prepare('INSERT INTO wins VALUES (?, ?, ?, ?, ?)');
  const top = db.prepare('SELECT name, seconds, generations, kills FROM wins WHERE at >= ? ORDER BY seconds, generations, at LIMIT ?');
  const ahead = db.prepare('SELECT COUNT(*) AS n FROM wins WHERE at >= ? AND (seconds < ? OR (seconds = ? AND generations <= ?))'); // ties: the earlier win first
  const list = (since: number, n: number) => (top.all(since, n) as unknown as Win[]).map((w, i) => ({ ...w, rank: i + 1 }));
  const rank = (since: number, w: Win) => (ahead.get(since, w.seconds, w.seconds, w.generations) as { n: number }).n + 1;
  return {
    /** Both lists, top `n` each. */
    lists(n = 10, now = Date.now()): HallLists {
      const day = now - (now % DAY);
      return { today: list(day, n), allTime: list(0, n), rankToday: 0, rankAll: 0 };
    },
    /** Enters a win (at `now`); returns both lists and its ranks. */
    record(win: Win, n = 10, now = Date.now()): HallLists {
      const day = now - (now % DAY);
      const [rankToday, rankAll] = [rank(day, win), rank(0, win)];
      insert.run(win.name, win.seconds, win.generations, win.kills, now);
      return { ...this.lists(n, now), rankToday, rankAll };
    },
  };
}
export type Hall = ReturnType<typeof openHall>;

/** Dev only: a dozen made-up wins, half of them today, for the end screen's lists. */
export function seedHall(hall: Hall, now = Date.now()) {
  for (let i = 0; i < 12; i++) {
    const win = { name: randomSpeciesName(), seconds: 900 + Math.random() * 1500, generations: 6 + Math.floor(Math.random() * 14), kills: Math.floor(Math.random() * 40) };
    hall.record(win, 0, i % 2 ? now : now - (1 + i) * 86_400_000);
  }
}
