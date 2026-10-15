import { Room, type Client } from '@colyseus/core';
import {
  ACTION_TOXIN, BOT_FILL, GENES, NutrientKind, type Gene, IDLE_GRACE_TICKS, Input, MAX_PLAYERS, PoolState, TICK_DT, TICK_RATE, sanitizeInput,
  stepCell,
} from '@panspermia/shared';
import { type Bots, fillBots, rebirth, stepBots } from '../bots.ts';
import { PHAGE_KILLER, initPool, secrete, spawnNutrient, spawnPlasmid, spawnPlayer, stepWorld } from '../world.ts';

export interface PoolOptions {
  /** Enables cheat messages for manual testing. Only `--dev` turns it on; never in production. */
  dev?: boolean;
  /** Bots top the room up to this many cells (default BOT_FILL). */
  bots?: number;
}

export class PoolRoom extends Room<{ state: PoolState; input: Input }> {
  override maxClients = MAX_PLAYERS;
  override state = new PoolState();
  // Never trust the wire. Not a per-axis range clamp: that would bend the heading of
  // any |dir| > 1 input away from what the client predicted.
  override inputs = this.defineInput(Input, { sanitize: sanitizeInput });
  /** Consecutive ticks without input per session (server-only bookkeeping). */
  private idleTicks = new Map<string, number>();
  private bots: Bots = new Map();

  override onCreate(options: PoolOptions = {}) {
    initPool(this.state);
    const botFill = options.bots ?? BOT_FILL;
    this.setFixedTimestep((ctx) => {
      fillBots(this.state, this.bots, Math.max(0, botFill - this.clients.length));
      const time = this.state.tick * TICK_DT;
      // One step per buffered input, the same step the client predicts and replays.
      for (const [id, p] of this.state.players) {
        if (this.bots.has(id)) continue;
        let steps = 0;
        for (const cmd of this.inputs.get(id)) {
          stepCell(p, p.mass, p.genome, cmd.dirX, cmd.dirY, cmd.actions, ctx.dt, time);
          if (cmd.actions & ACTION_TOXIN) secrete(this.state, id);
          steps++;
        }
        // A silent client (backgrounded tab) still drifts with the current after a grace period;
        // the grace absorbs network jitter so bursty-but-live clients never get unpredicted steps.
        const idle = steps ? 0 : (this.idleTicks.get(id) ?? 0) + 1;
        this.idleTicks.set(id, idle);
        if (idle > IDLE_GRACE_TICKS) stepCell(p, p.mass, p.genome, 0, 0, 0, ctx.dt, time);
      }
      stepBots(this.state, this.bots);
      const deaths = stepWorld(this.state);
      rebirth(this.state, this.bots, deaths);
      for (const { id, by } of deaths) {
        const why = by === PHAGE_KILLER ? { cause: 'phage' } : by ? { cause: 'lysed', by } : { cause: 'starvation' };
        this.clients.getById(id)?.send('died', why);
      }
    }, TICK_RATE);

    if (options.dev) {
      this.onMessage('dev:toggleGene', (client, gene: unknown) => {
        const p = this.state.players.get(client.sessionId);
        if (p && typeof gene === 'string' && Object.hasOwn(GENES, gene)) p.genome ^= GENES[gene as Gene].bit;
      });
      // Drop a plasmid or a phage onto the cell.
      this.onMessage('dev:spawn', (client, what: unknown) => {
        const p = this.state.players.get(client.sessionId);
        if (p && what === 'plasmid') spawnPlasmid(this.state, p.x, p.y);
        if (p && what === 'phage') spawnNutrient(this.state, p.x, p.y, NutrientKind.phage);
      });
    }
  }

  override onJoin(client: Client) {
    this.state.players.set(client.sessionId, spawnPlayer(this.state.tick));
  }

  override onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.idleTicks.delete(client.sessionId);
  }
}
