import { Client } from '@colyseus/sdk';
import { PoolState, ROOM_NAME } from '@panspermia/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createServer } from './app.ts';
import { POND_FULL } from './rooms/PoolRoom.ts';

// Its own file, so its own process and matchmaker: the room cap (MAX_ROOMS) beside app.test.ts's uncapped server.
const PORT = 2598;
const server = createServer({ bots: 0, rooms: 0 });
beforeAll(() => server.listen(PORT));
afterAll(() => server.gracefullyShutdown(false));

test('past the room cap a join is refused with POND_FULL, the client shows the full pond', async () => {
  const join = new Client(`http://localhost:${PORT}`).joinOrCreate(ROOM_NAME, {}, PoolState);
  await expect(join).rejects.toThrow(POND_FULL);
});
