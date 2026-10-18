import {
  CHILD_PRICE, CYST_TIME, evolveDnaOf, type Catalog, type Form, type Lineage, MAX_BEND, MAX_CHILDREN, MAX_PARTS, MAX_PLACED, MAX_TIER,
  NAME_MAX, type Placement, TIER_NAMES, catalogFor, cleanName, deform, undeform, DEFAULT_RADII, DEFAULT_RADII_OF, FORM_LIMITS,
  MAX_SEGMENTS, MIN_SEGMENTS, MAX_ARM, DEFAULT_ARMS, RADIAL_ARMS, PATTERN_NAMES, PIGMENTS, PLAN_NAMES, PLANS_OF, SEGMENT_MAX, SEGMENT_MIN, BEND_CENTRE, type Segment,
  animalRim, formOf, isAnimal, pigmentOf, segmentsOf, wrapAngle,
  hasBit, withBit,
} from '@panspermia/shared';
import * as THREE from 'three';
import { CHILD_ICON, molecule, setMolecule } from './hud.ts';
import { createCellView } from './scene/cells.ts';

// Spore-like species editor, open while your cell sits in its division cyst. One editor for every tier: the tier's
// part catalog (palette, prices, copies, slots, default spots) is picked when it opens.
// Parts: a grid of icons rendered from the parts' own shaders; drag one onto the body (membrane parts snap to the rim,
// internal ones float inside), or click it to place it at its usual spot; coats toggle. Drag a placed part to move it,
// off the body (or right-click) to remove it (refunded), wheel to resize.
// Symmetry follows the body (user direction: no symmetry buttons): cells and spine bodies are bilateral — off the axis a
// part is a mirrored pair, on it one; a radial body repeats a part on each of its 3–6 arms (at the centre, one). A
// placement is all its copies or nothing, every copy paid for, the effect stacking up to the part's maxCopies
// (MAX_PLACED copies at most).
// Sculpting, like clay, with colour-coded handles: length (amber) — a cell's nose stretches it, an animal's tail (a
// radial body: its front arm's tip) adds or removes stations; width (cyan) — a cell's side, an animal's side at each
// station (its neighbours follow a little); bend (magenta) — a cell's nose pulled sideways makes a comma, a spine or an
// arm turns at each station (an S, a spiral, a pinwheel); the head stays put while you bend. A radial body's arm
// count: the polygon buttons. Tiers 3 and 4 offer the same plans: a spine or a radial body.

type Symmetry = 'axial' | 'radial';
/** One placement as the player made it: a master part plus how it repeats. */
interface Group { gene: string; x: number; y: number; angle: number; scale: number; repeat: 'single' | 'axial' | 'radial'; n: number }
export interface Design {
  parts: Placement<string>[]; hue: number; shape: number; children: number; name: string; evolve?: boolean;
  /** A cell's sculpted shape. */
  form?: Form;
  plan?: number; radii?: number[]; bends?: number[]; arms?: number;
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
/** How far (body radii) the tail handle travels per station added or removed. */
const SEGMENT_STEP = 0.28;
/** How much a resized station's neighbours follow it (exponent of the size ratio): clay, not Lego. */
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
/** How many copies of a part the groups place. */
const placed = (groups: Group[], gene: string) => groups.reduce((n, g) => n + (g.gene === gene ? expand(g).length : 0), 0);
/** The genome a design expresses: each part's copies, its effect capped at maxCopies (as the server counts). */
const genomeOf = (cat: Catalog, groups: Group[]) => cat.NAMES.reduce((genome, gene) =>
  cat.withCopies(genome, gene, Math.min(placed(groups, gene), cat.GENES[gene]!.maxCopies)), 0);
/** DNA price of every copy placed. */
const priceOf = (cat: Catalog, groups: Group[]) => groups.reduce((sum, g) => sum + cat.GENES[g.gene]!.price * expand(g).length, 0);

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

/**
 * Where a part dropped at body-frame (bx, by) goes under the symmetry: all its copies, or why it can't (too few copies
 * of the part left for the pair or the n-fold ring).
 */
function placeAt(cat: Catalog, gene: string, bx: number, by: number, symmetry: Symmetry, n: number, available: number): Group | string {
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
    onAxis = symmetry === 'axial' ? Math.abs(y) < AXIS_SNAP : symmetry === 'radial' && r < AXIS_SNAP;
    if (onAxis && symmetry === 'axial') y = 0;
    if (onAxis && symmetry === 'radial') x = y = 0;
  }
  const copies = onAxis ? 1 : symmetry === 'axial' ? 2 : n;
  if (copies > available) {
    return available < 1 ? 'No more of that part fits.' : `This symmetry needs ${copies} copies: only ${available} more fit.`;
  }
  return { gene, x, y, angle, scale: 1, repeat: copies === 1 ? 'single' : symmetry, n: copies };
}

/** A pigment and pattern packed into the stored hue (pigmentOf unpacks it). */
const hueOf = (pigment: number, pattern: number) => (pigment + (pattern + 0.5) / PATTERN_NAMES.length) / PIGMENTS.length;
const clampTo = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));

