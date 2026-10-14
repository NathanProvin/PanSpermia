import { defineRoom, defineServer } from '@colyseus/core';
import { ROOM_NAME } from '@panspermia/shared';
import { PoolRoom, type PoolOptions } from './rooms/PoolRoom.ts';

export const createServer = (options: PoolOptions = {}) => defineServer({
  greet: false,
  // Every option must be set explicitly: Colyseus merges client create-options UNDER these,
  // so an unset key would let a client pass e.g. { dev: true } and unlock cheats.
  rooms: { [ROOM_NAME]: defineRoom(PoolRoom, { dev: options.dev === true }) },
});
