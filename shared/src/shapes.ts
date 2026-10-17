// Body shapes: a species trait picked in the editor (every tier), worn by players and bots. Visual
// only — collisions stay circular. Designs are stored on the unit circle (canonical body frame: x
// forward, y left, in cell radii); `deform` maps a canonical point onto the shaped body (stretch, then
// a bend), `undeform` maps back. The body shader and part placement use the same maths.

export const SHAPES = [
  { sx: 1, sy: 1, bend: 0 }, // round: coccus
  { sx: 1.45, sy: 0.72, bend: 0 }, // elongated: rod (bacillus); about the same area as the circle
  { sx: 1.4, sy: 0.66, bend: 0.38 }, // curved comma: vibrio
] as const;
/** Shape names per tier (index = shape id). */
export const SHAPE_NAMES = [[], ['Coccus', 'Rod', 'Vibrio'], ['Round', 'Elongated', 'Crescent'], ['Compact', 'Long', 'Curved'], ['Compact', 'Long', 'Curved']] as const;

/** Bend offset keeping the curved body centred on the cell: y' gets bend·(x'² − BEND_CENTRE·sx²). */
const BEND_CENTRE = 1 / 3;

const shapeOf = (shape: number) => SHAPES[shape] ?? SHAPES[0];

/** A canonical point (and a direction at it, rad) on the shaped body; `flex` bends it further (a turning body). */
export function deform(shape: number, x: number, y: number, angle = 0, flex = 0) {
  const { sx, sy } = shapeOf(shape);
  const bend = shapeOf(shape).bend + flex;
  const dx = x * sx;
  const lift = bend * (dx * dx - BEND_CENTRE * sx * sx);
  // The direction: the canonical (circle) normal pushed through the shape's gradient.
  const gx = Math.cos(angle) / sx;
  const gy = Math.sin(angle) / sy;
  return { x: dx, y: y * sy + lift, angle: Math.atan2(gy, gx - gy * 2 * bend * dx) };
}

/** Inverse of `deform` for points (editor pointer → canonical design coordinates). */
export function undeform(shape: number, x: number, y: number) {
  const { sx, sy, bend } = shapeOf(shape);
  return { x: x / sx, y: (y - bend * (x * x - BEND_CENTRE * sx * sx)) / sy };
}

export const shapeUniform = (shape: number) => ({ ...shapeOf(shape), centre: BEND_CENTRE });
