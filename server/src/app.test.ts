import { matchMaker } from '@colyseus/core';
import { Callbacks, Client, Predict, type Room } from '@colyseus/sdk';
import {
  GENES, HEALTH_MAX, IDLE_GRACE_TICKS, Input, MAX_PLAYERS, MIN_MASS, type Player, PoolState, ROOM_NAME, SEEP_COUNT,
  SPAWN_MASS, STARTER_GENOME, TICK_DT, TICK_RATE, WORLD_RADIUS, clampSteer, drift, stepCell,
} from '@panspermia/shared';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { createServer } from './app.ts';
import type { PoolRoom } from './rooms/PoolRoom.ts';

const PORT = 2599;
const server = createServer(); // production config: no dev cheats
const sdk = new Client(`http://localhost:${PORT}`);
const join = (): Promise<Room<any, PoolState>> => sdk.joinOrCreate(ROOM_NAME, {}, PoolState);
const serverRoom = (room: Room) => matchMaker.getLocalRoomById(room.roomId) as PoolRoom;
const joinedPlayer = async (room: Room<any, PoolState>) => {
  await vi.waitFor(() => expect(room.state.players.has(room.sessionId)).toBe(true));
  return room.state.players.get(room.sessionId)!;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(() => server.listen(PORT));
afterAll(() => server.gracefullyShutdown(false));

test('clients share one pool room and see each other spawn and leave', async () => {
  const a = await join();
  const b = await join();
  expect(b.roomId).toBe(a.roomId);

  await vi.waitFor(() => expect(a.state.players.size).toBe(2));
  for (const p of a.state.players.values()) {
    expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(WORLD_RADIUS);
    expect(p.mass).toBeCloseTo(SPAWN_MASS, 1); // a tick of metabolism may already have run
    expect(p.genome).toBe(STARTER_GENOME);
  }
  expect(a.state.seeps.length).toBe(SEEP_COUNT);
  expect(a.state.nutrients.size).toBeGreaterThan(300); // prewarmed plumes

  await b.leave();
  await vi.waitFor(() => expect(a.state.players.size).toBe(1));
  expect(a.state.players.has(a.sessionId)).toBe(true);
  await a.leave();
});

test('server swims the cell along the input heading, even for unclamped input', async () => {
  const room = await join();
  await joinedPlayer(room);
  // Fixed start far from a diagonal, so a heading-bending sanitizer would be off by ~37°.
  const p = serverRoom(room).state.players.get(room.sessionId)!;
  p.x = 300;
  p.y = -40;
  const start = { x: p.x, y: p.y };

  const input = room.input({ type: Input, mode: 'reliable' });
  input.data.dirX = -start.x; // raw |dir| ≫ 1, as a naive client would send
  input.data.dirY = -start.y;
  for (let i = 0; i < 10; i++) input.send();

  await vi.waitFor(() => expect(Math.hypot(p.x - start.x, p.y - start.y)).toBeGreaterThan(20));
  // Pili drift (≤ 30% of a ≤ 70 u/s current) can bend the path by at most ~15° against a 71 u/s swim.
  const moved = Math.atan2(p.y - start.y, p.x - start.x);
  expect(Math.abs(moved - Math.atan2(-start.y, -start.x))).toBeLessThan(0.4);
  await room.leave();
});

test('a silent client still drifts with the current after the grace period', async () => {
  const room = await join();
  await joinedPlayer(room);
  const p = serverRoom(room).state.players.get(room.sessionId)!;
  p.genome = 0; // no grip: full drift
  const start = { x: p.x, y: p.y };
  await sleep(((IDLE_GRACE_TICKS + 8) * 1000) / TICK_RATE);
  expect(Math.hypot(p.x - start.x, p.y - start.y)).toBeGreaterThan(0.5);
  await room.leave();
});

test('client prediction runs ahead, then settles on server truth (tumbles included)', async () => {
  const room = await join();
  const player = await joinedPlayer(room);
  serverRoom(room).state.players.get(room.sessionId)!.genome = GENES.flagellum.bit; // tumbles exercise the shared rng
  await vi.waitFor(() => expect(player.genome).toBe(GENES.flagellum.bit));

  const input = room.input({ type: Input, mode: 'reliable' });
  const predict = Predict.get(room, { mode: 'lerp', delay: 100 });
  const me = predict.reconciler(player, {
    input,
    fields: ['x', 'y', 'heading', 'tumble', 'rng'],
    step: (ctx, s, cmd) => stepCell(s, player.mass, player.genome, cmd.dirX, cmd.dirY, ctx.dt, room.state.tick * TICK_DT),
    warnOnDivergence: 1, // also switches on the drift telemetry asserted below
  });

  // Drive it like the browser loop: ~60 fps for 1.5 s, swinging the pointer to force tumbles.
  let lead = 0;
  let tumbles = 0;
  for (let frame = 0; frame < 90; frame++) {
    for (let due = predict.tick(performance.now()); due > 0; due--) {
      const a = frame < 45 ? 0 : Math.PI; // a 180° swing halfway
      input.data.dirX = Math.cos(a) * 5; // |dir| ≫ 1, like a far-off pointer
      input.data.dirY = Math.sin(a) * 5;
      clampSteer(input.data);
      input.send();
    }
    if (me.state.tumble > 0) tumbles++;
    lead = Math.max(lead, Math.hypot(me.state.x - player.x, me.state.y - player.y));
    await sleep(16);
  }
  expect(input.sentCount).toBeGreaterThan(20);
  expect(tumbles).toBeGreaterThan(0);
  expect(lead).toBeGreaterThan(1); // prediction actually ran ahead of the server
  // Shared deterministic step: reconciles find ~nothing to correct. The residual comes from replay
  // reading the latest mass and sim clock (metabolism, slowly drifting currents): sub-unit.
  expect(me.drift.ema).toBeLessThan(0.3);

  for (let i = 0; i < 40 && input.lastProcessed < input.sentCount; i++) {
    predict.tick(performance.now());
    await sleep(25);
  }
  predict.tick(performance.now());
  expect(input.lastProcessed).toBe(input.sentCount);
  expect(me.state.rng).toBe(player.rng); // tumble randomness replayed exactly
  await room.leave();
});

test('clients rebuild every food packet exactly from its synced spawn point', async () => {
  const room = await join();
  await joinedPlayer(room);
  const authority = serverRoom(room).state;
  let checked = 0;
  for (const [id, n] of room.state.nutrients) {
    const truth = authority.nutrients.get(id);
    if (!truth) continue; // eaten or dissolved since the last patch
    expect([n.x0, n.y0, n.tick0, n.kind]).toEqual([truth.x0, truth.y0, truth.tick0, truth.kind]);
    const rebuilt = { x: n.x0, y: n.y0, tick: n.tick0 };
    drift(rebuilt, truth.tick);
    expect(rebuilt.x).toBe(truth.x);
    expect(rebuilt.y).toBe(truth.y);
    checked++;
  }
  expect(checked).toBeGreaterThan(300);
  await room.leave();
});

test('dev cheats are unavailable unless the server enables them, even if a client asks', async () => {
  const room: Room<any, PoolState> = await sdk.create(ROOM_NAME, { dev: true }, PoolState);
  await joinedPlayer(room);
  const serverPlayer = serverRoom(room).state.players.get(room.sessionId)!;
  const kicked = new Promise<number>((resolve) => room.onLeave(resolve));
  room.send('dev:toggleGene', 'flagellum');
  // No handler is registered, so Colyseus drops the client for sending an unknown message type.
  expect(await kicked).toBe(4002);
  expect(serverPlayer.genome).toBe(STARTER_GENOME);
});

test('a starved player is told why and respawns as a fresh instance', async () => {
  const room = await join();
  const before = await joinedPlayer(room);
  const died = new Promise((resolve) => room.onMessage('died', resolve));
  const readded = new Promise<Player>((resolve) => Callbacks.get<PoolState>(room).onAdd('players', (p, id) => {
    if (id === room.sessionId && p !== before) resolve(p);
  }, false));

  const serverPlayer = serverRoom(room).state.players.get(room.sessionId)!;
  serverPlayer.mass = MIN_MASS;
  serverPlayer.health = 0.01;

  expect(await died).toEqual({ cause: 'starvation' });
  const reborn = await readded;
  expect(reborn.mass).toBeCloseTo(SPAWN_MASS, 1);
  expect(reborn.health).toBe(HEALTH_MAX);
  await room.leave();
});

test('room caps at MAX_PLAYERS, overflow opens a second room', async () => {
  const rooms = await Promise.all(Array.from({ length: MAX_PLAYERS + 1 }, join));
  expect(new Set(rooms.map((r) => r.roomId)).size).toBe(2);
  await Promise.all(rooms.map((r) => r.leave()));
});
