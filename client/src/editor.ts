import {
  CHILD_PRICE, evolveDnaOf, type Catalog, type Form, type Lineage, MAX_CHILDREN, MAX_PARTS, MAX_TIER, NAME_MAX, type Placement, TIER_NAMES,
  catalogFor, cleanName, deform, undeform, DEFAULT_RADII, DEFAULT_RADII_OF, FORM_LIMITS, MAX_SEGMENTS, MIN_SEGMENTS, PATTERN_NAMES,
  PIGMENTS, PLAN_NAMES, PLANS_OF, SEGMENT_MAX, SEGMENT_MIN, BEND_CENTRE, animalRim, fitsPlan, formOf, isAnimal, pigmentOf, segmentsOf,
} from '@panspermia/shared';
import * as THREE from 'three';
import { CHILD_ICON } from './hud.ts';
import { createCellView } from './scene/cells.ts';

// Spore-like species editor, open while your cell sits in its division cyst. One editor for every tier: the tier's
// part catalog (palette, prices, copies, slots, default spots) is picked when it opens.
// Parts: a grid of icons rendered from the parts' own shaders; drag one onto the body (membrane parts snap to the rim,
// internal ones float inside), or click it to place it at its usual spot; coats toggle. Drag a placed part to move it,
// off the body (or right-click) to remove it (refunded), wheel to resize. Symmetry: axial mirrors across the forward
// axis, radial repeats around the centre; a placement on the axis (or the centre) stays a single copy.
// Sculpting, like clay: a cell's nose handle stretches it and bends it into a comma, its side handle makes it thinner
// or plumper; an animal's tail handle adds or removes segments, and dragging a segment's edge thickens or slims it
// (its neighbours follow a little). Colour: natural pigments and a pattern. Children are bought at a fixed price.

type Symmetry = 'axial' | 'radial';
/** One placement as the player made it: a master part plus how it repeats. */
interface Group { gene: string; x: number; y: number; angle: number; scale: number; repeat: 'single' | 'axial' | 'radial'; n: number }
export interface Design {
  parts: Placement<string>[]; hue: number; shape: number; children: number; name: string; evolve?: boolean;
  /** A cell's sculpted shape. */
  form?: Form;
  plan?: number; radii?: number[];
}

const VIEW_HALF = 2.4; // cell radii visible above and below the centre
const ANIMAL_VIEW_HALF = 3; // an animal's long body, legs and antennae need more room
const AXIS_SNAP = 0.12; // radii: this close to the axis (or the centre) is "on" it
const PICK = 0.3; // radii: grab distance for placed parts
const INTERIOR = 0.6; // internal parts stay this far inside
const FORWARD = Math.PI / 2; // the editor shows the cell swimming up the screen
const ICON_PX = 96;
/** Where the sculpting handles sit, in body radii beyond the outline. */
const HANDLE_OUT = 1.1;
/** How far (body radii) the tail handle travels per segment added or removed. */
const SEGMENT_STEP = 0.28;
/** How much a resized segment's neighbours follow it (exponent of the size ratio): clay, not Lego. */
const FALLOFF = 0.4;

/** Every copy a group stands for, in the body frame (x forward, y left). */
function expand(g: Group): Omit<Placement<string>, 'group'>[] {
  const master = { gene: g.gene, x: g.x, y: g.y, angle: g.angle, scale: g.scale };
  if (g.repeat === 'axial') return [master, { ...master, y: -g.y, angle: -g.angle }];
  if (g.repeat === 'radial') {
    return Array.from({ length: g.n }, (_, k) => {
      const r = (2 * Math.PI * k) / g.n;
      return { ...master, x: g.x * Math.cos(r) - g.y * Math.sin(r), y: g.x * Math.sin(r) + g.y * Math.cos(r), angle: g.angle + r };
    });
  }
  return [master];
}
const placementsOf = (groups: Group[]) => groups.flatMap((g, group) => expand(g).map((p) => ({ ...p, group })));
const genomeOf = (cat: Catalog, groups: Group[]) =>
  groups.reduce((genome, g) => cat.withCopies(genome, g.gene, cat.copiesOf(genome, g.gene) + expand(g).length), 0);

/** Rebuild the player's groups from a saved design (parts sharing a group number came from one placement). */
function groupsOf(cat: Catalog, lineage: Lineage): Group[] {
  const byGroup = new Map<number, Placement<string>[]>();
  for (const p of lineage.parts) {
    const part = { gene: cat.NAMES[p.gene]!, x: p.x, y: p.y, angle: p.angle, scale: p.scale, group: p.group };
    byGroup.set(p.group, [...(byGroup.get(p.group) ?? []), part]);
  }
  return [...byGroup.values()].map(([master, ...copies]) => ({
    ...master!,
    repeat: copies.length === 0 ? 'single' : copies.length === 1 && Math.abs(copies[0]!.y + master!.y) < 1e-3 ? 'axial' : 'radial',
    n: copies.length + 1,
  }));
}

