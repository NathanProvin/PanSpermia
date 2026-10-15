import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SERVER_PORT } from '@panspermia/shared';
import { createServer } from './app.ts';

const port = Number(process.env.PORT ?? SERVER_PORT);
const dev = process.argv.includes('--dev');
// Production serves the built client too (`npm run build` first); dev uses Vite's server instead.
const built = fileURLToPath(new URL('../../client/dist', import.meta.url));
const client = !dev && existsSync(built) ? built : undefined;
await createServer({ dev, client }).listen(port);
console.log(`Panspermia server listening on :${port}${dev ? ' (dev cheats enabled)' : ''}`
  + (client ? ` — open http://localhost:${port}` : ''));