/** The palette's sections (user direction: parts sorted by type), every tier's parts; a part missing here goes under Other. */
const GROUPS: readonly (readonly [string, readonly string[]])[] = [
  ['Feeding', ['transporters', 'siderophores', 'exoenzymes', 'thylakoid', 'adhesin', 'filter', 'jaw', 'pallium', 'peduncle', 'chloroplast', 'filterComb', 'mastax', 'stylet', 'proboscis',
    'mandible', 'maxillae', 'radula']],
  ['Locomotion', ['pili', 'flagellum', 'cilia', 'paddle', 'tail', 'oars', 'muscles', 'lobopods', 'legs', 'tailFan', 'foot', 'siphon']],
  ['Weapons', ['t6ss', 'spike', 'electric', 'claw', 'beak']],
  ['Active', ['bacteriocin', 'poreFormer', 'poison', 'trichocysts', 'nematocysts', 'endospore', 'jet', 'tun', 'inkSac']],
  ['Defence', ['capsule', 'thickWall', 'effluxPump', 'theca', 'carapace', 'spines', 'exoskeleton', 'shell', 'cerata']],
  ['Senses & metabolism', ['chemoreceptor', 'eye', 'antennae', 'mitochondrion', 'oil']],
];
/** What each part does, by tier, for the palette's tooltip (user direction: the effect on hover). */
const PART_INFO: Readonly<Record<number, Readonly<Record<string, string>>>> = {
  1: {
    pili: 'Twitching motility: slow, precise turns, and a grip against the current.',
    flagellum: 'Run-and-tumble swimming: fast, but it turns by tumbling. Each copy swims faster.',
    chemoreceptor: 'Senses the gradient: tumbles land closer to where you steer.',
    transporters: 'Takes up more of each dissolved mote. Each copy: +50 % more.',
    siderophores: 'Scavenges food further from the membrane: a wider reach.',
    exoenzymes: 'Digests debris and meat chunks: twice the food from them.',
    bacteriocin: 'Left click: a wide toxin cloud that harms other bacteria for a while.',
    poreFormer: 'Left click: a short, brutal toxin burst around you.',
    t6ss: 'A molecular syringe: stabs the cells you touch.',
    capsule: 'Slime coat: some phages can\'t bind to you. A little slower.',
    thickWall: 'A tough wall: toxins and stabs hurt less. Slower.',
    effluxPump: 'Pumps toxins back out: clouds hurt you less.',
    endospore: 'Right click: a dormant spore for 5 s — nothing can harm you.',
    thylakoid: 'Photosynthesis: makes energy from light.',
    adhesin: 'Parasite: cling to a bigger cell and drain its energy.',
  },
  2: {
    cilia: 'Rows of beating hairs: precise steering, quick turns. Each copy swims faster.',
    flagellum: 'A long whip: fast swimming, wide turns. Each copy swims faster.',
    filter: 'Mouth: plant food — motes, algae, filaments, spirulina. Each copy takes more of each.',
    jaw: 'Mouth: swallows cells up to half your mass, eats meat, bites bigger ones. Each copy takes more.',
    spike: 'Stabs whatever it points at.',
    poison: 'Left click: leaves a poison cloud behind you.',
    electric: 'Shocks everything touching you, all around.',
    jet: 'Right click: a burst of speed.',
    eye: 'See further: your view widens.',
    mitochondrion: 'Burns less energy, swims a little faster.',
    chloroplast: 'Makes energy from light.',
    peduncle: 'Parasite: pierces a bigger cell or an animal you touch and sucks it dry.',
    pallium: 'Mouth: wraps and digests prey up to 0.8× your mass (a jaw: 0.5×).',
    theca: 'Cellulose plates: bites do 30 % less. A little slower.',
    trichocysts: 'Left click: harpoon threads fired in front of you.',
  },
  3: {
    paddle: 'Rowing legs: precise steering. Each copy swims faster.',
    tail: 'A beating tail: fast swimming, wide turns. Each copy swims faster.',
    filterComb: 'Mouthpart: sieves plant food and sweeps up bacteria it touches.',
    mandible: 'Mouthpart: eats meat, swallows single cells it touches, bites rivals in front.',
    eye: 'See further: your view widens.',
    carapace: 'Armour: bites do 40 % less.',
    mastax: 'Grinding mouthpart: plant food, and 1.5× from big plants (diatoms, dinoflagellates).',
    stylet: 'Parasite: spears a bigger animal you touch and pumps it dry.',
    oars: 'Bristled limbs: jump-and-glide rowing, and they sieve small plant food.',
    muscles: 'A stronger swimming wave: +25 % speed per copy.',
    lobopods: 'Stubby clawed legs: a steady crawl, and bites knock you back far less.',
    nematocysts: 'Left click: stinging threads lash out all round your head.',
    spines: 'Too wide to swallow: only an eater 6× your mass can take you.',
    tun: 'Right click: dry out into a barrel for 4 s — nothing can harm you.',
    oil: 'Lipid store: burn 15 % less energy per copy.',
  },
  4: {
    legs: 'Walking legs: precise steering. Each copy walks faster.',
    tailFan: 'Flip away fast with a tail fan; wide turns.',
    claw: 'Predator: swallows plankton it touches, crushes rivals. Two claws crush harder.',
    maxillae: 'Grazing mouthparts: eat diatoms, dinoflagellates and seaweed.',
    exoskeleton: 'Chitin plates: bites do 45 % less. Slower.',
    foot: 'A muscular foot: glide steadily, held against the current.',
    siphon: 'Jet water through a siphon: fast, wide turns.',
    radula: 'A rasping tongue: grazes diatoms, dinoflagellates and seaweed.',
    beak: 'Predator: swallows plankton it touches, bites rivals.',
    shell: 'A shell: bites do 65 % less. Much slower.',
    eye: 'See further: your view widens.',
    inkSac: 'Right click: squirt an ink cloud and jet away — hunters can\'t see into it.',
    proboscis: 'Parasite: pierces another animal you touch and drains it.',
    cerata: 'Stolen stinging cells: whoever bites you takes 35 % back per copy.',
    antennae: 'Feel the water: your view widens.',
  },
};

