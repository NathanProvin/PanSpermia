import {
  CHILD_PRICE, GENES, GENE_NAMES, type Gene, type Lineage, MAX_CHILDREN, MAX_PARTS, type Placement, copiesOf, priceOf,
  upkeepOf, withCopies,
} from '@panspermia/shared';
import * as THREE from 'three';
import { createCellView } from './scene/cells.ts';

// Spore-like cell editor, open while your cell sits in its division cyst. Drag parts from the palette
// onto the body (membrane parts snap to the rim, internal ones float inside, coats toggle), drag
// placed parts to move them, drag off the body or right-click to remove (refunded), wheel to resize.
// Symmetry: axial mirrors across the forward axis, radial repeats around the centre; a placement on
// the axis (or at the centre) stays a single copy. Children are bought at a fixed price.

type Symmetry = 'axial' | 'radial';
/** One placement as the player made it: a master part plus how it repeats. */
interface Group { gene: Gene; x: number; y: number; angle: number; scale: number; repeat: 'single' | 'axial' | 'radial'; n: number }
export interface Design { parts: Placement[]; hue: number; children: number }

const VIEW_HALF = 2.4; // cell radii visible above and below the centre
const AXIS_SNAP = 0.12; // radii: this close to the axis (or the centre) is "on" it
const PICK = 0.3; // radii: grab distance for placed parts
const INTERIOR = 0.6; // internal parts stay this far inside
const FORWARD = Math.PI / 2; // the editor shows the cell swimming up the screen

