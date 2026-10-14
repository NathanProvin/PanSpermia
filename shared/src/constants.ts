export const SERVER_PORT = 2567;
export const ROOM_NAME = 'pool';
export const MAX_PLAYERS = 50;
/** Server simulation + input rate, Hz. Advertised to predicting clients in the join handshake. */
export const TICK_RATE = 20;

/** Pool radius, world units. */
export const WORLD_RADIUS = 1500;

// Cell body. Area ∝ mass, so radius ∝ √mass.
export const SPAWN_MASS = 10;
/** Metabolism never burns below this; a cell sitting here starves. */
export const MIN_MASS = 5;
/** Tier-1 size cap; reproduction (P4) takes over from here. */
export const MASS_CAP = 100;
export const RADIUS_PER_SQRT_MASS = 4;
// Agar-like: bigger is slower. speed = SPEED_COEF · mass^SPEED_EXP u/s → 119 at spawn, 47 at cap.
export const SPEED_COEF = 300;
export const SPEED_EXP = -0.4;

// Metabolism burns (BASE + RATE·mass) mass/s: 0.04 at spawn, 0.22 at cap.
export const METABOLISM_BASE = 0.02;
export const METABOLISM_RATE = 0.002;
// Starving (at MIN_MASS) drains health; otherwise it regenerates.
export const HEALTH_MAX = 100;
export const STARVE_DPS = 2;
export const HEALTH_REGEN = 5;

// Dissolved-nutrient placeholder; P3 replaces it with current-borne plumes.
export const NUTRIENT_COUNT = 600;
export const NUTRIENT_MASS = 1;