/** The parts the player triggers, and with which button (as the game's input: toxins left, the rest right). */
const ACTIVE: Readonly<Record<string, 'left' | 'right'>> = {
  bacteriocin: 'left', poreFormer: 'left', poison: 'left', trichocysts: 'left', nematocysts: 'left', tun: 'right', endospore: 'right', jet: 'right', inkSac: 'right',
};
const MOUSE_ICON = '<svg viewBox="0 0 20 28" aria-hidden="true"><rect x="1" y="1" width="18" height="26" rx="9"/><path class="btn left" d="M10 1.5A8.5 8.5 0 0 0 1.5 10V12H10Z"/><path class="btn right" d="M10 1.5A8.5 8.5 0 0 1 18.5 10V12H10Z"/><path d="M1 12h18M10 1v11" class="line"/></svg>';

/** The design's stats: parts (a little grid of parts) and upkeep (an orange glucose ring, the energy they burn). */
const PARTS_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.5"/><rect x="9" y="1.5" width="5.5" height="5.5" rx="1.5"/><rect x="1.5" y="9" width="5.5" height="5.5" rx="1.5"/><rect x="9" y="9" width="5.5" height="5.5" rx="1.5" class="empty"/></svg>';
const UPKEEP_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5 12.8 5.2v5.6L8 13.5 3.2 10.8V5.2Z"/><circle cx="11.8" cy="4.6" r="1.3" class="o"/></svg>';
/** The DNA box's icon: a short double helix. */
const DNA_ICON = '<svg viewBox="0 0 16 28" aria-hidden="true"><path d="M3 2c0 6 10 6 10 12S3 20 3 26M13 2c0 6-10 6-10 12s10 6 10 12" class="strand"/><path d="M5 5h6M5 11h6M5 17h6M5 23h6" class="pair"/></svg>';
/** Space kept under the side columns for the handle legend (px). */
const LEGEND_ROOM = 40;

