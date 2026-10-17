// Natural pigments for species colours (polish S2): what real pond organisms look like under a microscope, instead
// of a free hue. Display (sRGB) hex colours; the renderer converts them to linear light.
export const PIGMENTS = [
  { name: 'Chlorophyll', hex: 0x6f9a3c },
  { name: 'Amber', hex: 0xc99a3e },
  { name: 'Rust', hex: 0xa65a3a },
  { name: 'Hyaline', hex: 0xb9c4bd },
  { name: 'Olive', hex: 0x8d8a45 },
  { name: 'Teal', hex: 0x4fa3a0 },
  { name: 'Carotene', hex: 0xd98a3a },
  { name: 'Umber', hex: 0x8a6545 },
] as const;
export const PATTERN_NAMES = ['Plain', 'Speckled', 'Banded'] as const;

/**
 * A species' pigment and pattern from its stored hue in [0, 1) (Lineage.hue stays the wire format): the integer part
 * of hue × PIGMENTS picks the pigment, the rest picks the pattern.
 */
export function pigmentOf(hue: number) {
  const k = Math.min(0.999999, Math.max(0, hue)) * PIGMENTS.length;
  return { pigment: Math.floor(k), pattern: Math.floor((k % 1) * PATTERN_NAMES.length) };
}
