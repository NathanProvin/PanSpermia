import {
  DEFAULT_RADII, MAX_PARTS, MAX_TIER, MAX_SEGMENTS, MIN_SEGMENTS, PLAN_NAMES, SEGMENT_MAX, SEGMENT_MIN, TIER_NAMES, catalogFor, cleanForm, type Form, MAX_BEND, MAX_ARM, RADIAL_ARMS, cleanName, isAnimal, segmentsOf,
} from '@panspermia/shared';
import * as THREE from 'three';
import { createCellView } from './scene/cells.ts';

// Shareable species card: a 1200×630 image (the social-preview size) of your species, plus a link
// that carries the design itself in the URL fragment — no server storage. Opening the link shows the
// card with a Play button. Link data is untrusted: `decodeCard` validates every field.

/** A placed part by name in its tier's catalog (the card doesn't care which tier's type it is). */
interface CardPart { gene: string; x: number; y: number; angle: number; scale: number; group: number }
const catalogOf = catalogFor;

export interface CardData {
  name: string;
  hue: number;
  tier: number;
  shape: number;
  /** A sculpted body shape (polish S4); absent: the shape preset. */
  form?: Form;
  /** A curled spine (segmentsOf bends); absent: straight. */
  bends?: number[];
  /** A radial body's arm count; absent: the older lobes format (segmentsOf). */
  arms?: number;
  parts: CardPart[];
  /** Animals: body plan and segment sizes. */
  plan: number;
  radii: number[];
  generation: number;
  dna: number;
  kills: number;
  fate: 'evolved' | 'extinct' | 'living';
}

const FATES = ['evolved', 'extinct', 'living'] as const;
const round = (x: number) => Math.round(x * 100) / 100;

/** Compact URL-safe text: JSON → UTF-8 → base64url. */
export function encodeCard(d: CardData) {
  // Optional tail: the sculpted form (or null), the spine's bends, the arm count; trailing defaults left out.
  const tail: unknown[] = [d.form ? [round(d.form.sx), round(d.form.sy), round(d.form.bend)] : null, (d.bends ?? []).map(round), d.arms ?? 0];
  const empty = (v: unknown) => v === null || v === 0 || (Array.isArray(v) && !v.length);
  while (tail.length && empty(tail.at(-1))) tail.pop();
  // The hue keeps 3 decimals: it carries the pigment and the pattern.
  const json = JSON.stringify([d.name, Math.round(d.hue * 1000) / 1000, d.generation, Math.round(d.dna), d.kills, FATES.indexOf(d.fate),
    d.parts.map((p) => [catalogOf(d.tier).GENES[p.gene]!.index, round(p.x), round(p.y), round(p.angle), round(p.scale)]), d.tier, d.shape, d.plan, d.radii.map(round), ...tail]);
  const bytes = new TextEncoder().encode(json);
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeCard(text: string): CardData | undefined {
  try {
    const bytes = Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));
    const [rawName, hue, generation, dna, kills, fate, parts, rawTier = 1, shape = 0, plan = 0, radii = DEFAULT_RADII, rawForm = null, rawBends = [], arms = 0] =
      JSON.parse(new TextDecoder().decode(bytes)) as unknown[];
    if (typeof rawTier !== 'number' || !Number.isInteger(rawTier) || rawTier < 1 || rawTier > MAX_TIER) return undefined;
    if (typeof plan !== 'number' || !PLAN_NAMES[plan] || !Array.isArray(radii) || radii.length < MIN_SEGMENTS
      || radii.length > MAX_SEGMENTS || !radii.every((r) => typeof r === 'number' && r >= SEGMENT_MIN && r <= SEGMENT_MAX)) return undefined;
    if (shape !== 0 && shape !== 1 && shape !== 2) return undefined;
    const [fx, fy, fb] = Array.isArray(rawForm) ? rawForm : [];
    const form = rawForm === null ? undefined : cleanForm({ sx: fx, sy: fy, bend: fb });
    if (rawForm !== null && !form) return undefined;
    if (!Array.isArray(rawBends) || rawBends.length > radii.length
      || !rawBends.every((b) => typeof b === 'number' && Math.abs(b) <= MAX_BEND)) return undefined;
    const bends = rawBends as number[];
    if (arms !== 0 && (plan !== 1 || typeof arms !== 'number' || !Number.isInteger(arms) || arms < RADIAL_ARMS[0] || arms > RADIAL_ARMS[1]
      || radii.length > 1 + MAX_ARM)) return undefined;
    const tier = rawTier;
    const name = cleanName(rawName);
    const count = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e6 ? v : undefined);
    if (!name || typeof hue !== 'number' || !(hue >= 0 && hue < 1) || !Array.isArray(parts) || parts.length > MAX_PARTS) return undefined;
    const g = count(generation);
    const d = count(dna);
    const k = count(kills);
    const f = FATES[fate as number];
    if (g === undefined || d === undefined || k === undefined || !f) return undefined;
    const placed: CardPart[] = [];
    for (const part of parts) {
      if (!Array.isArray(part) || part.length !== 5 || !part.every((v) => typeof v === 'number' && Number.isFinite(v))) return undefined;
      const [gene, x, y, angle, scale] = part as number[];
      const name = catalogOf(tier).NAMES[gene!];
      if (!name || Math.hypot(x!, y!) > 1.5 || scale! < 0.5 || scale! > 2) return undefined;
      placed.push({ gene: name, x: x!, y: y!, angle: angle!, scale: scale!, group: 0 });
    }
    return { name, hue, tier, shape, ...(form ? { form } : {}), ...(bends.length ? { bends } : {}), ...(arms ? { arms: arms as number } : {}), plan, radii: radii as number[], parts: placed, generation: g, dna: d, kills: k, fate: f };
  } catch {
    return undefined;
  }
}