const svg = (body: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const PATTERN_ICONS = [
  svg('<circle cx="12" cy="12" r="8"/>'),
  svg('<circle cx="12" cy="12" r="8"/><circle cx="9" cy="10" r="1.6" class="ink"/><circle cx="14.5" cy="9" r="1.2" class="ink"/><circle cx="13" cy="15" r="1.7" class="ink"/><circle cx="8.5" cy="15" r="1" class="ink"/>'),
  svg('<circle cx="12" cy="12" r="8"/><path d="M6.5 8.5h11M4.5 12h15M6.5 15.5h11" class="line"/>'),
];
const PLAN_ICONS = [
  svg('<circle cx="12" cy="5.5" r="2.8"/><circle cx="12" cy="11.5" r="3.6"/><circle cx="12" cy="18" r="2.8"/>'), // spine
  svg('<circle cx="12" cy="12" r="3.6"/><circle cx="12" cy="5" r="2.4"/><circle cx="18.5" cy="14" r="2.4"/><circle cx="5.5" cy="14" r="2.4"/><circle cx="12" cy="19.5" r="2.4"/>'), // radial
];
/** A regular polygon icon: triangle, square, pentagon, hexagon. */
const polygon = (n: number) => svg(`<polygon points="${Array.from({ length: n }, (_, k) => {
  const a = -Math.PI / 2 + (2 * Math.PI * k) / n;
  return `${(12 + 8 * Math.cos(a)).toFixed(1)},${(12 + 8 * Math.sin(a)).toFixed(1)}`;
}).join(' ')}"/>`);

/** Linear light → sRGB byte (icons are read back from a linear render target). */
const toSrgb = (c: number) => Math.round(255 * Math.min(1, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));

/** A station's forward direction along a spine or the front arm (toward the head or the centre; the head: away from the next). */
function stationAxis(segs: readonly Segment[], i: number) {
  const [ax, ay] = i === 0 ? segs[0]! : segs[i - 1]!;
  const [bx, by] = i === 0 ? segs[1] ?? [segs[0]![0] - 1, segs[0]![1]] : segs[i]!;
  const d = Math.hypot(ax - bx, ay - by) || 1;
  return { x: (ax - bx) / d, y: (ay - by) / d };
}

export function createEditor(renderer: THREE.WebGLRenderer, root: HTMLElement) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e2340); // navy: the body and its handles stand out (user choice)
  // The backdrop (user direction): the pond as it was when the editor opened, extremely blurred and sunk into dark navy —
  // texture without competing with the body. A tiny canvas, blurred, then stretched over the view by the GPU.
  const backdrop = document.createElement('canvas');
  const backdropTexture = new THREE.CanvasTexture(backdrop);
  backdropTexture.colorSpace = THREE.SRGBColorSpace;
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
    <div class="ed-clock" role="timer">
      <div class="dial"><svg viewBox="0 0 40 40" aria-hidden="true"><circle class="track" cx="20" cy="20" r="16"/><circle class="left" cx="20" cy="20" r="16" pathLength="100"/></svg><b class="secs"></b></div>
      <small class="what"></small>
    </div>
    <div class="ed-dna" title="DNA to spend on this design">${DNA_ICON}<b class="dna-left"></b><span class="dna-spend"></span></div>
    <section class="panel" id="palette" aria-label="Parts">
      <h2>Parts</h2>
      <div class="clicks" aria-label="Active parts and their mouse buttons">${MOUSE_ICON}
        <div class="click left"><small>Left click</small><span></span></div>
        <div class="click right"><small>Right click</small><span></span></div>
      </div>
      <div class="part-groups"></div>

    </section>
    <div class="ed-side">
      <section class="panel" aria-label="Body and colour">
        <h2>Body</h2>
        <input type="text" class="name" aria-label="Species name" maxlength="${NAME_MAX}" autocomplete="off" spellcheck="false">
        <div class="ed-row swatches" role="radiogroup" aria-label="Pigment"></div>
        <div class="ed-row patterns" role="radiogroup" aria-label="Pattern"></div>
        <div class="ed-row plans"></div>
        <div class="ed-row radial-n" role="radiogroup" aria-label="Arms">${[3, 4, 5, 6].map((n) =>
          `<button type="button" class="icon" role="radio" data-n="${n}" title="${n} arms" aria-label="${n} arms">${polygon(n)}</button>`).join('')}</div>
        <p class="stats"></p>
      </section>
      <section class="panel" aria-label="Reproduction">
        <h2>Reproduction</h2>
        <div class="ed-row kids">
          <button type="button" class="icon fewer" aria-label="One child fewer">−</button>
          <span class="eggs"></span>
          <button type="button" class="icon more" aria-label="One child more (${CHILD_PRICE} DNA)">+</button>
        </div>
        <p class="kids-note" title="${CHILD_PRICE} DNA per child: each is a life in reserve"></p>
      </section>
      <section class="panel" aria-label="Next generation">
        <p class="message" role="status"></p>
        <button type="button" class="primary hatch">Divide</button>
        <div class="evolution">${molecule('dna', 'Evolution')}<button type="button" class="evolve">Evolve</button></div>
      </section>
    </div>
    <div class="handle h-length" data-h="nose" title="Length: drag up or down · bend: drag sideways"></div>
    <div class="handle h-width" data-h="side" title="Width: drag in or out"></div>
    <div class="handle h-length" data-h="tail" title="Length: drag out to add stations, in to remove them"></div>
    ${Array.from({ length: MAX_SEGMENTS }, (_, i) => `<div class="handle h-width small" data-w="${i}" title="Width: drag in or out"></div>`).join('')}
    ${Array.from({ length: MAX_SEGMENTS }, (_, i) => `<div class="handle h-bend small" data-b="${i}" title="Bend: drag sideways to turn the body here"></div>`).join('')}
    <div class="part-tip" role="tooltip" hidden></div>
    <img class="drag-ghost" alt="" hidden>
    <p class="ed-help"><span class="key h-length"></span> length <span class="key h-width"></span> width <span class="key h-bend"></span> bend</p>`;
  const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  // No scrollbars (user direction): each side column is scaled down (CSS zoom, which also scales its offset from the top)
  // until all of it fits above the legend. Measured once a frame at most, after the DOM changes of a render.
  let fitQueued = false;
  const queueFit = () => {
    if (fitQueued) return;
    fitQueued = true;
    requestAnimationFrame(() => {
      fitQueued = false;
      if (root.hidden) return;
      for (const el of [$<HTMLElement>('#palette'), $<HTMLElement>('.ed-side')]) {
        el.style.zoom = '1';
        const need = el.offsetTop + el.offsetHeight + LEGEND_ROOM;
        el.style.zoom = String(Math.min(1, innerHeight / need));
      }
    });
  };
  addEventListener('resize', queueFit);
  const palette = $<HTMLElement>('.part-groups');
  const nameInput = $<HTMLInputElement>('.name');
  const evolveButton = $<HTMLButtonElement>('.evolve');
  const ghost = $<HTMLImageElement>('.drag-ghost');
  const handles = { nose: $<HTMLElement>('[data-h="nose"]'), side: $<HTMLElement>('[data-h="side"]'), tail: $<HTMLElement>('[data-h="tail"]') };
  /** An animal's width handles (one per station, on its side) and bend handles (on the spine, from the third station). */
  const widths = [...root.querySelectorAll<HTMLElement>('[data-w]')];
  const benders = [...root.querySelectorAll<HTMLElement>('[data-b]')];
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
  /** The spine's (or every arm's) turn at each station (segmentsOf), as long as radii. */
  let bends: number[] = [];
  /** A radial body's arm count (0: a spine). */
  let arms = 0;
  /**
   * The view's centre in the shaped frame: bending recentres the body, so the view follows to keep the head where it
   * was grabbed, then drifts back to the centre once released.
   */
  let pan = { x: 0, y: 0 };
  let pigment = 0;
  let pattern = 0;
  /** The stored hue, kept exactly until the player picks a pigment or pattern. */
  let hue = 0;
  let icons = new Map<string, string>();
  /** A station being resized: its index, its centre and pointer distance when grabbed, every size then. */
  let resize: { i: number; cx: number; cy: number; d0: number; radii0: number[] } | undefined;
  /** A sculpting handle being dragged (the tail: the pointer's distance from the centre and the body when grabbed). */
  let sculpt: { h: 'nose' | 'side' | 'tail'; d0: number; radii0: number[]; bends0: number[] } | undefined;
  /** A bend handle being dragged: the station it moves, and the head and the view when grabbed. */
  let bending: { i: number; head: Segment; pan: { x: number; y: number } } | undefined;
  const animal = () => isAnimal(lineage?.tier ?? 1);
  const radialBody = () => animal() && plan === 1;
  const segments = () => segmentsOf(plan, radii, bends, radialBody() ? arms : 0);
  const symmetry = (): Symmetry => (radialBody() ? 'radial' : 'axial');
  const shownForm = (): Form | number => (animal() ? shape : form); // animals are sculpted by their stations
  let children = 0;
  let submitted = false;
  /** A part being dragged: a new one from the palette, or a placed group lifted off the body. */
  let drag: { gene: string; group?: Group; at?: Group } | undefined;
  let message = '';
  let submit: (design: Design, final: boolean) => void = () => {};
  let draftTimer: ReturnType<typeof setTimeout> | undefined;

  /** DNA this design costs: its copies minus the current design's (refunds), plus the children bought. */
  const cost = (gs: Group[]) => priceOf(cat, gs) - [...lineage!.parts].reduce((s, p) => s + cat.GENES[cat.NAMES[p.gene]!]!.price, 0)
    + children * CHILD_PRICE;
  const working = () => (drag?.at ? [...groups, drag.at] : groups);
  const available = (gene: string) => (cat.GENES[gene]!.slot === 'coat' ? 1 : MAX_PLACED) - placed(groups, gene);

  /** Re-place every part under the body's symmetry (a new plan or arm count); parts that no longer fit come off. */
  const resym = () => {
    const old = groups;
    groups = [];
    for (const g of old) {
      const next = cat.GENES[g.gene]!.slot === 'coat' ? g : placeAt(cat, g.gene, g.x, g.y, symmetry(), arms, available(g.gene));
      if (typeof next === 'string' || placementsOf([...groups, next]).length > MAX_PARTS) {
        message = 'Some parts came off: too many copies for this body.';
        continue;
      }
      groups.push({ ...next, scale: g.scale });
    }
  };

  /** The body's shaped frame (cell radii, x forward = up the screen) under a pointer. */
  const shaped = (e: { clientX: number; clientY: number }) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const wx = ((e.clientX - rect.left) / rect.width * 2 - 1) * camera.right;
    const wy = -((e.clientY - rect.top) / rect.height * 2 - 1) * camera.top;
    return { x: wy + pan.x, y: -wx + pan.y }; // rotate the screen by -FORWARD
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
    return { left: rect.left + (-(y - pan.y) / camera.right + 1) / 2 * rect.width, top: rect.top + (1 - (x - pan.x) / camera.top) / 2 * rect.height };
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
  const commit = (g: Group | string) => {
    if (typeof g === 'string') return void (message = g);
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
    } else if (slot === 'membrane') commit(placeAt(cat, gene, Math.cos(at as number), Math.sin(at as number), symmetry(), arms, available(gene)));
    else commit(placeAt(cat, gene, ...(at as readonly [number, number]), symmetry(), arms, available(gene)));
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

  /** Part tiles, rebuilt on opening and when the body changes (icons are drawn on it). */
  /** The library the palette was built for: a part found while the editor is open (dev unlocks) rebuilds it. */
  let builtLibrary = -1;
  const buildPalette = () => {
    builtLibrary = lineage!.library;
    const listed = new Set(GROUPS.flatMap(([, genes]) => genes));
    const sections = [...GROUPS, ['Other', cat.NAMES.filter((g) => !listed.has(g))] as const]
      .map(([title, genes]) => [title, genes.filter((g) => g in cat.GENES)] as const)
      .filter(([, genes]) => genes.length);
    palette.replaceChildren(...sections.map(([title, genes]) => {
      const section = document.createElement('section');
      section.className = 'part-group';
      const grid = document.createElement('div');
      grid.className = 'parts';
      grid.append(...genes.map(tileOf));
      section.append(Object.assign(document.createElement('h3'), { textContent: title }), grid);
      return section;
    }));
  };
  /** One part tile: its icon, price, copy pips, coat or mouse-button badge; a "?" while undiscovered. */
  const tileOf = (gene: string) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'part';
    tile.dataset.gene = gene;
    const { label, slot, price, maxCopies } = cat.GENES[gene]!;
    if (!hasBit(lineage!.library, cat.GENES[gene]!.bit)) {
      tile.disabled = true;
      tile.classList.add('locked');
      tile.innerHTML = '<span class="q" aria-hidden="true">?</span>';
      tile.title = 'An undiscovered part: find its DNA';
      tile.setAttribute('aria-label', 'Undiscovered part');
      return tile;
    }
    icons.has(gene) || icons.set(gene, renderIcon(gene));
    const button = ACTIVE[gene];
    tile.innerHTML = `<img src="${icons.get(gene)}" alt="" draggable="false"><span class="price">${price}</span><span class="pips"></span>`
      + (slot === 'coat' ? '<span class="coat">coat</span>' : '')
      + (button ? `<span class="click-badge" title="${button} click">${button === 'left' ? 'L' : 'R'}</span>` : '');
    tile.setAttribute('aria-label', `${label}, ${price} DNA a copy: ${PART_INFO[lineage!.tier]?.[gene] ?? ''}`);
    return tile;
  };
  /** Plan icons for an animal tier: a spine or a radial body (tiers 3 and 4 alike: user direction). */
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
        bends = radii.map(() => 0);
        arms = i === 1 ? DEFAULT_ARMS : 0;
        message = '';
        resym();
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
  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-n]')) {
    b.addEventListener('click', () => {
      arms = Number(b.dataset.n);
      message = '';
      resym();
      icons = new Map(); // drawn on the new body
      buildPalette();
      render();
    });
  }

  const render = () => {
    const gs = working();
    const genome = genomeOf(cat, gs);
    const left = lineage!.dna - cost(gs);
    for (const tile of palette.querySelectorAll<HTMLButtonElement>('.part:not(.locked)')) {
      const gene = tile.dataset.gene!;
      const { maxCopies } = cat.GENES[gene]!;
      const n = placed(gs, gene);
      const effective = Math.min(n, maxCopies);
      tile.querySelector('.pips')!.textContent = '●'.repeat(effective) + '○'.repeat(maxCopies - effective) + (n > maxCopies ? ` +${n - maxCopies}` : '');
      tile.classList.toggle('used', n > 0);
    }
    for (const button of ['left', 'right'] as const) {
      const names = cat.NAMES.filter((g) => ACTIVE[g] === button && placed(gs, g) > 0).map((g) => cat.GENES[g]!.label);
      $(`.click.${button} span`).textContent = names.join(', ') || '—';
      $('.clicks').classList.toggle(`has-${button}`, names.length > 0);
    }
    const spend = cost(gs);
    $('.dna-left').textContent = String(Math.floor(left));
    const spent = Math.round(spend);
    $('.dna-spend').textContent = spent > 0 ? `−${spent}` : spent < 0 ? `+${-spent}` : '';
    $('.dna-spend').classList.toggle('refund', spent < 0);
    $('.ed-dna').classList.toggle('short', left < 0);
    queueFit();
    const icon = CHILD_ICON[lineage!.tier] ?? CHILD_ICON[1];
    $('.eggs').innerHTML = Array.from({ length: lineage!.children + children },
      (_, k) => `<svg viewBox="0 0 16 16" class="${k >= lineage!.children ? 'new' : ''}" aria-hidden="true">${icon}</svg>`).join('');
    $('.kids').setAttribute('aria-label', `${lineage!.children} children in reserve, ${children} more`);
    // Parts used and the energy they burn, as two icon chips.
    const used = placementsOf(gs).length;
    $('.stats').innerHTML = `<span class="stat${used >= MAX_PARTS ? ' full' : ''}" title="Parts placed, of ${MAX_PARTS}">${PARTS_ICON}<b>${used}</b>/${MAX_PARTS}</span>`
      + `<span class="stat upkeep" title="Upkeep: energy the parts burn each second">${UPKEEP_ICON}<b>−${cat.upkeepOf(genome).toFixed(2)}</b>/s</span>`;
    $('.kids-note').innerHTML = `Children: <b class="${children ? 'cost' : ''}">−${children * CHILD_PRICE}</b> DNA`;
    $('.message').textContent = message;
    for (const [i, b] of [...swatches.children].entries()) b.setAttribute('aria-checked', String(i === pigment));
    for (const [i, b] of [...$('.patterns').children].entries()) b.setAttribute('aria-checked', String(i === pattern));
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-n]')) b.setAttribute('aria-checked', String(Number(b.dataset.n) === arms));
    $<HTMLElement>('.radial-n').hidden = !radialBody();
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-plan]')) b.setAttribute('aria-pressed', String(Number(b.dataset.plan) === plan));
    const named = cleanName(name);
    if (!named && !message) $('.message').textContent = `Name: 2–${NAME_MAX} letters, spaces, hyphens or apostrophes.`;
    $<HTMLButtonElement>('.hatch').disabled = submitted || left < 0 || !named;
    // Plankton mate and lay a clutch, animals spin a cocoon; a species that just evolved hatches its first individual.
    $('.hatch').textContent = evolving ? 'Hatch' : lineage!.tier === 3 ? 'Lay eggs' : animal() ? 'Spin a cocoon' : 'Divide';
    const need = evolveDnaOf(lineage!.tier);
    const ready = lineage!.lifetimeDna >= need;
    const gauge = root.querySelector('.evolution .molecule')!;
    setMolecule(gauge, Number.isFinite(need) ? (100 * lineage!.lifetimeDna) / need : 0);
    gauge.classList.toggle('ready', ready);
    gauge.setAttribute('aria-label', `Lifetime DNA ${Math.floor(lineage!.lifetimeDna)} / ${need}`);
    evolveButton.disabled = submitted || left < 0 || !named || !ready;
    const next = TIER_NAMES[lineage!.tier + 1]?.toLowerCase();
    $<HTMLElement>('.evolution').hidden = lineage!.tier >= MAX_TIER || evolving;
    evolveButton.textContent = evolveArmed ? `Evolve to ${next}? Click again` : ready ? `Evolve to ${next}` : 'Evolve';
    // Keep the server's draft current (debounced), so the timer running out keeps these edits.
    clearTimeout(draftTimer);
    if (!submitted && left >= 0 && !drag && !sculpt && !resize && bending === undefined && named) {
      draftTimer = setTimeout(() => submit(design(), false), 250);
    }
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
  // The tooltip: a card beside the hovered tile — the part, what it does, its cost, upkeep, stacking and button.
  const tip = $<HTMLElement>('.part-tip');
  palette.addEventListener('pointerover', (e) => {
    const tile = (e.target as Element).closest<HTMLButtonElement>('.part');
    const gene = tile?.dataset.gene;
    const g = gene && cat.GENES[gene];
    if (!tile || !g || tile.classList.contains('locked')) {
      tip.hidden = true;
      return;
    }
    const button = ACTIVE[gene];
    tip.innerHTML = `<strong></strong><p></p><div class="tip-row"><span class="tip-dna">${DNA_ICON}${g.price}<small>/copy</small></span>`
      + `<span class="tip-upkeep">${UPKEEP_ICON}−${g.upkeep}<small>/s</small></span>`
      + `<span class="tip-copies">${g.slot === 'coat' ? 'coat' : `stacks ×${g.maxCopies}`}</span>`
      + (button ? `<span class="click-badge">${button === 'left' ? 'L' : 'R'}</span>` : '') + '</div>';
    tip.querySelector('strong')!.textContent = g.label;
    tip.querySelector('p')!.textContent = PART_INFO[lineage!.tier]?.[gene] ?? '';
    const box = tile.getBoundingClientRect();
    tip.style.transform = `translate(${Math.round(box.right + 10)}px, ${Math.round(box.top)}px)`;
    tip.hidden = false;
  });
  palette.addEventListener('pointerleave', () => { tip.hidden = true; });
  const canvas = renderer.domElement;
  const grab = (el: HTMLElement, start: (e: PointerEvent) => void) => el.addEventListener('pointerdown', (e) => {
    if (root.hidden || submitted) return;
    e.preventDefault();
    start(e);
  });
  for (const [h, el] of Object.entries(handles) as ['nose' | 'side' | 'tail', HTMLElement][]) {
    grab(el, (e) => {
      const s = shaped(e);
      sculpt = { h, d0: Math.hypot(s.x, s.y), radii0: [...radii], bends0: [...bends] };
    });
  }
  for (const [i, el] of widths.entries()) {
    grab(el, (e) => {
      const [x, y] = segments()[i]!;
      const { bx, by } = toBody(e);
      resize = { i, cx: x, cy: y, d0: Math.max(0.05, Math.hypot(bx - x, by - y)), radii0: [...radii] };
    });
  }
  for (const [i, el] of benders.entries()) grab(el, () => { bending = { i, head: segments()[0]!, pan: { ...pan } }; });
  const onDown = (e: PointerEvent) => {
    if (root.hidden) return;
    const { bx, by } = toBody(e);
    const i = pick(bx, by);
    if (i < 0) return;
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
    if (Math.hypot(bx, by) > 1.6) return undefined;
    // A moved group keeps its own copies (they were already placed): only new ones must fit.
    const g = placeAt(cat, d.gene, bx, by, symmetry(), arms, available(d.gene));
    if (typeof g === 'string') {
      message = g;
      return undefined;
    }
    return { ...g, scale: d.group?.scale ?? 1 };
  };
  /** Sculpting: a cell's nose stretches and bends it, its side thickens it; an animal's tail adds or removes stations. */
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
      // Out from the centre adds stations (a tapering tail or arms, carrying on their curl), back in removes them.
      const steps = Math.round((Math.hypot(p.x, p.y) - s.d0) / SEGMENT_STEP);
      const n = Math.min(radialBody() ? 1 + MAX_ARM : MAX_SEGMENTS, Math.max(MIN_SEGMENTS, s.radii0.length + steps));
      radii = s.radii0.slice(0, n);
      bends = s.bends0.slice(0, n);
      while (radii.length < n) radii.push(Math.max(SEGMENT_MIN, radii.at(-1)! * 0.85));
      while (bends.length < n) bends.push(bends.length > 1 ? bends.at(-1)! : 0);
    }
    render();
  };
  /** Bending: turn the spine (or the front arm) at the station before this one so that this one moves toward the pointer. */
  const onBend = (e: PointerEvent, b: NonNullable<typeof bending>) => {
    const { i } = b;
    const segs = segments();
    const { bx, by } = toBody(e);
    const [px, py] = segs[i - 1]!;
    // The link leaving station i - 1 points back (a spine) or out along the front arm, plus the turns before it; its
    // bend makes up the rest.
    const before = (radialBody() ? 0 : Math.PI) + bends.slice(1, i - 1).reduce((a, t) => a + t, 0);
    while (bends.length < radii.length) bends.push(0);
    bends[i - 1] = Math.max(-MAX_BEND, Math.min(MAX_BEND, wrapAngle(Math.atan2(by - py, bx - px) - before)));
    // The body is recentred around its new shape: the view moves with it, so the head stays where it was on screen.
    const [hx, hy] = segments()[0]!;
    pan = { x: b.pan.x + hx - b.head[0], y: b.pan.y + hy - b.head[1] };
    render();
  };
  const onMove = (e: PointerEvent) => {
    if (root.hidden) return;
    if (sculpt) return onSculpt(e, sculpt);
    if (bending !== undefined) return onBend(e, bending);
    if (resize) {
      // Measured from where the station was when grabbed, so refitting the body can't feed back.
      const { bx, by } = toBody(e);
      const r0 = resize.radii0[resize.i]!;
      const r = Math.min(SEGMENT_MAX, Math.max(SEGMENT_MIN, r0 * Math.hypot(bx - resize.cx, by - resize.cy) / resize.d0));
      // Clay: the neighbours follow a little (a radial body: the same station on every arm).
      radii = resize.radii0.map((v, k) => k === resize!.i ? r
        : Math.abs(k - resize!.i) === 1 ? Math.min(SEGMENT_MAX, Math.max(SEGMENT_MIN, v * (r / r0) ** FALLOFF)) : v);
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
    if (sculpt || resize || bending !== undefined) {
      sculpt = resize = bending = undefined;
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

  $('.fewer').addEventListener('click', () => { children = Math.max(0, children - 1); render(); });
  $('.more').addEventListener('click', () => {
    if (lineage!.children + children >= MAX_CHILDREN) message = `At most ${MAX_CHILDREN} children in reserve.`;
    else if (cost(groups) + CHILD_PRICE > lineage!.dna) message = 'Not enough DNA.';
    else children++;
    render();
  });
  const design = (): Design => ({
    parts: placementsOf(groups), hue, shape, children, name: cleanName(name) ?? '',
    ...(animal() ? { plan, radii: [...radii], bends: bends.slice(0, radii.length), arms } : { form }),
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
    /** A part's icon for a lineage, drawn as in the palette (the unlock card); undefined while the editor is open. */
    partIcon(l: Lineage, gene: string) {
      if (!root.hidden) return undefined;
      lineage = l;
      cat = catalogFor(l.tier);
      ({ hue, shape } = l);
      form = formOf(l);
      plan = PLANS_OF[l.tier]?.includes(l.plan) ? l.plan : PLANS_OF[l.tier]?.[0] ?? 0;
      radii = l.radii.length ? [...l.radii] : [...(DEFAULT_RADII_OF[plan] ?? DEFAULT_RADII)];
      arms = plan === 1 ? l.arms || DEFAULT_ARMS : 0;
      bends = radii.map((_, i) => l.bends[i] ?? 0);
      return renderIcon(gene);
    },
    /** Take the backdrop from a just-rendered game frame (call in the same task as the render). */
    backdrop(source: HTMLCanvasElement) {
      const w = 160;
      const h = Math.max(1, Math.round((w * source.height) / source.width));
      Object.assign(backdrop, { width: w, height: h });
      const g = backdrop.getContext('2d')!;
      g.filter = 'blur(5px)';
      g.drawImage(source, -12, -12, w + 24, h + 24); // overscan: the blur doesn't darken the edges
      g.filter = 'none';
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = '#3c6cb0'; // into navy
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = 'rgb(9 24 52 / 0.35)'; // and darker
      g.fillRect(0, 0, w, h);
      backdropTexture.needsUpdate = true;
      scene.background = backdropTexture;
    },
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
      plan = PLANS_OF[l.tier]?.includes(l.plan) ? l.plan : PLANS_OF[l.tier]?.[0] ?? l.plan; // older tier-4 plans: a spine
      radii = l.radii.length ? [...l.radii] : [...(DEFAULT_RADII_OF[l.plan] ?? DEFAULT_RADII)];
      arms = l.plan === 1 ? l.arms : 0;
      if (l.plan === 1 && !arms) { // the older lobes format: one-station arms
        arms = Math.min(RADIAL_ARMS[1], Math.max(RADIAL_ARMS[0], radii.length - 1));
        radii = radii.slice(0, 2);
      }
      bends = radii.map((_, i) => l.bends[i] ?? 0);
      pan = { x: 0, y: 0 };
      resize = sculpt = bending = undefined;
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
      if (lineage!.library !== builtLibrary) {
        buildPalette();
        render();
      }
      const half = animal() ? ANIMAL_VIEW_HALF : VIEW_HALF;
      [camera.top, camera.bottom] = [half, -half];
      camera.left = -half * aspect;
      camera.right = half * aspect;
      camera.updateProjectionMatrix();
      if (!bending) pan = { x: pan.x * Math.exp(-3 * dt), y: pan.y * Math.exp(-3 * dt) }; // drift back once released
      camera.position.set(-pan.y, pan.x, 0);
      const gs = working();
      const segs = segments();
      cell.update({ x: 0, y: 0, heading: FORWARD, tumble: 0, spore: 0, cyst: 0 }, 1,
        { tier: lineage!.tier, genome: genomeOf(cat, gs), parts: placementsOf(gs), hue, shape: shownForm(), segments: segs, plan }, time, dt);
      // Sculpting handles: a cell's nose and side; an animal's tail (a radial body: its front arm's tip), a width handle
      // on each station's right side and a bend handle from the third station. A radial body's front arm holds stations
      // 1… right after the centre, the same indices as its radii, as a spine's do.
      const f = shownForm();
      if (animal()) {
        const last = radii.length - 1;
        const [x, y, r] = segs[last]!;
        const ax = stationAxis(segs, last);
        place(handles.nose, undefined);
        place(handles.side, undefined);
        place(handles.tail, deform(f, x - ax.x * r, y - ax.y * r));
        for (const [i, el] of widths.entries()) {
          const st = i < radii.length ? segs[i] : undefined;
          if (!st) {
            place(el, undefined);
            continue;
          }
          const [sx, sy, sr] = st;
          const a = stationAxis(segs, i);
          place(el, deform(f, sx + a.y * sr, sy - a.x * sr)); // its right side
        }
        for (const [i, el] of benders.entries()) {
          const st = i >= 2 && i < radii.length ? segs[i] : undefined;
          place(el, st && deform(f, st[0], st[1]));
        }
      } else {
        place(handles.nose, deform(form, HANDLE_OUT, 0));
        place(handles.side, deform(form, 0, -HANDLE_OUT));
        place(handles.tail, undefined);
        for (const el of [...widths, ...benders]) place(el, undefined);
      }
      // The clock: a ring that empties over the editor's time.
      const secs = Math.max(0, Math.ceil(secondsLeft));
      $<SVGCircleElement>('.ed-clock .left').style.strokeDashoffset = String(100 - (100 * Math.max(0, secondsLeft)) / CYST_TIME);
      $('.ed-clock .secs').textContent = `${secs}`;
      $('.ed-clock').classList.toggle('late', secs <= 10);
      $('.ed-clock .what').textContent = evolving ? `Evolved: your first ${TIER_NAMES[lineage!.tier]!.toLowerCase()}`
        : animal() ? 'Next generation' : 'Dividing';
      return { scene, camera };
    },
  };
}
