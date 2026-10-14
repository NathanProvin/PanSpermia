import { Room, type Client } from '@colyseus/core';
import { MAX_PLAYERS, Player, PoolState, WORLD_RADIUS } from '@panspermia/shared';

export class PoolRoom extends Room<{ state: PoolState }> {
  override maxClients = MAX_PLAYERS;
  override state = new PoolState();

  override onJoin(client: Client) {
    // Uniform point in the spawn disc.
    const angle = Math.random() * 2 * Math.PI;
    const r = WORLD_RADIUS * Math.sqrt(Math.random());
    this.state.players.set(client.sessionId, new Player({ x: r * Math.cos(angle), y: r * Math.sin(angle) }));
  }

  override onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
  }
}
