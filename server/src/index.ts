import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVER_PORT } from '@panspermia/shared';
import { createServer } from './app.ts';

const port = Number(process.env.PORT ?? SERVER_PORT);
const dev = process.argv.includes('--dev');
// Production serves the built client too (`npm run build` first); dev uses Vite's server instead.
const built = fileURLToPath(new URL('../../client/dist', import.meta.url));
const client = !dev && existsSync(built) ? built : undefined;
// The Hall of Fame persists only without dev cheats.
const hall = dev ? ':memory:' : process.env.HALL_DB ?? fileURLToPath(new URL('../data/hall.db', import.meta.url));
if (!dev) mkdirSync(dirname(hall), { recursive: true });
// MAX_ROOMS: each room is a whole sim with its bots — the cap keeps a small VPS inside its tick budget (unset: no cap).
const rooms = Number(process.env.MAX_ROOMS) || undefined;
await createServer({ dev, client, hall, rooms }).listen(port, process.env.HOST); // HOST: 127.0.0.1 behind a proxy
console.log(`Panspermia server listening on :${port}${dev ? ' (dev cheats enabled)' : ''}`
  + (client ? ` — open http://localhost:${port}` : ''));
