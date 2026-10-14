import { SERVER_PORT } from '@panspermia/shared';
import { createServer } from './app.ts';

const port = Number(process.env.PORT ?? SERVER_PORT);
await createServer().listen(port);
console.log(`Panspermia server listening on :${port}`);
