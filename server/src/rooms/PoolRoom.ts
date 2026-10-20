import { Room, type Client } from '@colyseus/core';
import {
  ACTION_TOXIN, BOT_FILL, type Lineage, GENOME_FIELD, massCapOf, BOT_SPECIES, catalogFor, NutrientKind, type Gene, IDLE_GRACE_TICKS, Input, MAX_PLAYERS, PoolState, TICK_DT, TICK_RATE, sanitizeInput,
  stepCell,
  hasBit, withBit,
} from '@panspermia/shared';
import { type Hall, openHall, seedHall } from '../hall.ts';
import { type Bots, callVisitors, divideBots, fillBots, rebirth, stepBots, stepVisitors } from '../bots.ts';
import {
  PHAGE_KILLER, VIRUS_KILLER, foundSpecies, foundedAt, initPool, secrete, squirtInk, spawnNutrient, spawnPlasmid, spawnShard, stepWorld, submitDesign,
} from '../world.ts';

export interface PoolOptions {
  /** Enables cheat messages for manual testing. Only `--dev` turns it on; never in production. */
  dev?: boolean;
  /** Bots top the room up to this many cells (default BOT_FILL). */
  bots?: number;
  /** The Hall of Fame's SQLite file (`:memory:` by default: dev cheats and tests never reach the real one). */
  hall?: string;
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
  private hall!: Hall;