/** Where a part dropped at body-frame (bx, by) goes, given the symmetry and the copies still allowed. */
function placeAt(cat: Catalog, gene: string, bx: number, by: number, symmetry: Symmetry, available: number): Group | undefined {
  if (available < 1) return undefined;
  let x: number;
  let y: number;
  let angle = 0;
  let onAxis: boolean;
  if (cat.GENES[gene]!.slot === 'membrane') {
    angle = Math.atan2(by, bx);
    onAxis = symmetry === 'axial' && Math.abs(Math.sin(angle)) < AXIS_SNAP;
    if (onAxis) angle = Math.cos(angle) > 0 ? 0 : Math.PI;
    x = Math.cos(angle);
    y = Math.sin(angle);
  } else {
    const r = Math.hypot(bx, by);
    const k = r > INTERIOR ? INTERIOR / r : 1;
    x = bx * k;
    y = by * k;
    onAxis = symmetry === 'axial' ? Math.abs(y) < AXIS_SNAP : r < AXIS_SNAP;
    if (onAxis && symmetry === 'axial') y = 0;
    if (onAxis && symmetry === 'radial') x = y = 0;
  }
  const single = onAxis || available < 2;
  return {
    gene, x, y, angle, scale: 1,
    repeat: single ? 'single' : symmetry,
    n: single ? 1 : symmetry === 'axial' ? 2 : Math.min(3, available),
  };
}

/** A pigment and pattern packed into the stored hue (pigmentOf unpacks it). */
const hueOf = (pigment: number, pattern: number) => (pigment + (pattern + 0.5) / PATTERN_NAMES.length) / PIGMENTS.length;
const clampTo = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));

