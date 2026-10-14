import { matchMaker } from '@colyseus/core';
import { Callbacks, Client, Predict, type Room } from '@colyseus/sdk';
import {
  HEALTH_MAX, Input, type Player, MAX_PLAYERS, MIN_MASS, NUTRIENT_COUNT, PoolState, ROOM_NAME, SPAWN_MASS, WORLD_RADIUS, clampSteer,
  move,
} from '@panspermia/shared';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { createServer } from './app.ts';
import type { PoolRoom } from './rooms/PoolRoom.ts';

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
  for (const p of a.state.players.values()) {
    expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(WORLD_RADIUS);
    expect(p.mass).toBe(SPAWN_MASS);
  }
  expect(a.state.nutrients.size).toBe(NUTRIENT_COUNT);

  await b.leave();
  await vi.waitFor(() => expect(a.state.players.size).toBe(1));
  expect(a.state.players.has(a.sessionId)).toBe(true);
  await a.leave();
});

test('server moves the cell along the input heading, even for unclamped input', async () => {
  const room = await join();
  await vi.waitFor(() => expect(room.state.players.has(room.sessionId)).toBe(true));
  const me = room.state.players.get(room.sessionId)!;
  const start = { x: me.x, y: me.y };

  // Raw |dir| ≫ 1 toward the pool centre (boundary clamp can't interfere), as a naive client would send.
  const input = room.input({ type: Input, mode: 'reliable' });
  input.data.dirX = -start.x;
  input.data.dirY = -start.y;
  for (let i = 0; i < 10; i++) input.send();

  await vi.waitFor(() => expect(Math.hypot(me.x - start.x, me.y - start.y)).toBeGreaterThan(10));
  // Displacement stays parallel to the requested heading (cross product ~0).
  const cross = (me.x - start.x) * -start.y - (me.y - start.y) * -start.x;
  expect(Math.abs(cross) / (Math.hypot(me.x - start.x, me.y - start.y) * Math.hypot(start.x, start.y))).toBeLessThan(1e-3);
  await room.leave();
});

test('client prediction runs ahead, then settles exactly on server truth', async () => {
  const room = await join();
  await vi.waitFor(() => expect(room.state.players.has(room.sessionId)).toBe(true));
  const player = room.state.players.get(room.sessionId)!;
  const input = room.input({ type: Input, mode: 'reliable' });
  const predict = Predict.get(room, { mode: 'lerp', delay: 100 });
  const me = predict.reconciler(player, {
    input,
    fields: ['x', 'y'],
    step: (ctx, s, cmd) => move(s, player.mass, cmd.dirX, cmd.dirY, ctx.dt),
    warnOnDivergence: 1, // also switches on the drift telemetry asserted below
  });

  // Drive it like the browser loop: ~60 fps for 1 s, steering toward the centre.
  const start = { x: player.x, y: player.y };
  let lead = 0;
  for (let frame = 0; frame < 60; frame++) {
    for (let due = predict.tick(performance.now()); due > 0; due--) {
      input.data.dirX = -start.x; // |dir| ≫ 1, like a far-off pointer
      input.data.dirY = -start.y;
      clampSteer(input.data);
      input.send();
    }
    lead = Math.max(lead, Math.hypot(me.state.x - player.x, me.state.y - player.y));
    await new Promise((r) => setTimeout(r, 16));
  }
  expect(input.sentCount).toBeGreaterThan(10);
  expect(lead).toBeGreaterThan(1); // prediction actually ran ahead of the server
  expect(me.reconcileSeq).toBeGreaterThan(5);
  // Shared deterministic step: reconciles find ~nothing to correct. Residual is sub-pixel
  // (replay reads the latest mass; metabolism moves it ~0.002/tick).
  expect(me.drift.ema).toBeLessThan(0.05);

  // Stop steering; once the server acks every input, prediction == authority.
  for (let i = 0; i < 40 && input.lastProcessed < input.sentCount; i++) {
    predict.tick(performance.now());
    await new Promise((r) => setTimeout(r, 25));
  }
  predict.tick(performance.now());
  expect(input.lastProcessed).toBe(input.sentCount);
  expect(me.state.x).toBeCloseTo(player.x, 3);
  expect(me.state.y).toBeCloseTo(player.y, 3);
  await room.leave();
});

test('a starved player is told why and respawns as a fresh instance', async () => {
  const room = await join();
  await vi.waitFor(() => expect(room.state.players.has(room.sessionId)).toBe(true));
  const before = room.state.players.get(room.sessionId)!;
  const died = new Promise((resolve) => room.onMessage('died', resolve));
  const readded = new Promise((resolve) => Callbacks.get<PoolState>(room).onAdd('players', (p, id) => {
    if (id === room.sessionId && p !== before) resolve(p);
  }, false));

  const serverPlayer = (matchMaker.getLocalRoomById(room.roomId) as PoolRoom).state.players.get(room.sessionId)!;
  serverPlayer.mass = MIN_MASS;
  serverPlayer.health = 0.01;

  expect(await died).toEqual({ cause: 'starvation' });
  const reborn = (await readded) as Player;
  expect(reborn.mass).toBe(SPAWN_MASS);
  expect(reborn.health).toBe(HEALTH_MAX);
  await room.leave();
});

test('room caps at MAX_PLAYERS, overflow opens a second room', async () => {
  const rooms = await Promise.all(Array.from({ length: MAX_PLAYERS + 1 }, join));
  expect(new Set(rooms.map((r) => r.roomId)).size).toBe(2);
  await Promise.all(rooms.map((r) => r.leave()));
});