  override onCreate(options: PoolOptions = {}) {
    initPool(this.state);
    this.hall = openHall(options.hall ?? ':memory:');
    if (options.dev) seedHall(this.hall); // the end screen's lists look full without playing a dozen games
    const botFill = options.bots ?? BOT_FILL;
    this.setFixedTimestep((ctx) => {
      fillBots(this.state, this.bots, botFill); // humans count in their tier's quota
      const time = this.state.tick * TICK_DT;
      // One step per buffered input, the same step the client predicts and replays. Inputs of an
      // extinct species (no cell) are drained and dropped.
      for (const { sessionId: id } of this.clients) {
        const p = this.state.players.get(id);
        let steps = 0;
        for (const cmd of this.inputs.get(id)) {
          if (!p) continue;
          // A division cyst or a cocoon can't swim or act: its inputs step as no-ops (honest clients send zeros).
          const live = p.cyst > 0 || p.cocoon > 0 ? 0 : 1;
          const cooldown = p.dashCooldown;
          stepCell(p, p.mass, p.genome, cmd.dirX * live, cmd.dirY * live, cmd.actions * live, ctx.dt, time, p.tier, p.genome2, p.genome3, p.genome4);
          if (cmd.actions & ACTION_TOXIN) secrete(this.state, id);
          if (p.tier === 4 && p.dashCooldown > cooldown) squirtInk(this.state, id); // a squirt just started
          steps++;
        }
        if (!p) continue;
        // A silent client (backgrounded tab) still drifts with the current after a grace period;
        // the grace absorbs network jitter so bursty-but-live clients never get unpredicted steps.
        const idle = steps ? 0 : (this.idleTicks.get(id) ?? 0) + 1;
        this.idleTicks.set(id, idle);
        if (idle > IDLE_GRACE_TICKS) stepCell(p, p.mass, p.genome, 0, 0, 0, ctx.dt, time, p.tier, p.genome2, p.genome3, p.genome4);
      }
      stepVisitors(this.state, this.bots);
      stepBots(this.state, this.bots);
      const deaths = stepWorld(this.state);
      rebirth(this.state, this.bots, deaths);
      divideBots(this.state, this.bots);
      for (const { id, by, extinct = false, feast } of deaths) {
        if (feast) this.clients.getById(by)?.send('feast', feast); // the killer's feeding animation
        const why = by === PHAGE_KILLER ? { cause: 'phage' } : by === VIRUS_KILLER ? { cause: 'virus' }
          : by ? { cause: 'lysed', killer: this.speciesName(by) } : { cause: 'starvation' };
        this.clients.getById(id)?.send('died', { ...why, extinct });
      }
      this.broadcastPatch();
    }, TICK_RATE);
    // One patch per step, sent from the step: on its own timer the patch beat against the step's (Windows timers fire
    // every ~62 ms, so a patch carried 1 or 2 ticks) and remote cells and packets stuttered (user report). After
    // setFixedTimestep: set before it, Colyseus starts a spare clock timer that steals the step's elapsed time.
    this.patchRate = 0;

    // The editor's design from a dividing cell (validated in submitDesign): final, or a draft kept
    // for when the cyst times out.
    this.onMessage('design', (client, design: unknown) => {
      const l = this.state.lineages.get(client.sessionId);
      const landed = l?.evolved;
      const refused = submitDesign(this.state, client.sessionId, design);
      if (refused) client.send('designRefused', refused);
      if (l && !landed && l.evolved) this.land(client, l);
    });
    // The end screen of an extinct species still shows the Hall (nothing entered).
    this.onMessage('hallRequest', (client) => client.send('hall', this.hall.lists()));
    this.onMessage('draft', (client, design: unknown) => {
      submitDesign(this.state, client.sessionId, design, false);
    });
    this.onMessage('newSpecies', (client) => {
      const l = this.state.lineages.get(client.sessionId);
      if (l?.extinct || l?.evolved) foundSpecies(this.state, client.sessionId);
    });

    if (options.dev) {
      this.onMessage('dev:toggleGene', (client, index: unknown) => {
        const p = this.state.players.get(client.sessionId);
        // Cycle this individual's copies 0 → max → 0 of its tier's index-th part; unlock it for the editor.
        const l = this.state.lineages.get(client.sessionId);
        const cat = catalogFor(p?.tier ?? 1);
        const gene = cat.NAMES[index as number];
        if (!p || !l || !Number.isInteger(index) || !gene) return;
        const field = GENOME_FIELD[p.tier] ?? 'genome';
        p[field] = cat.withCopies(p[field], gene, (cat.copiesOf(p[field], gene) + 1) % (cat.GENES[gene]!.maxCopies + 1));
        if (l.tier === p.tier) l.library = withBit(l.library, cat.GENES[gene]!.bit);
      });
      // Drop a plasmid or a phage onto the cell.
      this.onMessage('dev:spawn', (client, what: unknown) => {
        const p = this.state.players.get(client.sessionId);
        if (p && what === 'plasmid') (p.tier >= 2 ? spawnShard : spawnPlasmid)(this.state, p.x, p.y); // a part for its tier
        if (p && what === 'phage') spawnNutrient(this.state, p.x, p.y, p.tier === 2 ? NutrientKind.virus : NutrientKind.phage); // its tier's virus
      });
      // Jump to the size cap (fission) or die on the spot (children, extinction).
      this.onMessage('dev:grow', (client) => {
        const p = this.state.players.get(client.sessionId);
        if (p) p.mass = massCapOf(p.tier);
      });
      this.onMessage('dev:dna', (client) => {
        const l = this.state.lineages.get(client.sessionId);
        if (l) {
          l.dna += 100;
          l.lifetimeDna += 100; // counts as earned, so Evolve can be tested too
        }
      });
      // Every rare visitor drops by near the player (to look at them without waiting for their visits).
      this.onMessage('dev:visitors', (client) => {
        const p = this.state.players.get(client.sessionId);
        if (p) callVisitors(this.state, this.bots, p.x, p.y);
      });
      // Unlock every part of the species' tier for the editor (to look at the whole catalog).
      this.onMessage('dev:unlock', (client) => {
        const l = this.state.lineages.get(client.sessionId);
        if (l) l.library = catalogFor(l.tier).NAMES.reduce((lib, g) => withBit(lib, catalogFor(l.tier).GENES[g]!.bit), l.library);
      });
      // Walk onto land on the spot (the end screen without playing the whole game).
      this.onMessage('dev:land', (client) => {
        const l = this.state.lineages.get(client.sessionId);
        if (l && !l.evolved) {
          l.evolved = true;
          this.land(client, l);
        }
      });
      this.onMessage('dev:die', (client) => {
        const p = this.state.players.get(client.sessionId);
        if (p) p.health = -1; // below 0: one tick of regen must not save it
      });
    }
  }

  /** Walked onto land: into the Hall of Fame; the winner gets both lists and its ranks. */
  private land(client: Client, l: Lineage) {
    const seconds = (this.state.tick - (foundedAt.get(l) ?? this.state.tick)) * TICK_DT;
    const win = { name: l.name, seconds, generations: l.generation, kills: l.kills };
    client.send('hall', { ...this.hall.record(win), win });
  }

  /** Who did it, for the death screen: the killer's species name (its cell may already be a successor). */
  private speciesName(id: string) {
    const bot = this.bots.get(id);
    return bot ? BOT_SPECIES[bot.species]!.name : this.state.lineages.get(id)?.name ?? 'a rival species';
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
