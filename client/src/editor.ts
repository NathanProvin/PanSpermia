import {
  CHILD_PRICE, evolveDnaOf, type Catalog, type Lineage, MAX_CHILDREN, MAX_PARTS, MAX_TIER, NAME_MAX, type Placement, TIER_NAMES,
  SHAPE_NAMES, catalogFor, cleanName, undeform, DEFAULT_RADII, DEFAULT_RADII_OF, MAX_SEGMENTS, MIN_SEGMENTS, PLAN_NAMES, PLANS_OF,
  SEGMENT_MAX, SEGMENT_MIN, fitsPlan,
  animalRim, isAnimal, segmentsOf,
} from '@panspermia/shared';
import * as THREE from 'three';
import { createCellView } from './scene/cells.ts';

// Spore-like cell editor, open while your cell sits in its division cyst. One editor for every tier: the
// tier's part catalog (palette, prices, copies, slots, default spots) is picked when it opens. Drag parts from the palette
// onto the body (membrane parts snap to the rim, internal ones float inside, coats toggle), drag
// placed parts to move them, drag off the body or right-click to remove (refunded), wheel to resize.
// Symmetry: axial mirrors across the forward axis, radial repeats around the centre; a placement on
// the axis (or at the centre) stays a single copy. Children are bought at a fixed price.
// Animals also edit their body: a spine of segments or a radial body (a centre and lobes); add or remove
// segments, drag a segment's edge to resize it (in a radial body, all lobes together). The body is free.

type Symmetry = 'axial' | 'radial';
/** One placement as the player made it: a master part plus how it repeats. */
interface Group { gene: string; x: number; y: number; angle: number; scale: number; repeat: 'single' | 'axial' | 'radial'; n: number }
export interface Design {
  parts: Placement<string>[]; hue: number; shape: number; children: number; name: string; evolve?: boolean;
  plan?: number; radii?: number[];
}

const VIEW_HALF = 2.4; // cell radii visible above and below the centre
const ANIMAL_VIEW_HALF = 3; // an animal's long body, legs and antennae need more room
const AXIS_SNAP = 0.12; // radii: this close to the axis (or the centre) is "on" it
const PICK = 0.3; // radii: grab distance for placed parts
const INTERIOR = 0.6; // internal parts stay this far inside
const FORWARD = Math.PI / 2; // the editor shows the cell swimming up the screen

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

