// Body shapes: a species trait sculpted in the editor (every tier), worn by players and bots. Visual
// only — collisions stay circular. Designs are stored on the unit circle (canonical body frame: x
// forward, y left, in cell radii); `deform` maps a canonical point onto the shaped body (stretch, then
// a bend), `undeform` maps back. The body shader and part placement use the same maths.

/** A body's shape: stretch along (sx) and across (sy) the swim axis, and a bend (a comma). */
export interface Form { readonly sx: number; readonly sy: number; readonly bend: number }

/** Presets: bots, and species from before sculpting (polish S4); a sculpted species stores its own Form. */
export const SHAPES: readonly Form[] = [
  { sx: 1, sy: 1, bend: 0 }, // round: coccus
  { sx: 1.45, sy: 0.72, bend: 0 }, // elongated: rod (bacillus); about the same area as the circle
  { sx: 1.4, sy: 0.66, bend: 0.38 }, // curved comma: vibrio
];
/** Shape names per tier (index = shape id). */
export const SHAPE_NAMES = [[], ['Coccus', 'Rod', 'Vibrio'], ['Round', 'Elongated', 'Crescent'], ['Compact', 'Long', 'Curved'], ['Compact', 'Long', 'Curved']] as const;
/** What the editor's sculpting handles (and the server) allow. */
export const FORM_LIMITS = { sx: [0.75, 1.6], sy: [0.55, 1.15], bend: [-0.45, 0.45] } as const;

/** Bend offset keeping the curved body centred on the cell: y' gets bend·(x'² − BEND_CENTRE·sx²). */
export const BEND_CENTRE = 1 / 3;

const shapeOf = (shape: number | Form): Form => (typeof shape === 'number' ? SHAPES[shape] ?? SHAPES[0]! : shape);

/** A species' shape: its sculpted form, or its preset (sx 0 = never sculpted). */
export const formOf = (l: { shape: number; sx: number; sy: number; bend: number }): Form =>
  l.sx > 0 ? { sx: l.sx, sy: l.sy, bend: l.bend } : shapeOf(l.shape);

/** An untrusted form (editor design, card link), or undefined when anything is off. */
export function cleanForm(v: unknown): Form | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const { sx, sy, bend } = v as Record<string, unknown>;
  const ok = (x: unknown, [lo, hi]: readonly [number, number]) => typeof x === 'number' && x >= lo && x <= hi;
  return ok(sx, FORM_LIMITS.sx) && ok(sy, FORM_LIMITS.sy) && ok(bend, FORM_LIMITS.bend)
    ? { sx: sx as number, sy: sy as number, bend: bend as number } : undefined;
}

/** A canonical point (and a direction at it, rad) on the shaped body; `flex` bends it further (a turning body). */
export function deform(shape: number | Form, x: number, y: number, angle = 0, flex = 0) {
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
export function undeform(shape: number | Form, x: number, y: number) {
  const { sx, sy, bend } = shapeOf(shape);
  return { x: x / sx, y: (y - bend * (x * x - BEND_CENTRE * sx * sx)) / sy };
}

export const shapeUniform = (shape: number | Form) => ({ ...shapeOf(shape), centre: BEND_CENTRE });
