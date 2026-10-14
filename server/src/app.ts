import { defineRoom, defineServer } from '@colyseus/core';
import { ROOM_NAME } from '@panspermia/shared';
import { PoolRoom } from './rooms/PoolRoom.ts';

export const createServer = () => defineServer({
  greet: false,
  rooms: { [ROOM_NAME]: defineRoom(PoolRoom) },
});
