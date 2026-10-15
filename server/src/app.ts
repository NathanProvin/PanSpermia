import { defineRoom, defineServer } from '@colyseus/core';
import { Encoder } from '@colyseus/schema';
import { BOT_FILL, NUTRIENT_CAP, ROOM_NAME } from '@panspermia/shared';
import express from 'express';
import { PoolRoom, type PoolOptions } from './rooms/PoolRoom.ts';

// The join snapshot carries every drifting packet (~20 bytes each); size it for a full pool.
Encoder.BUFFER_SIZE = Math.max(Encoder.BUFFER_SIZE, NUTRIENT_CAP * 24);

export interface ServerOptions extends PoolOptions {
  /** Directory of the built client to serve at / (production: one origin for page and game, no CORS). */
  client?: string;
}

export const createServer = (options: ServerOptions = {}) => defineServer({
  greet: false,
  // Every option must be set explicitly: Colyseus merges client create-options UNDER these,
  // so an unset key would let a client pass e.g. { dev: true } and unlock cheats.
  rooms: { [ROOM_NAME]: defineRoom(PoolRoom, { dev: options.dev === true, bots: options.bots ?? BOT_FILL }) },
  express: (app) => {
    app.get('/health', (_req, res) => { res.json({ ok: true, uptime: Math.round(process.uptime()) }); });
    if (options.client) app.use(express.static(options.client, { index: 'index.html', dotfiles: 'deny' }));
  },
});
