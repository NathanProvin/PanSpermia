// Species names: Spore hands every new creature a made-up name you can keep or change. Ours are
// Latin-flavoured binomials. Names are player input shown to everyone: `cleanName` is the only gate
// (P14 adds a moderation filter on top).

const GENUS_HEAD = ['Micro', 'Proto', 'Lumi', 'Cocco', 'Spiro', 'Bacto', 'Vibri', 'Halo', 'Thermo', 'Cyano', 'Myxo', 'Aqua', 'Lepto', 'Strepto', 'Rhodo', 'Glauco'];
const GENUS_TAIL = ['coccus', 'bacter', 'spira', 'monas', 'bacillus', 'vibrio', 'phila', 'lyta', 'nema', 'cystis'];
const EPITHETS = ['errans', 'velox', 'lucida', 'vorax', 'minima', 'rubra', 'viridis', 'audax', 'tenax', 'placida', 'ferox', 'nova', 'astralis', 'stellaris', 'peregrina', 'avida'];
const pick = <T>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)]!;

export const randomSpeciesName = () => `${pick(GENUS_HEAD)}${pick(GENUS_TAIL)} ${pick(EPITHETS)}`;

export const NAME_MAX = 24;
/** A displayable species name from untrusted input (trimmed, single spaces, letters/'/-), or undefined. */
export function cleanName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const name = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
  return name.length >= 2 && name.length <= NAME_MAX && /^\p{L}[\p{L}\p{M}' -]*$/u.test(name) ? name : undefined;
}