const svg = (body: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const PATTERN_ICONS = [
  svg('<circle cx="12" cy="12" r="8"/>'),
  svg('<circle cx="12" cy="12" r="8"/><circle cx="9" cy="10" r="1.6" class="ink"/><circle cx="14.5" cy="9" r="1.2" class="ink"/><circle cx="13" cy="15" r="1.7" class="ink"/><circle cx="8.5" cy="15" r="1" class="ink"/>'),
  svg('<circle cx="12" cy="12" r="8"/><path d="M6.5 8.5h11M4.5 12h15M6.5 15.5h11" class="line"/>'),
];
const PLAN_ICONS = [
  svg('<circle cx="12" cy="5.5" r="2.8"/><circle cx="12" cy="11.5" r="3.6"/><circle cx="12" cy="18" r="2.8"/>'), // spine
  svg('<circle cx="12" cy="12" r="3.6"/><circle cx="12" cy="5" r="2.4"/><circle cx="18.5" cy="14" r="2.4"/><circle cx="5.5" cy="14" r="2.4"/><circle cx="12" cy="19.5" r="2.4"/>'), // radial
  svg('<ellipse cx="12" cy="6" rx="3.5" ry="2.5"/><ellipse cx="12" cy="11.5" rx="4" ry="2.8"/><ellipse cx="12" cy="17" rx="3" ry="2.4"/><path d="M8 11.5H3.5M16 11.5h4.5M8.5 16H5M15.5 16H19" class="line"/>'), // arthropod
  svg('<path d="M4 17c0-6 4-11 9-11 4 0 7 3 7 6.5S17 18 13.5 18 9 15.5 9 13s2-4 4.5-4" class="line"/><path d="M3 19h18" class="line"/>'), // mollusk
];
const SYM_ICONS = {
  axial: svg('<path d="M12 3v18" class="line"/><path d="M9 8 5 12l4 4M15 8l4 4-4 4" class="line"/>'),
  radial: svg('<circle cx="12" cy="12" r="2"/><path d="M12 3v5M12 16v5M3 12h5M16 12h5M5.6 5.6l3.5 3.5M14.9 14.9l3.5 3.5M18.4 5.6l-3.5 3.5M9.1 14.9l-3.5 3.5" class="line"/>'),
};

/** Linear light → sRGB byte (icons are read back from a linear render target). */
const toSrgb = (c: number) => Math.round(255 * Math.min(1, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));

export function createEditor(renderer: THREE.WebGLRenderer, root: HTMLElement) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fb3a6); // sunny pond water: organisms are drawn for a light background (polish S2)
  const camera = new THREE.OrthographicCamera(-1, 1, VIEW_HALF, -VIEW_HALF, -10, 10);
  const cell = createCellView(scene, 0.42);
  // Part icons: each part rendered on its own small piece of body into a render target, read back into an image.
  const iconScene = new THREE.Scene();
  const iconCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
  const iconCell = createCellView(iconScene, 0.3);
  const iconTarget = new THREE.WebGLRenderTarget(ICON_PX, ICON_PX);
  const iconPixels = new Uint8Array(ICON_PX * ICON_PX * 4);
  const iconCanvas = Object.assign(document.createElement('canvas'), { width: ICON_PX, height: ICON_PX });
  const iconContext = iconCanvas.getContext('2d')!;

  root.innerHTML = `
    <p class="ed-timer" role="timer"></p>
    <section class="panel" id="palette" aria-label="Parts">
      <h2>Parts</h2>
      <div class="parts"></div>
      <p class="part-info" aria-live="polite"></p>
    </section>
    <section class="panel" id="editor-side" aria-label="Design">
      <input type="text" class="name" aria-label="Species name" maxlength="${NAME_MAX}" autocomplete="off" spellcheck="false">
      <p class="dna"><b></b> DNA <small></small></p>
      <div class="ed-row swatches" role="radiogroup" aria-label="Pigment"></div>
      <div class="ed-row patterns" role="radiogroup" aria-label="Pattern"></div>
      <div class="ed-row tools"><button type="button" class="icon sym"></button><span class="plans"></span></div>
      <div class="ed-row kids">
        <button type="button" class="icon fewer" aria-label="One child fewer">−</button>
        <span class="eggs"></span>
        <button type="button" class="icon more" aria-label="One child more (${CHILD_PRICE} DNA)">+</button>
      </div>
      <p class="stats"></p>
      <p class="message" role="status"></p>
      <button type="button" class="primary hatch">Divide</button>
      <div class="evolution"><div class="gauge dna"><i></i></div><button type="button" class="evolve">Evolve</button></div>
    </section>
    <div class="handle" data-h="nose" title="Drag to stretch, or sideways to bend"></div>
    <div class="handle" data-h="side" title="Drag to make it thinner or plumper"></div>
    <div class="handle" data-h="tail" title="Drag out to add segments, in to remove them"></div>
    <img class="drag-ghost" alt="" hidden>
    <p class="ed-help">Drag parts onto the body · drag the round handles to sculpt it · drag a part away to remove it · wheel to resize</p>`;
  const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const palette = $<HTMLElement>('.parts');
  const nameInput = $<HTMLInputElement>('.name');
  const evolveButton = $<HTMLButtonElement>('.evolve');
  const ghost = $<HTMLImageElement>('.drag-ghost');
  const handles = { nose: $<HTMLElement>('[data-h="nose"]'), side: $<HTMLElement>('[data-h="side"]'), tail: $<HTMLElement>('[data-h="tail"]') };
  let name = '';
  /** Evolving is final for this tier: the first click arms the button, the second commits. */
  let evolveArmed = false;
  let evolving = false;

  let lineage: Lineage | undefined;
  let cat = catalogFor(1);
  let shape = 0;
  let form: Form = { sx: 1, sy: 1, bend: 0 };
  let groups: Group[] = [];
  let plan = 0;
  let radii: number[] = [...DEFAULT_RADII];
  let pigment = 0;
  let pattern = 0;
  /** The stored hue, kept exactly until the player picks a pigment or pattern. */
  let hue = 0;
  let icons = new Map<string, string>();
  /** A segment being resized: its index, its centre and pointer distance when grabbed, every size then. */
  let resize: { i: number; cx: number; cy: number; d0: number; radii0: number[] } | undefined;
  /** A sculpting handle being dragged (and, for the tail, the pointer's distance from the centre and the body then). */
  let sculpt: { h: 'nose' | 'side' | 'tail'; d0: number; radii0: number[] } | undefined;
  const animal = () => isAnimal(lineage?.tier ?? 1);
  const segments = () => segmentsOf(plan, radii);
  const shownForm = (): Form | number => (animal() ? shape : form); // animals are sculpted by their segments
  let children = 0;
  let symmetry: Symmetry = 'axial';
  let submitted = false;
  /** A part being dragged: a new one from the palette, or a placed group lifted off the body. */
  let drag: { gene: string; group?: Group; at?: Group } | undefined;
  let message = '';
  let submit: (design: Design, final: boolean) => void = () => {};
  let draftTimer: ReturnType<typeof setTimeout> | undefined;

  const cost = (gs: Group[]) => cat.priceOf(genomeOf(cat, gs)) - cat.priceOf(lineage!.genome) + children * CHILD_PRICE;
  const working = () => (drag?.at ? [...groups, drag.at] : groups);
  const available = (gene: string) => cat.GENES[gene]!.maxCopies - cat.copiesOf(genomeOf(cat, groups), gene);

  /** The body's shaped frame (cell radii, x forward = up the screen) under a pointer. */
  const shaped = (e: { clientX: number; clientY: number }) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const wx = ((e.clientX - rect.left) / rect.width * 2 - 1) * camera.right;
    const wy = -((e.clientY - rect.top) / rect.height * 2 - 1) * camera.top;
    return { x: wy, y: -wx }; // rotate the screen by -FORWARD
  };
  /** Canonical design coordinates under a pointer: the shaped frame with the body shape undone. */
  const toBody = (e: { clientX: number; clientY: number }) => {
    const s = shaped(e);
    const c = undeform(shownForm(), s.x, s.y);
    return { bx: c.x, by: c.y };
  };
  /** Screen pixel of a point in the shaped frame. */
  const toScreen = (x: number, y: number) => {
    const rect = renderer.domElement.getBoundingClientRect();
    return { left: rect.left + (-y / camera.right + 1) / 2 * rect.width, top: rect.top + (1 - x / camera.top) / 2 * rect.height };
  };
  const pick = (bx: number, by: number) => {
    let best = -1;
    let bestD = PICK;
    for (const [i, g] of groups.entries()) {
      if (cat.GENES[g.gene]!.slot === 'coat') continue; // coats are toggled from the palette
      for (const p of expand(g)) {
        // An animal's membrane parts are drawn on its outline, not the unit circle.
        const k = animal() && cat.GENES[g.gene]!.slot === 'membrane' ? animalRim(p.angle, segments()) : 1;
        const d = Math.hypot(p.x * k - bx, p.y * k - by);
        if (d < bestD) [best, bestD] = [i, d];
      }
    }
    return best;
  };

  /** Try to add a group; explain why not. */
  const commit = (g: Group | undefined) => {
    if (!g) return void (message = 'No copies of that part left.');
    const next = [...groups, g];
    if (placementsOf(next).length > MAX_PARTS) return void (message = 'The body is full.');
    if (cost(next) > lineage!.dna) return void (message = 'Not enough DNA.');
    groups = next;
    message = '';
  };
  const placeDefault = (gene: string) => {
    const { slot, at } = cat.GENES[gene]!;
    if (slot === 'coat') {
      const i = groups.findIndex((g) => g.gene === gene);
      if (i >= 0) groups.splice(i, 1);
      else commit({ gene, x: 0, y: 0, angle: 0, scale: 1, repeat: 'single', n: 1 });
    } else if (slot === 'membrane') commit(placeAt(cat, gene, Math.cos(at as number), Math.sin(at as number), symmetry, available(gene)));
    else commit(placeAt(cat, gene, ...(at as readonly [number, number]), symmetry, available(gene)));
    render();
  };

  /** One part on a small piece of body, rendered with the game's own shaders and read back as an image. */
  const renderIcon = (gene: string) => {
    const { slot, at } = cat.GENES[gene]!;
    const segs = animal() ? segments() : undefined;
    const whip = gene === 'flagellum' || gene === 'tail';
    let part: Placement<string> | undefined;
    let focus = { x: 0, y: 0 };
    let half = animal() ? 2.4 : 1.35; // a coat: the whole body
    if (slot === 'membrane') {
      const a = at as number;
      part = { gene, x: Math.cos(a), y: Math.sin(a), angle: a, scale: 1, group: 0 };
      const k = (segs ? animalRim(a, segs) : 1) * (whip ? 1.8 : 1.12);
      focus = { x: Math.cos(a) * k, y: Math.sin(a) * k };
      half = whip ? 1.4 : 0.8;
    } else if (slot === 'internal') {
      const [x, y] = at as readonly [number, number];
      part = { gene, x, y, angle: 0, scale: 1, group: 0 };
      focus = { x, y };
      half = 0.45;
    }
    iconCell.update({ x: 0, y: 0, heading: FORWARD, tumble: 0, spore: 0, cyst: 0 }, 1,
      { tier: lineage!.tier, genome: cat.withCopies(0, gene, 1), parts: part ? [part] : [], hue, shape: shownForm(), segments: segs, plan }, 0, 0);
    const f = deform(shownForm(), focus.x, focus.y);
    [iconCamera.left, iconCamera.right, iconCamera.top, iconCamera.bottom] = [-f.y - half, -f.y + half, f.x + half, f.x - half];
    iconCamera.updateProjectionMatrix();
    const clear = renderer.getClearColor(new THREE.Color());
    const clearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(iconTarget);
    renderer.clear();
    renderer.render(iconScene, iconCamera);
    renderer.setRenderTarget(null);
    renderer.setClearColor(clear, clearAlpha);
    renderer.readRenderTargetPixels(iconTarget, 0, 0, ICON_PX, ICON_PX, iconPixels);
    const image = iconContext.createImageData(ICON_PX, ICON_PX);
    for (let y = 0; y < ICON_PX; y++) {
      for (let x = 0; x < ICON_PX; x++) {
        const from = ((ICON_PX - 1 - y) * ICON_PX + x) * 4; // GL rows run bottom-up
        const to = (y * ICON_PX + x) * 4;
        const a = iconPixels[from + 3]! / 255;
        for (let c = 0; c < 3; c++) image.data[to + c] = a > 0 ? toSrgb(iconPixels[from + c]! / 255 / a) : 0; // un-premultiply
        image.data[to + 3] = iconPixels[from + 3]!;
      }
    }
    iconContext.putImageData(image, 0, 0);
    return iconCanvas.toDataURL();
  };

  /** Part tiles, rebuilt on opening and when the body plan changes (the other plan's parts aren't shown). */
  const buildPalette = () => {
    palette.replaceChildren(...cat.NAMES.filter((gene) => !animal() || fitsPlan(plan, cat.GENES[gene]!.bit)).map((gene) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'part';
      tile.dataset.gene = gene;
      const { label, slot, price } = cat.GENES[gene]!;
      if (!(lineage!.library & cat.GENES[gene]!.bit)) {
        tile.disabled = true;
        tile.classList.add('locked');
        tile.innerHTML = '<span class="q" aria-hidden="true">?</span>';
        tile.title = 'An undiscovered part: find its DNA';
        tile.setAttribute('aria-label', 'Undiscovered part');
        return tile;
      }
      icons.has(gene) || icons.set(gene, renderIcon(gene));
      tile.innerHTML = `<img src="${icons.get(gene)}" alt="" draggable="false"><span class="price">${price}</span><span class="pips"></span>`
        + (slot === 'coat' ? '<span class="coat">coat</span>' : '');
      tile.title = `${label} — ${price} DNA${slot === 'coat' ? ' (click to toggle)' : ' (drag onto the body, or click)'}`;
      tile.setAttribute('aria-label', `${label}, ${price} DNA`);
      return tile;
    }));
  };
  /** Plan icons for the tier being edited (built when the editor opens). */
  const buildPlans = () => {
    $('.plans').replaceChildren(...(PLANS_OF[lineage!.tier] ?? []).map((i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'icon';
      b.dataset.plan = String(i);
      b.innerHTML = PLAN_ICONS[i]!;
      b.title = b.ariaLabel = `Body plan: ${PLAN_NAMES[i]}`;
      b.addEventListener('click', () => {
        if (i === plan) return;
        plan = i;
        radii = [...DEFAULT_RADII_OF[i]!]; // each plan starts from its own body
        // Parts the new plan can't wear come off (refunded); the palette follows the plan.
        const kept = groups.filter((g) => fitsPlan(plan, cat.GENES[g.gene]!.bit));
        if (kept.length < groups.length) message = `Parts that don't fit a ${PLAN_NAMES[i]!.toLowerCase()} came off.`;
        groups = kept;
        icons = new Map(); // drawn on the new body
        buildPalette();
        render();
      });
      return b;
    }));
  };
  const swatches = $<HTMLElement>('.swatches');
  swatches.replaceChildren(...PIGMENTS.map((p, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.setAttribute('role', 'radio');
    b.style.setProperty('--c', `#${p.hex.toString(16).padStart(6, '0')}`);
    b.title = b.ariaLabel = p.name;
    b.addEventListener('click', () => { pigment = i; hue = hueOf(pigment, pattern); icons = new Map(); buildPalette(); render(); });
    return b;
  }));
  $('.patterns').replaceChildren(...PATTERN_NAMES.map((p, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon';
    b.setAttribute('role', 'radio');
    b.innerHTML = PATTERN_ICONS[i]!;
    b.title = b.ariaLabel = `Pattern: ${p}`;
    b.addEventListener('click', () => { pattern = i; hue = hueOf(pigment, pattern); render(); });
    return b;
  }));

  const render = () => {
    const gs = working();
    const genome = genomeOf(cat, gs);
    const left = lineage!.dna - cost(gs);
    for (const tile of palette.querySelectorAll<HTMLButtonElement>('.part:not(.locked)')) {
      const gene = tile.dataset.gene!;
      const { maxCopies } = cat.GENES[gene]!;
      const n = cat.copiesOf(genome, gene);
      tile.querySelector('.pips')!.textContent = '●'.repeat(n) + '○'.repeat(maxCopies - n);
      tile.classList.toggle('used', n > 0);
    }
    const spend = cost(gs);
    $('.dna b').textContent = String(Math.floor(left));
    $('.dna small').textContent = spend ? `${spend >= 0 ? 'spending' : 'refunding'} ${Math.abs(Math.round(spend))}` : '';
    $('.dna').classList.toggle('short', left < 0);
    const icon = CHILD_ICON[lineage!.tier] ?? CHILD_ICON[1];
    $('.eggs').innerHTML = Array.from({ length: lineage!.children + children },
      (_, k) => `<svg viewBox="0 0 16 16" class="${k >= lineage!.children ? 'new' : ''}" aria-hidden="true">${icon}</svg>`).join('');
    $('.kids').setAttribute('aria-label', `${lineage!.children} children in reserve, ${children} more`);
    $('.stats').textContent = `${placementsOf(gs).length}/${MAX_PARTS} parts · upkeep ${cat.upkeepOf(genome).toFixed(2)} energy/s`;
    $('.message').textContent = message;
    for (const [i, b] of [...swatches.children].entries()) b.setAttribute('aria-checked', String(i === pigment));
    for (const [i, b] of [...$('.patterns').children].entries()) b.setAttribute('aria-checked', String(i === pattern));
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-plan]')) b.setAttribute('aria-pressed', String(Number(b.dataset.plan) === plan));
    const sym = $<HTMLButtonElement>('.sym');
    sym.innerHTML = SYM_ICONS[symmetry];
    sym.title = sym.ariaLabel = `Symmetry: ${symmetry} (click to switch)`;
    const named = cleanName(name);
    if (!named && !message) $('.message').textContent = `Name: 2–${NAME_MAX} letters, spaces, hyphens or apostrophes.`;
    $<HTMLButtonElement>('.hatch').disabled = submitted || left < 0 || !named;
    // Animals mate and lay a clutch, tier 4 spins a cocoon; a species that just evolved hatches its first individual.
    $('.hatch').textContent = evolving ? 'Hatch' : lineage!.tier === 3 ? 'Lay eggs' : animal() ? 'Spin a cocoon' : 'Divide';
    const need = evolveDnaOf(lineage!.tier);
    const ready = lineage!.lifetimeDna >= need;
    const gauge = $<HTMLElement>('.evolution .gauge');
    (gauge.firstElementChild as HTMLElement).style.width = `${Number.isFinite(need) ? Math.min(100, (100 * lineage!.lifetimeDna) / need) : 0}%`;
    gauge.classList.toggle('ready', ready);
    gauge.title = `Lifetime DNA ${Math.floor(lineage!.lifetimeDna)} / ${need}`;
    evolveButton.disabled = submitted || left < 0 || !named || !ready;
    const next = TIER_NAMES[lineage!.tier + 1]?.toLowerCase();
    $<HTMLElement>('.evolution').hidden = lineage!.tier >= MAX_TIER || evolving;
    evolveButton.textContent = evolveArmed ? `Evolve to ${next}? Click again` : ready ? `Evolve to ${next}` : 'Evolve';
    // Keep the server's draft current (debounced), so the timer running out keeps these edits.
    clearTimeout(draftTimer);
    if (!submitted && left >= 0 && !drag && !sculpt && !resize && named) draftTimer = setTimeout(() => submit(design(), false), 250);
  };

  // Palette: press to drag a new part (a ghost of its icon follows the pointer until it is over the body); a press
  // released without dragging places it at its usual spot.
  palette.addEventListener('pointerdown', (e) => {
    const tile = (e.target as Element).closest<HTMLButtonElement>('.part:not(:disabled)');
    const gene = tile?.dataset.gene;
    if (!gene || cat.GENES[gene]!.slot === 'coat') return;
    drag = { gene };
    ghost.src = icons.get(gene) ?? '';
  });
  palette.addEventListener('click', (e) => {
    const gene = (e.target as Element).closest<HTMLButtonElement>('.part')?.dataset.gene;
    if (gene && !drag?.at) placeDefault(gene); // keyboard, or a click without a drag
    drag = undefined;
    ghost.hidden = true;
  });
  palette.addEventListener('pointerover', (e) => {
    const gene = (e.target as Element).closest<HTMLButtonElement>('.part:not(.locked)')?.dataset.gene;
    const g = gene && cat.GENES[gene];
    $('.part-info').textContent = g ? `${g.label} · ${g.price} DNA · upkeep ${g.upkeep} energy/s` : '';
  });
  const canvas = renderer.domElement;
  for (const [h, el] of Object.entries(handles) as ['nose' | 'side' | 'tail', HTMLElement][]) {
    el.addEventListener('pointerdown', (e) => {
      if (root.hidden || submitted) return;
      e.preventDefault();
      const s = shaped(e);
      sculpt = { h, d0: Math.hypot(s.x, s.y), radii0: [...radii] };
    });
  }
  const onDown = (e: PointerEvent) => {
    if (root.hidden) return;
    const { bx, by } = toBody(e);
    const i = pick(bx, by);
    if (i < 0) {
      // Not on a part: grab the animal segment under the pointer (the one whose edge is nearest) to thicken or slim it.
      const segs = animal() ? segments() : [];
      let best = -1;
      for (const [k, [x, y, r]] of segs.entries()) {
        const d = Math.hypot(bx - x, by - y);
        if (d < r * 1.15 && (best < 0 || Math.abs(d - r) < Math.abs(Math.hypot(bx - segs[best]![0], by - segs[best]![1]) - segs[best]![2]))) best = k;
      }
      if (best >= 0) {
        const [x, y] = segs[best]!;
        resize = { i: best, cx: x, cy: y, d0: Math.max(0.05, Math.hypot(bx - x, by - y)), radii0: [...radii] };
      }
      return;
    }
    const [group] = groups.splice(i, 1);
    if (e.button === 2) { // right click: remove
      render();
      return;
    }
    drag = { gene: group!.gene, group, at: group };
    render();
  };
  /** Where the dragged part would land under this pointer; off the body (undefined) means removal. */
  const dropAt = (e: PointerEvent, d: NonNullable<typeof drag>) => {
    const { bx, by } = toBody(e);
    const g = Math.hypot(bx, by) > 1.6 ? undefined : placeAt(cat, d.gene, bx, by, symmetry, available(d.gene));
    return g && { ...g, scale: d.group?.scale ?? 1 };
  };
  /** Sculpting: the nose stretches and bends a cell, the side thickens it; the tail adds or removes segments. */
  const onSculpt = (e: PointerEvent, s: NonNullable<typeof sculpt>) => {
    const p = shaped(e);
    if (s.h === 'nose') {
      const sx = clampTo(p.x / HANDLE_OUT, FORM_LIMITS.sx);
      const dx = HANDLE_OUT * sx;
      form = { ...form, sx, bend: clampTo(p.y / (dx * dx - BEND_CENTRE * sx * sx), FORM_LIMITS.bend) };
    } else if (s.h === 'side') {
      const lift = form.bend * (0 - BEND_CENTRE * form.sx * form.sx);
      form = { ...form, sy: clampTo((lift - p.y) / HANDLE_OUT, FORM_LIMITS.sy) };
    } else {
      // Out from the centre adds segments (a tapering tail), back in removes them.
      const steps = Math.round((Math.hypot(p.x, p.y) - s.d0) / SEGMENT_STEP);
      const n = Math.min(MAX_SEGMENTS, Math.max(MIN_SEGMENTS, s.radii0.length + steps));
      radii = s.radii0.slice(0, n);
      while (radii.length < n) radii.push(plan === 1 ? radii.at(-1)! : Math.max(SEGMENT_MIN, radii.at(-1)! * 0.85));
    }
    render();
  };
  const onMove = (e: PointerEvent) => {
    if (root.hidden) return;
    if (sculpt) return onSculpt(e, sculpt);
    if (resize) {
      // Measured from where the segment was when grabbed, so refitting the body can't feed back.
      const { bx, by } = toBody(e);
      const r0 = resize.radii0[resize.i]!;
      const r = Math.min(SEGMENT_MAX, Math.max(SEGMENT_MIN, r0 * Math.hypot(bx - resize.cx, by - resize.cy) / resize.d0));
      if (plan === 1) radii = resize.i > 0 ? radii.map((v, k) => (k > 0 ? r : v)) : radii.map((v, k) => (k === 0 ? r : v)); // lobes stay symmetric
      else {
        // Clay: the neighbours follow a little.
        radii = resize.radii0.map((v, k) => k === resize!.i ? r
          : Math.abs(k - resize!.i) === 1 ? Math.min(SEGMENT_MAX, Math.max(SEGMENT_MIN, v * (r / r0) ** FALLOFF)) : v);
      }
      render();
      return;
    }
    if (!drag) return;
    drag.at = dropAt(e, drag);
    // The part rides the pointer as a ghost until it is over the body (then the body shows it in place).
    ghost.hidden = !!drag.at || !!drag.group;
    ghost.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    render();
  };
  const onUp = (e: PointerEvent) => {
    if (sculpt || resize) {
      sculpt = resize = undefined;
      render(); // sends the draft
      return;
    }
    if (root.hidden || !drag) return;
    ghost.hidden = true;
    // From the release itself: at low frame rates the last pointermove may not have been seen yet.
    if (e.target === canvas) drag.at = dropAt(e, drag);
    if (e.target === canvas && drag.at) commit(drag.at);
    if (e.target === canvas || drag.group) drag = undefined; // palette releases are handled by its click
    render();
  };
  const onWheel = (e: WheelEvent) => {
    if (root.hidden) return;
    const { bx, by } = toBody(e);
    const g = groups[pick(bx, by)];
    if (!g) return;
    g.scale = Math.min(2, Math.max(0.5, g.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    render();
  };
  canvas.addEventListener('pointerdown', onDown);
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: true });

  $('.sym').addEventListener('click', () => { symmetry = symmetry === 'axial' ? 'radial' : 'axial'; render(); });
  $('.fewer').addEventListener('click', () => { children = Math.max(0, children - 1); render(); });
  $('.more').addEventListener('click', () => {
    if (lineage!.children + children >= MAX_CHILDREN) message = `At most ${MAX_CHILDREN} children in reserve.`;
    else if (cost(groups) + CHILD_PRICE > lineage!.dna) message = 'Not enough DNA.';
    else children++;
    render();
  });
  const design = (): Design => ({
    parts: placementsOf(groups), hue, shape, children, name: cleanName(name) ?? '',
    ...(animal() ? { plan, radii: [...radii] } : { form }),
  });
  const send = (evolve = false) => {
    if (submitted || !lineage || lineage.dna - cost(groups) < 0 || !cleanName(name)) return;
    submitted = true;
    clearTimeout(draftTimer);
    submit({ ...design(), evolve }, true);
    render();
  };
  $('.hatch').addEventListener('click', () => send());
  evolveButton.addEventListener('click', () => {
    if (evolveArmed) return send(true);
    evolveArmed = true;
    render();
  });
  nameInput.addEventListener('input', () => { name = nameInput.value; render(); });

  /** Put a handle at a point of the shaped frame (hidden when undefined). */
  const place = (el: HTMLElement, at: { x: number; y: number } | undefined) => {
    el.hidden = !at || submitted;
    if (!at) return;
    const { left, top } = toScreen(at.x, at.y);
    el.style.transform = `translate(${left}px, ${top}px)`;
  };

  return {
    get isOpen() { return !root.hidden; },
    /**
     * Open on the lineage's current design; `onSubmit` sends it to the server (final, or a draft).
     * `stageUp`: the species just evolved and designs its first individual of the new tier.
     */
    open(l: Lineage, onSubmit: (design: Design, final: boolean) => void, stageUp = false) {
      lineage = l;
      evolving = stageUp;
      cat = catalogFor(l.tier);
      groups = groupsOf(cat, l);
      children = 0;
      hue = l.hue;
      ({ pigment, pattern } = pigmentOf(hue));
      shape = l.shape;
      form = formOf(l);
      plan = l.plan;
      radii = l.radii.length ? [...l.radii] : [...(DEFAULT_RADII_OF[l.plan] ?? DEFAULT_RADII)];
      resize = sculpt = undefined;
      name = l.name;
      nameInput.value = name;
      evolveArmed = false;
      submitted = false;
      message = '';
      drag = undefined;
      ghost.hidden = true;
      submit = onSubmit;
      icons = new Map();
      root.hidden = false;
      buildPlans();
      buildPalette();
      render();
      $<HTMLButtonElement>('.hatch').focus();
    },
    close() { root.hidden = true; },
    refused(reason: string) {
      submitted = false;
      message = `The server refused this design: ${reason}.`;
      render();
    },
    /** Draw the preview; `secondsLeft` is the cyst timer (the server applies the last draft at 0). */
    frame(time: number, dt: number, secondsLeft: number, aspect: number) {
      const half = animal() ? ANIMAL_VIEW_HALF : VIEW_HALF;
      [camera.top, camera.bottom] = [half, -half];
      camera.left = -half * aspect;
      camera.right = half * aspect;
      camera.updateProjectionMatrix();
      const gs = working();
      const segs = segments();
      cell.update({ x: 0, y: 0, heading: FORWARD, tumble: 0, spore: 0, cyst: 0 }, 1,
        { tier: lineage!.tier, genome: genomeOf(cat, gs), parts: placementsOf(gs), hue, shape: shownForm(), segments: segs, plan }, time, dt);
      // Sculpting handles: a cell's nose and side; an animal's tail (the last segment's far edge).
      if (animal()) {
        const [x, y, r] = segs.at(-1)!;
        const d = Math.hypot(x, y) || 1;
        const tail = plan === 1 ? { x: x + (x / d) * r, y: y + (y / d) * r } : { x: x - r, y };
        place(handles.nose, undefined);
        place(handles.side, undefined);
        place(handles.tail, deform(shownForm(), tail.x, tail.y));
      } else {
        place(handles.nose, deform(form, HANDLE_OUT, 0));
        place(handles.side, deform(form, 0, -HANDLE_OUT));
        place(handles.tail, undefined);
      }
      const what = evolving ? `Evolved: design your first ${TIER_NAMES[lineage!.tier]!.toLowerCase()}`
        : animal() ? 'Design the next generation' : 'Dividing';
      $('.ed-timer').textContent = `${what} · ${Math.ceil(secondsLeft)} s`;
      return { scene, camera };
    },
  };
}