export const cardLink = (d: CardData) => `${location.origin}${location.pathname}#card=${encodeCard(d)}`;

/** Render the cell with the game's own shaders into an image (a throwaway WebGL context). */
function renderCell(d: CardData, size: number) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(size, size);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const half = 2.3; // cell radii shown around the centre: room for flagella
  const camera = new THREE.OrthographicCamera(-half, half, half, -half, -10, 10);
  createCellView(scene, 0.42).update({ x: 0, y: 0.25, heading: Math.PI / 2, tumble: 0, spore: 0, cyst: 0 }, 1,
    { tier: d.tier, genome: catalogOf(d.tier).genomeOf(d.parts.map((p) => p.gene)), parts: d.parts, hue: d.hue, shape: d.form ?? d.shape,
      segments: isAnimal(d.tier) ? segmentsOf(d.plan, d.radii, d.bends, d.arms) : undefined, plan: d.plan }, 1.7, 0);
  renderer.render(scene, camera);
  const image = document.createElement('canvas'); // copy out before dropping the context (which blanks it)
  image.width = image.height = size;
  image.getContext('2d')!.drawImage(renderer.domElement, 0, 0);
  renderer.dispose();
  renderer.forceContextLoss();
  return image;
}

/** The card as a canvas: cell portrait on the left, name, fate, stats and parts on the right. */
export function renderCard(d: CardData) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 630;
  const g = canvas.getContext('2d')!;
  const bg = g.createRadialGradient(330, 315, 40, 330, 315, 900);
  bg.addColorStop(0, '#0d4a52');
  bg.addColorStop(1, '#02121a');
  g.fillStyle = bg;
  g.fillRect(0, 0, 1200, 630);
  g.fillStyle = 'rgb(159 231 224 / 0.06)';
  for (let i = 0; i < 40; i++) { // drifting plankton motes
    g.beginPath();
    g.arc((i * 263) % 1200, (i * 151) % 630, 2 + (i % 5) * 3, 0, 2 * Math.PI);
    g.fill();
  }
  g.drawImage(renderCell(d, 560), 40, 35, 560, 560);

  const accent = `hsl(${Math.round(d.hue * 360)} 80% 65%)`;
  const x = 640;
  g.textBaseline = 'alphabetic';
  g.fillStyle = accent;
  g.font = '600 54px system-ui, sans-serif';
  g.fillText(d.name, x, 150, 520);
  g.fillStyle = '#9fe7e0';
  g.font = '24px system-ui, sans-serif';
  g.fillText(`Tier ${d.tier} · ${TIER_NAMES[d.tier]}${d.tier === 4 ? ` (${PLAN_NAMES[d.plan]?.toLowerCase()})` : ''}`, x, 195); // tier 4: and its plan
  const fate = { evolved: '✦ Walked onto land', extinct: '✝ Extinct', living: '● Still dividing' }[d.fate];
  g.fillStyle = d.fate === 'evolved' ? '#ffd678' : d.fate === 'extinct' ? '#ff9a8a' : '#9fe7e0';
  g.font = '600 26px system-ui, sans-serif';
  g.fillText(fate, x, 245);

  g.fillStyle = '#dff7f3';
  g.font = '24px system-ui, sans-serif';
  const stats = [`Generation ${d.generation}`, `${d.dna} DNA gathered`, `${d.kills} rival${d.kills === 1 ? '' : 's'} lysed`];
  stats.forEach((line, i) => g.fillText(line, x, 315 + i * 36));

  const cat = catalogOf(d.tier);
  const genome = cat.genomeOf(d.parts.map((p) => p.gene));
  const parts = cat.NAMES.filter((gene) => cat.copiesOf(genome, gene))
    .map((gene) => cat.GENES[gene]!.label + (cat.copiesOf(genome, gene) > 1 ? ` ×${cat.copiesOf(genome, gene)}` : ''));
  g.fillStyle = '#9fe7e0';
  g.font = '19px system-ui, sans-serif';
  let line = '';
  let y = 450;
  for (const word of parts.length ? parts : ['No parts: a bare membrane']) {
    const next = line ? `${line} · ${word}` : word;
    if (g.measureText(next).width > 520 && line) {
      g.fillText(line, x, y);
      y += 28;
      line = word;
    } else line = next;
  }
  g.fillText(line, x, y);

  g.fillStyle = 'rgb(159 231 224 / 0.6)';
  g.font = '18px system-ui, sans-serif';
  g.fillText('Panspermia — evolve your own species', x, 595);
  return canvas;
}

/** Show the card overlay; `primary` is the main button (new species, or play). */
export function showCard(root: HTMLElement, d: CardData, primary: { label: string; action: () => void }) {
  const url = renderCard(d).toDataURL('image/png');
  const img = root.querySelector('img')!;
  img.src = url;
  img.alt = `Species card: ${d.name}`;
  root.querySelector<HTMLAnchorElement>('.download')!.href = url;
  const copy = root.querySelector<HTMLButtonElement>('.copy')!;
  copy.textContent = 'Copy link';
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(cardLink(d));
      copy.textContent = 'Link copied';
    } catch {
      copy.textContent = 'Copy failed: use the address bar';
      history.replaceState(null, '', cardLink(d));
    }
  };
  const button = root.querySelector<HTMLButtonElement>('.primary')!;
  button.textContent = primary.label;
  button.onclick = () => {
    root.hidden = true;
    primary.action();
  };
  root.hidden = false;
  button.focus();
}