/** Every copy a group stands for, in the body frame (x forward, y left). */
function expand(g: Group): Omit<Placement, 'group'>[] {
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
const genomeOf = (groups: Group[]) =>
  groups.reduce((genome, g) => withCopies(genome, g.gene, copiesOf(genome, g.gene) + expand(g).length), 0);

/** Rebuild the player's groups from a saved design (parts sharing a group number came from one placement). */
function groupsOf(lineage: Lineage): Group[] {
  const byGroup = new Map<number, Placement[]>();
  for (const p of lineage.parts) {
    const part = { gene: GENE_NAMES[p.gene]!, x: p.x, y: p.y, angle: p.angle, scale: p.scale, group: p.group };
    byGroup.set(p.group, [...(byGroup.get(p.group) ?? []), part]);
  }
  return [...byGroup.values()].map(([master, ...copies]) => ({
    ...master!,
    repeat: copies.length === 0 ? 'single' : copies.length === 1 && Math.abs(copies[0]!.y + master!.y) < 1e-3 ? 'axial' : 'radial',
    n: copies.length + 1,
  }));
}

/** Where a part dropped at body-frame (bx, by) goes, given the symmetry and the copies still allowed. */
function placeAt(gene: Gene, bx: number, by: number, symmetry: Symmetry, available: number): Group | undefined {
  if (available < 1) return undefined;
  let x: number;
  let y: number;
  let angle = 0;
  let onAxis: boolean;
  if (GENES[gene].slot === 'membrane') {
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

export function createEditor(renderer: THREE.WebGLRenderer, root: HTMLElement) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x041c24);
  const camera = new THREE.OrthographicCamera(-1, 1, VIEW_HALF, -VIEW_HALF, -10, 10);
  const cell = createCellView(scene, 0.42);

  root.innerHTML = `
    <section class="panel" id="palette" aria-label="Parts"><h2>Parts</h2><div class="parts"></div></section>
    <section class="panel" id="editor-side" aria-label="Design">
      <p class="timer" role="timer"></p>
      <p class="dna"></p>
      <fieldset><legend>Symmetry</legend>
        <button type="button" data-sym="axial" aria-pressed="true">Axial</button>
        <button type="button" data-sym="radial" aria-pressed="false">Radial</button>
      </fieldset>
      <label>Colour <input type="range" class="hue" min="0" max="0.999" step="0.001"></label>
      <fieldset><legend>Children <small>(${CHILD_PRICE} DNA each)</small></legend>
        <button type="button" class="fewer" aria-label="One child fewer">−</button>
        <output class="children"></output>
        <button type="button" class="more" aria-label="One child more">+</button>
      </fieldset>
      <p class="stats"></p>
      <p class="message" role="status"></p>
      <button type="button" class="hatch">Divide</button>
    </section>`;
  const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const palette = $<HTMLElement>('.parts');
  const hueInput = $<HTMLInputElement>('.hue');

  let lineage: Lineage | undefined;
  let groups: Group[] = [];
  let children = 0;
  let hue = 0;
  let symmetry: Symmetry = 'axial';
  let submitted = false;
  /** A part being dragged: a new one from the palette, or a placed group lifted off the body. */
  let drag: { gene: Gene; group?: Group; at?: Group } | undefined;
  let message = '';
  let submit: (design: Design, final: boolean) => void = () => {};
  let draftTimer = 0;

  const cost = (gs: Group[]) => priceOf(genomeOf(gs)) - priceOf(lineage!.genome) + children * CHILD_PRICE;
  const working = () => (drag?.at ? [...groups, drag.at] : groups);
  const available = (gene: Gene) => GENES[gene].maxCopies - copiesOf(genomeOf(groups), gene);

  /** Body-frame coordinates (cell radii, x forward) under a pointer event. */
  const toBody = (e: PointerEvent | WheelEvent) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const wx = ((e.clientX - rect.left) / rect.width * 2 - 1) * camera.right;
    const wy = -((e.clientY - rect.top) / rect.height * 2 - 1) * VIEW_HALF;
    return { bx: wy, by: -wx }; // rotate the screen by -FORWARD
  };
  const pick = (bx: number, by: number) => {
    let best = -1;
    let bestD = PICK;
    for (const [i, g] of groups.entries()) {
      if (GENES[g.gene].slot === 'coat') continue; // coats are toggled from the palette
      for (const p of expand(g)) {
        const d = Math.hypot(p.x - bx, p.y - by);
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
  const placeDefault = (gene: Gene) => {
    const { slot, at } = GENES[gene];
    if (slot === 'coat') {
      const i = groups.findIndex((g) => g.gene === gene);
      if (i >= 0) groups.splice(i, 1);
      else commit({ gene, x: 0, y: 0, angle: 0, scale: 1, repeat: 'single', n: 1 });
    } else if (slot === 'membrane') commit(placeAt(gene, Math.cos(at as number), Math.sin(at as number), symmetry, available(gene)));
    else commit(placeAt(gene, ...(at as readonly [number, number]), symmetry, available(gene)));
    render();
  };

  /** Palette buttons are built once per opening (the library only grows between divisions). */
  const buildPalette = () => {
    palette.replaceChildren(...GENE_NAMES.map((gene) => {
      const button = document.createElement('button');
      button.type = 'button';
      const unlocked = (lineage!.library & GENES[gene].bit) !== 0;
      button.disabled = !unlocked;
      button.dataset.gene = gene;
      const { label, slot } = GENES[gene];
      button.innerHTML = unlocked ? `<span>${label}</span><small></small>` : '<span>???</span><small>find its DNA</small>';
      if (unlocked) button.title = slot === 'coat' ? 'Click to toggle' : 'Drag onto the cell, or click to place';
      return button;
    }));
  };
  const render = () => {
    const gs = working();
    const genome = genomeOf(gs);
    const left = lineage!.dna - cost(gs);
    for (const button of palette.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')) {
      const gene = button.dataset.gene as Gene;
      const { price, maxCopies, slot } = GENES[gene];
      button.querySelector('small')!.textContent = `${price} DNA · ${copiesOf(genome, gene)}/${maxCopies}${slot === 'coat' ? ' · coat' : ''}`;
    }
    const spend = cost(gs);
    $('.dna').textContent = `DNA ${Math.floor(left)} left (${spend >= 0 ? 'spending' : 'refunding'} ${Math.abs(Math.round(spend))})`;
    $('.dna').classList.toggle('short', left < 0);
    $('.children').textContent = `${lineage!.children} + ${children}`;
    $('.stats').textContent = `${placementsOf(gs).length}/${MAX_PARTS} parts · upkeep ${upkeepOf(genome).toFixed(3)} mass/s`;
    $('.message').textContent = message;
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-sym]')) b.setAttribute('aria-pressed', String(b.dataset.sym === symmetry));
    $<HTMLButtonElement>('.hatch').disabled = submitted || left < 0;
    // Keep the server's draft current (debounced), so the timer running out keeps these edits.
    clearTimeout(draftTimer);
    if (!submitted && left >= 0 && !drag) draftTimer = setTimeout(() => submit({ parts: placementsOf(groups), hue, children }, false), 250);
  };

  // Palette: press to drag a new part; a press released without dragging places it at its default spot.
  palette.addEventListener('pointerdown', (e) => {
    const gene = (e.target as Element).closest<HTMLButtonElement>('button:not(:disabled)')?.dataset.gene as Gene | undefined;
    if (gene && GENES[gene].slot !== 'coat') drag = { gene };
  });
  palette.addEventListener('click', (e) => {
    const gene = (e.target as Element).closest<HTMLButtonElement>('button')?.dataset.gene as Gene | undefined;
    if (gene && !drag?.at) placeDefault(gene); // keyboard, or a click without a drag
    drag = undefined;
  });
  const canvas = renderer.domElement;
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
    const g = Math.hypot(bx, by) > 1.6 ? undefined : placeAt(d.gene, bx, by, symmetry, available(d.gene));
    return g && { ...g, scale: d.group?.scale ?? 1 };
  };
  const onMove = (e: PointerEvent) => {
    if (root.hidden || !drag) return;
    drag.at = dropAt(e, drag);
    render();
  };
  const onUp = (e: PointerEvent) => {
    if (root.hidden || !drag) return;
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

  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-sym]')) {
    b.addEventListener('click', () => { symmetry = b.dataset.sym as Symmetry; render(); });
  }
  hueInput.addEventListener('input', () => { hue = Number(hueInput.value); render(); });
  $('.fewer').addEventListener('click', () => { children = Math.max(0, children - 1); render(); });
  $('.more').addEventListener('click', () => {
    if (lineage!.children + children >= MAX_CHILDREN) message = `At most ${MAX_CHILDREN} children in reserve.`;
    else if (cost(groups) + CHILD_PRICE > lineage!.dna) message = 'Not enough DNA.';
    else children++;
    render();
  });
  const send = () => {
    if (submitted || !lineage || lineage.dna - cost(groups) < 0) return;
    submitted = true;
    clearTimeout(draftTimer);
    submit({ parts: placementsOf(groups), hue, children }, true);
    render();
  };
  $('.hatch').addEventListener('click', send);

  return {
    get isOpen() { return !root.hidden; },
    /** Open on the lineage's current design; `onSubmit` sends it to the server (final, or a draft). */
    open(l: Lineage, onSubmit: (design: Design, final: boolean) => void) {
      lineage = l;
      groups = groupsOf(l);
      children = 0;
      hue = l.hue;
      hueInput.value = String(hue);
      submitted = false;
      message = '';
      drag = undefined;
      submit = onSubmit;
      root.hidden = false;
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
      camera.left = -VIEW_HALF * aspect;
      camera.right = VIEW_HALF * aspect;
      camera.updateProjectionMatrix();
      const gs = working();
      cell.update({ x: 0, y: 0, heading: FORWARD, tumble: 0, spore: 0, cyst: 0 }, 1,
        { genome: genomeOf(gs), parts: placementsOf(gs), hue }, time, dt);
      $('.timer').textContent = `Dividing — ${Math.ceil(secondsLeft)} s left`;
      return { scene, camera };
    },
  };
}