export function createEditor(renderer: THREE.WebGLRenderer, root: HTMLElement) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fb3a6); // sunny pond water: organisms are drawn for a light background (polish S2)
  const camera = new THREE.OrthographicCamera(-1, 1, VIEW_HALF, -VIEW_HALF, -10, 10);
  const cell = createCellView(scene, 0.42);

  root.innerHTML = `
    <section class="panel" id="palette" aria-label="Parts"><h2>Parts</h2><div class="parts"></div></section>
    <section class="panel" id="editor-side" aria-label="Design">
      <p class="timer" role="timer"></p>
      <label>Species name <input type="text" class="name" maxlength="${NAME_MAX}" autocomplete="off" spellcheck="false"></label>
      <p class="dna"></p>
      <fieldset><legend>Symmetry</legend>
        <button type="button" data-sym="axial" aria-pressed="true">Axial</button>
        <button type="button" data-sym="radial" aria-pressed="false">Radial</button>
      </fieldset>
      <fieldset class="shapes"><legend>Shape</legend></fieldset>
      <fieldset class="body"><legend>Body <small>(drag a segment's edge to resize)</small></legend>
        <span class="plans"></span>
        <span class="segments-control">
          <button type="button" class="seg-fewer" aria-label="One segment fewer">−</button>
          <output class="segments"></output>
          <button type="button" class="seg-more" aria-label="One segment more">+</button>
        </span>
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
      <label class="evolution">Evolution <progress></progress></label>
      <button type="button" class="evolve" title="Earn lifetime DNA to evolve">Evolve</button>
    </section>`;
  const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const palette = $<HTMLElement>('.parts');
  const hueInput = $<HTMLInputElement>('.hue');
  const nameInput = $<HTMLInputElement>('.name');
  const evolveButton = $<HTMLButtonElement>('.evolve');
  let name = '';
  /** Evolving is final for this tier: the first click arms the button, the second commits. */
  let evolveArmed = false;
  let evolving = false;

  let lineage: Lineage | undefined;
  let cat = catalogFor(1);
  let shape = 0;
  let groups: Group[] = [];
  let plan = 0;
  let radii: number[] = [...DEFAULT_RADII];
  /** A segment being resized: its index, its centre and pointer distance when grabbed, its size then. */
  let resize: { i: number; cx: number; cy: number; d0: number; r0: number } | undefined;
  const animal = () => isAnimal(lineage?.tier ?? 1);
  const segments = () => segmentsOf(plan, radii);
  let children = 0;
  let hue = 0;
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

  /** Body-frame coordinates (cell radii, x forward) under a pointer event. */
  const toBody = (e: PointerEvent | WheelEvent) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const wx = ((e.clientX - rect.left) / rect.width * 2 - 1) * camera.right;
    const wy = -((e.clientY - rect.top) / rect.height * 2 - 1) * camera.top;
    const c = undeform(shape, wy, -wx); // rotate the screen by -FORWARD, then undo the body shape
    return { bx: c.x, by: c.y };
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

  /** Palette buttons are built once per opening (the library only grows between divisions). */
  const buildPalette = () => {
    palette.replaceChildren(...cat.NAMES.map((gene) => {
      const button = document.createElement('button');
      button.type = 'button';
      const unlocked = (lineage!.library & cat.GENES[gene]!.bit) !== 0;
      // A part of the other body plan (tier 4): shown, but it can't go on this body.
      const fits = !animal() || fitsPlan(plan, cat.GENES[gene]!.bit);
      button.disabled = !unlocked || !fits;
      button.dataset.gene = gene;
      const { label, slot } = cat.GENES[gene]!;
      const other = PLANS_OF[lineage!.tier]?.find((q) => fitsPlan(q, cat.GENES[gene]!.bit));
      button.innerHTML = !unlocked ? '<span>???</span><small>find its DNA</small>'
        : fits ? `<span>${label}</span><small></small>` : `<span>${label}</span><small>${PLAN_NAMES[other ?? 0]} part</small>`;
      if (unlocked && fits) button.title = slot === 'coat' ? 'Click to toggle' : 'Drag onto the cell, or click to place';
      return button;
    }));
  };
  const render = () => {
    const gs = working();
    const genome = genomeOf(cat, gs);
    const left = lineage!.dna - cost(gs);
    for (const button of palette.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')) {
      const gene = button.dataset.gene!;
      const { price, maxCopies, slot } = cat.GENES[gene]!;
      button.querySelector('small')!.textContent = `${price} DNA · ${cat.copiesOf(genome, gene)}/${maxCopies}${slot === 'coat' ? ' · coat' : ''}`;
    }
    const spend = cost(gs);
    $('.dna').textContent = `DNA ${Math.floor(left)} left (${spend >= 0 ? 'spending' : 'refunding'} ${Math.abs(Math.round(spend))})`;
    $('.dna').classList.toggle('short', left < 0);
    $('.children').textContent = `${lineage!.children} + ${children}`;
    $('.stats').textContent = `${placementsOf(gs).length}/${MAX_PARTS} parts · upkeep ${cat.upkeepOf(genome).toFixed(3)} energy/s`;
    $('.message').textContent = message;
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-sym]')) b.setAttribute('aria-pressed', String(b.dataset.sym === symmetry));
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-shape]')) b.setAttribute('aria-pressed', String(Number(b.dataset.shape) === shape));
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-plan]')) b.setAttribute('aria-pressed', String(Number(b.dataset.plan) === plan));
    $<HTMLElement>('.body').hidden = !animal();
    $('.segments').textContent = plan === 1 ? `${radii.length - 1} lobes` : `${radii.length} segments`;
    const named = cleanName(name);
    if (!named && !message) $('.message').textContent = `Name: 2–${NAME_MAX} letters, spaces, hyphens or apostrophes.`;
    $<HTMLButtonElement>('.hatch').disabled = submitted || left < 0 || !named;
    // Animals mate and lay a clutch; a species that just evolved hatches its first individual of the new tier.
    $('.hatch').textContent = evolving ? 'Hatch' : lineage!.tier === 3 ? 'Lay eggs' : animal() ? 'Hatch' : 'Divide';
    const need = evolveDnaOf(lineage!.tier);
    const ready = lineage!.lifetimeDna >= need;
    const progress = $<HTMLProgressElement>('.evolution progress');
    if (Number.isFinite(need)) [progress.max, progress.value] = [need, Math.min(need, lineage!.lifetimeDna)];
    evolveButton.disabled = submitted || left < 0 || !named || !ready;
    const next = TIER_NAMES[lineage!.tier + 1]?.toLowerCase();
    evolveButton.hidden = $<HTMLElement>('.evolution').hidden = lineage!.tier >= MAX_TIER || evolving;
    evolveButton.textContent = evolveArmed ? `Evolve to ${next}? Click again` : ready ? 'Evolve' : `Evolve (${Math.floor(lineage!.lifetimeDna)}/${need} DNA)`;
    // Keep the server's draft current (debounced), so the timer running out keeps these edits.
    clearTimeout(draftTimer);
    if (!submitted && left >= 0 && !drag && named) draftTimer = setTimeout(() => submit(design(), false), 250);
  };

  // Palette: press to drag a new part; a press released without dragging places it at its default spot.
  palette.addEventListener('pointerdown', (e) => {
    const gene = (e.target as Element).closest<HTMLButtonElement>('button:not(:disabled)')?.dataset.gene;
    if (gene && cat.GENES[gene]!.slot !== 'coat') drag = { gene };
  });
  palette.addEventListener('click', (e) => {
    const gene = (e.target as Element).closest<HTMLButtonElement>('button')?.dataset.gene;
    if (gene && !drag?.at) placeDefault(gene); // keyboard, or a click without a drag
    drag = undefined;
  });
  const canvas = renderer.domElement;
  const onDown = (e: PointerEvent) => {
    if (root.hidden) return;
    const { bx, by } = toBody(e);
    const i = pick(bx, by);
    if (i < 0) {
      // Not on a part: grab the animal segment under the pointer (the one whose edge is nearest).
      const segs = animal() ? segments() : [];
      let best = -1;
      for (const [k, [x, y, r]] of segs.entries()) {
        const d = Math.hypot(bx - x, by - y);
        if (d < r * 1.15 && (best < 0 || Math.abs(d - r) < Math.abs(Math.hypot(bx - segs[best]![0], by - segs[best]![1]) - segs[best]![2]))) best = k;
      }
      if (best >= 0) {
        const [x, y] = segs[best]!;
        resize = { i: best, cx: x, cy: y, d0: Math.max(0.05, Math.hypot(bx - x, by - y)), r0: radii[best]! };
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
  const onMove = (e: PointerEvent) => {
    if (root.hidden) return;
    if (resize) {
      // Measured from where the segment was when grabbed, so refitting the body can't feed back.
      const { bx, by } = toBody(e);
      const r = Math.min(SEGMENT_MAX, Math.max(SEGMENT_MIN, resize.r0 * Math.hypot(bx - resize.cx, by - resize.cy) / resize.d0));
      if (plan === 1 && resize.i > 0) radii = radii.map((v, k) => (k > 0 ? r : v)); // lobes stay symmetric
      else radii[resize.i] = r;
      render();
      return;
    }
    if (!drag) return;
    drag.at = dropAt(e, drag);
    render();
  };
  const onUp = (e: PointerEvent) => {
    if (resize) {
      resize = undefined;
      render(); // sends the draft
      return;
    }
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
  /** Plan buttons for the tier being edited (built when the editor opens). */
  const buildPlans = () => {
    $('.plans').replaceChildren(...(PLANS_OF[lineage!.tier] ?? []).map((i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.plan = String(i);
      b.textContent = PLAN_NAMES[i]!;
      b.addEventListener('click', () => {
        if (i === plan) return;
        plan = i;
        radii = [...DEFAULT_RADII_OF[i]!]; // each plan starts from its own body
        // Parts the new plan can't wear come off (refunded); the palette follows the plan.
        const kept = groups.filter((g) => fitsPlan(plan, cat.GENES[g.gene]!.bit));
        if (kept.length < groups.length) message = `Parts that don't fit a ${PLAN_NAMES[i]!.toLowerCase()} came off.`;
        groups = kept;
        buildPalette();
        render();
      });
      return b;
    }));
  };
  $('.seg-fewer').addEventListener('click', () => {
    if (radii.length > MIN_SEGMENTS) radii.pop();
    render();
  });
  $('.seg-more').addEventListener('click', () => {
    if (radii.length < MAX_SEGMENTS) radii.push(plan === 1 ? radii.at(-1)! : Math.max(SEGMENT_MIN, radii.at(-1)! * 0.85)); // a tapering tail
    render();
  });
  hueInput.addEventListener('input', () => { hue = Number(hueInput.value); render(); });
  $('.fewer').addEventListener('click', () => { children = Math.max(0, children - 1); render(); });
  $('.more').addEventListener('click', () => {
    if (lineage!.children + children >= MAX_CHILDREN) message = `At most ${MAX_CHILDREN} children in reserve.`;
    else if (cost(groups) + CHILD_PRICE > lineage!.dna) message = 'Not enough DNA.';
    else children++;
    render();
  });
  const design = (): Design => ({
    parts: placementsOf(groups), hue, shape, children, name: cleanName(name) ?? '', ...(animal() ? { plan, radii: [...radii] } : {}),
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
      shape = l.shape;
      plan = l.plan;
      radii = l.radii.length ? [...l.radii] : [...(DEFAULT_RADII_OF[l.plan] ?? DEFAULT_RADII)];
      resize = undefined;
      // Shape names depend on the tier (coccus/rod/vibrio for bacteria); the shapes themselves don't.
      $('.shapes').replaceChildren($('.shapes legend'), ...SHAPE_NAMES[l.tier as 1 | 2 | 3 | 4].map((label, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.shape = String(i);
        b.textContent = label;
        b.addEventListener('click', () => { shape = i; render(); });
        return b;
      }));
      hueInput.value = String(hue);
      name = l.name;
      nameInput.value = name;
      evolveArmed = false;
      submitted = false;
      message = '';
      drag = undefined;
      submit = onSubmit;
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
      cell.update({ x: 0, y: 0, heading: FORWARD, tumble: 0, spore: 0, cyst: 0 }, 1,
        { tier: lineage!.tier, genome: genomeOf(cat, gs), parts: placementsOf(gs), hue, shape, segments: segments(), plan }, time, dt);
      const what = evolving ? `Evolved: design your first ${TIER_NAMES[lineage!.tier]!.toLowerCase()}` : animal() ? 'Mating' : 'Dividing';
      $('.timer').textContent = `${what} — ${Math.ceil(secondsLeft)} s left`;
      return { scene, camera };
    },
  };
}
