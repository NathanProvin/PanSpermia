import { SERVER_PORT } from '@panspermia/shared';
import { createServer } from './app.ts';

const port = Number(process.env.PORT ?? SERVER_PORT);
const dev = process.argv.includes('--dev');
await createServer({ dev }).listen(port);
console.log(`Panspermia server listening on :${port}${dev ? ' (dev cheats enabled)' : ''}`);
