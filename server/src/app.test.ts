import { Client, type Room } from '@colyseus/sdk';
import { MAX_PLAYERS, PoolState, ROOM_NAME, WORLD_RADIUS } from '@panspermia/shared';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { createServer } from './app.ts';

const PORT = 2599;
const server = createServer();
const sdk = new Client(`http://localhost:${PORT}`);
const join = (): Promise<Room<any, PoolState>> => sdk.joinOrCreate(ROOM_NAME, {}, PoolState);

beforeAll(() => server.listen(PORT));
afterAll(() => server.gracefullyShutdown(false));

test('clients share one pool room and see each other spawn and leave', async () => {
  const a = await join();
  const b = await join();
  expect(b.roomId).toBe(a.roomId);

  await vi.waitFor(() => expect(a.state.players.size).toBe(2));
  for (const p of a.state.players.values()) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(WORLD_RADIUS);

  await b.leave();
  await vi.waitFor(() => expect(a.state.players.size).toBe(1));
  expect(a.state.players.has(a.sessionId)).toBe(true);
  await a.leave();
});

test('room caps at MAX_PLAYERS, overflow opens a second room', async () => {
  const rooms = await Promise.all(Array.from({ length: MAX_PLAYERS + 1 }, join));
  expect(new Set(rooms.map((r) => r.roomId)).size).toBe(2);
  await Promise.all(rooms.map((r) => r.leave()));
});
