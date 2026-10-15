import { Room, type Client } from '@colyseus/core';
import {
  ACTION_TOXIN, BOT_FILL, MASS_CAP, BOT_SPECIES, GENES, copiesOf, withCopies, NutrientKind, type Gene, IDLE_GRACE_TICKS, Input, MAX_PLAYERS, PoolState, TICK_DT, TICK_RATE, sanitizeInput,
  stepCell,
} from '@panspermia/shared';
import { type Bots, fillBots, rebirth, stepBots } from '../bots.ts';
import {
  PHAGE_KILLER, foundSpecies, initPool, secrete, spawnNutrient, spawnPlasmid, stepWorld, submitDesign,
} from '../world.ts';

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
      // One step per buffered input, the same step the client predicts and replays. Inputs of an
      // extinct species (no cell) are drained and dropped.
      for (const { sessionId: id } of this.clients) {
        const p = this.state.players.get(id);
        let steps = 0;
        for (const cmd of this.inputs.get(id)) {
          if (!p) continue;
          // A division cyst can't swim or act: its inputs step as no-ops (honest clients send zeros).
          const live = p.cyst > 0 ? 0 : 1;
          stepCell(p, p.mass, p.genome, cmd.dirX * live, cmd.dirY * live, cmd.actions * live, ctx.dt, time);
          if (cmd.actions & ACTION_TOXIN) secrete(this.state, id);
          steps++;
        }
        if (!p) continue;
        // A silent client (backgrounded tab) still drifts with the current after a grace period;
        // the grace absorbs network jitter so bursty-but-live clients never get unpredicted steps.
        const idle = steps ? 0 : (this.idleTicks.get(id) ?? 0) + 1;
        this.idleTicks.set(id, idle);
        if (idle > IDLE_GRACE_TICKS) stepCell(p, p.mass, p.genome, 0, 0, 0, ctx.dt, time);
      }
      stepBots(this.state, this.bots);
      const deaths = stepWorld(this.state);
      rebirth(this.state, this.bots, deaths);
      for (const { id, by, extinct = false } of deaths) {
        const why = by === PHAGE_KILLER ? { cause: 'phage' } : by ? { cause: 'lysed', killer: this.speciesName(by) } : { cause: 'starvation' };
        this.clients.getById(id)?.send('died', { ...why, extinct });
      }
    }, TICK_RATE);

    // The editor's submission from a dividing cell (validated in submitDesign).
    this.onMessage('design', (client, design: unknown) => {
      const refused = submitDesign(this.state, client.sessionId, design);
      if (refused) client.send('designRefused', refused);
    });
    this.onMessage('newSpecies', (client) => {
      if (this.state.lineages.get(client.sessionId)?.extinct) foundSpecies(this.state, client.sessionId);
    });

    if (options.dev) {
      this.onMessage('dev:toggleGene', (client, gene: unknown) => {
        const p = this.state.players.get(client.sessionId);
        // Cycle this individual's copies 0 → max → 0 and unlock the part for the editor.
        const l = this.state.lineages.get(client.sessionId);
        if (!p || !l || typeof gene !== 'string' || !Object.hasOwn(GENES, gene)) return;
        const g = gene as Gene;
        p.genome = withCopies(p.genome, g, (copiesOf(p.genome, g) + 1) % (GENES[g].maxCopies + 1));
        l.library |= GENES[g].bit;
      });
      // Drop a plasmid or a phage onto the cell.
      this.onMessage('dev:spawn', (client, what: unknown) => {
        const p = this.state.players.get(client.sessionId);
        if (p && what === 'plasmid') spawnPlasmid(this.state, p.x, p.y);
        if (p && what === 'phage') spawnNutrient(this.state, p.x, p.y, NutrientKind.phage);
      });
      // Jump to the size cap (fission) or die on the spot (children, extinction).
      this.onMessage('dev:grow', (client) => {
        const p = this.state.players.get(client.sessionId);
        if (p) p.mass = MASS_CAP;
      });
      this.onMessage('dev:die', (client) => {
        const p = this.state.players.get(client.sessionId);
        if (p) p.health = -1; // below 0: one tick of regen must not save it
      });
    }
  }

  /** Who did it, for the death screen. Player species get names in P5. */
  private speciesName(id: string) {
    const bot = this.bots.get(id);
    return bot ? BOT_SPECIES[bot.species]!.name : 'a rival species';
  }

  override onJoin(client: Client) {
    foundSpecies(this.state, client.sessionId);
  }

  override onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.state.lineages.delete(client.sessionId);
    this.idleTicks.delete(client.sessionId);
  }
}
