import { defineRoom, defineServer } from '@colyseus/core';
import { Encoder } from '@colyseus/schema';
import { NUTRIENT_CAP, ROOM_NAME } from '@panspermia/shared';
import { PoolRoom, type PoolOptions } from './rooms/PoolRoom.ts';

// The join snapshot carries every drifting packet (~20 bytes each); size it for a full pool.
Encoder.BUFFER_SIZE = Math.max(Encoder.BUFFER_SIZE, NUTRIENT_CAP * 24);

export const createServer = (options: PoolOptions = {}) => defineServer({
  greet: false,
  // Every option must be set explicitly: Colyseus merges client create-options UNDER these,
  // so an unset key would let a client pass e.g. { dev: true } and unlock cheats.
  rooms: { [ROOM_NAME]: defineRoom(PoolRoom, { dev: options.dev === true }) },
});
