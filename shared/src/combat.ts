// Tier-1 combat is lysis: break the other cell's membrane, then eat what spills out.
// Shared because clients render clouds (radius over age) and predict the endospore.
import { HEALTH_MAX, T2_HEALTH_MAX, T3_HEALTH_MAX, T4_HEALTH_MAX } from './constants.ts';
import { hasGene } from './genes.ts';

/** Input action bits (Input.actions). Toxin: secrete (tier 1) / poison (tier 2). Spore: endospore (tier 1) / jet dash (tier 2). */
export const ACTION_TOXIN = 1;
export const ACTION_SPORE = 2;
export const ACTION_MASK = ACTION_TOXIN | ACTION_SPORE;

/**
 * Secreted toxins form clouds that drift on the current, spread out and weaken with age.
 * radius: [at release, at dissolution]; dps at release, fading linearly to 0; cost in mass. `gene` is
 * in the catalog of `tier`; a cell secretes the toxins of its own tier.
 */
export const TOXINS = [
  { gene: 'bacteriocin', tier: 1, radius: [40, 110], life: 4, dps: 12, cooldown: 2.5, cost: 0.6 }, // wide area denial
  { gene: 'poreFormer', tier: 1, radius: [28, 55], life: 1.2, dps: 45, cooldown: 3, cost: 0.8 }, // short brutal burst
  { gene: 'poison', tier: 2, radius: [45, 130], life: 3, dps: 30, cooldown: 2, cost: 3 }, // eukaryote poison trail
  // A mollusk's ink: harmless, huge, it hides whatever is inside it (released by the dash, not by left click).
  { gene: 'inkSac', tier: 4, radius: [700, 1700], life: 7, dps: 0, cooldown: 0, cost: 0 }, // wider than the mollusk itself
] as const;
/** The ink cloud's TOXINS index. */
export const INK = TOXINS.findIndex((t) => t.gene === 'inkSac');
export type ToxinKind = number; // index into TOXINS

const fraction = (kind: ToxinKind, age: number) => Math.min(1, Math.max(0, age / TOXINS[kind]!.life));
export const cloudRadius = (kind: ToxinKind, age: number) => {
  const [r0, r1] = TOXINS[kind]!.radius;
  return r0 + (r1 - r0) * Math.sqrt(fraction(kind, age)); // diffusion: r ∝ √t
};
export const cloudDps = (kind: ToxinKind, age: number) => TOXINS[kind]!.dps * (1 - fraction(kind, age));

/** T6SS: a contact-dependent molecular syringe; damage per second while touching. */
export const T6SS_DPS = 12;
/** Health regenerates only this long after the last hit. */
export const REGEN_DELAY = 3; // s
export const ENDOSPORE_TIME = 5; // s dormant: invulnerable, no swimming, eating or metabolism
export const ENDOSPORE_COOLDOWN = 45; // s
export const CAPSULE_SWIM = 0.9;
export const WALL_SWIM = 0.85;

/** Share of toxin damage taken. Capsule slows every toxin; efflux pumps export bacteriocins. */
export function toxinFactor(genome: number, kind: ToxinKind) {
  let f = hasGene(genome, 'capsule') ? 0.6 : 1;
  if (TOXINS[kind]!.gene === 'bacteriocin' && hasGene(genome, 'effluxPump')) f *= 0.3;
  return f;
}
/** Share of contact (T6SS) damage taken: a thick wall blunts the syringe. */
export const contactFactor = (genome: number) => (hasGene(genome, 'thickWall') ? 0.5 : 1);
export const healthMaxOf = (genome: number, tier = 1) =>
  tier === 4 ? T4_HEALTH_MAX : tier === 3 ? T3_HEALTH_MAX : tier === 2 ? T2_HEALTH_MAX : HEALTH_MAX * (hasGene(genome, 'thickWall') ? 1.4 : 1);
