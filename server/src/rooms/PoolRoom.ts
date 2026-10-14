import { Room, type Client } from '@colyseus/core';
import { Input, MAX_PLAYERS, PoolState, TICK_RATE, clampSteer, move } from '@panspermia/shared';
import { spawnPlayer, stepWorld, topUpNutrients } from '../world.ts';

export class PoolRoom extends Room<{ state: PoolState; input: Input }> {
  override maxClients = MAX_PLAYERS;
  override state = new PoolState();
  // Never trust the wire. Not a per-axis range clamp: that would bend the heading of
  // any |dir| > 1 input away from what the client predicted.
  override inputs = this.defineInput(Input, { sanitize: clampSteer });

  override onCreate() {
    topUpNutrients(this.state);
    this.setFixedTimestep((ctx) => {
      // One step per buffered input, the same step the client predicts and replays.
      for (const [id, p] of this.state.players) {
        for (const cmd of this.inputs.get(id)) move(p, p.mass, cmd.dirX, cmd.dirY, ctx.dt);
      }
      for (const id of stepWorld(this.state, ctx.dt)) {
        this.clients.getById(id)?.send('died', { cause: 'starvation' });
      }
    }, TICK_RATE);
  }

  override onJoin(client: Client) {
    this.state.players.set(client.sessionId, spawnPlayer());
  }

  override onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
  }
}
