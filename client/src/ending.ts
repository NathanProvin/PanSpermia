import { type CardData, cardLink, renderCard } from './card.ts';
import { type Placed, type Run, type Tree, layout } from './history.ts';

// The end of a game (user direction): the session's evolution tree — every species played, its generations drawn with
// the game's shaders, the lives it lost, the parts it found, the phases it climbed — three stats, the Hall of Fame
// (today, all-time) and two buttons. A win rises in gold; an extinction plays the same, muted, ending in ✝.

export interface HallRow { rank: number; name: string; seconds: number; generations: number }
export interface HallLists { today: HallRow[]; allTime: HallRow[]; rankToday: number; rankAll: number; win?: Omit<HallRow, 'rank'> }

const SVG = 'http://www.w3.org/2000/svg';
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...kids: (SVGElement | string)[]) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...kids);
  return el;
};
const html = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') =>
  Object.assign(document.createElement(tag), { className, textContent: text });

const GROW_AT = 0.9; // s: the panel is in, the tree starts growing
const GROW_FOR = 1.7;
const CROSS = 'M-3.2 -6h6.4M0 -9v16'; // ✝, drawn
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** A smooth curve through the points (Catmull-Rom as cubic Béziers). */
function curve(points: readonly { x: number; y: number }[]) {
  let d = `M${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length; i++) {
    const [p0, p1, p2, p3] = [points[i - 2] ?? points[i - 1]!, points[i - 1]!, points[i]!, points[i + 1] ?? points[i]!];
    d += ` C${p1.x + (p2.x - p0.x) / 6} ${p1.y + (p2.y - p0.y) / 6} ${p2.x - (p3.x - p1.x) / 6} ${p2.y - (p3.y - p1.y) / 6} ${p2.x} ${p2.y}`;
  }
  return d;
}

export function createEnding(root: HTMLElement, portrait: (d: CardData) => string | undefined) {
  root.innerHTML = `
    <div class="end-rays" aria-hidden="true"></div><div class="end-burst" aria-hidden="true"></div><div class="end-bubbles" aria-hidden="true"></div>
    <div class="end-panel">
      <h1 class="end-title"><span class="end-name"></span><small class="end-fate"></small></h1>
      <div class="end-box"><svg class="end-tree" role="img" aria-label="Evolution tree"></svg><div class="end-stats"></div></div>
      <div class="end-halls">
        <section class="end-hall today"><h2>Today</h2><ol></ol></section>
        <section class="end-hall all"><h2>All-time</h2><ol></ol></section>
      </div>
      <div class="end-actions"><button type="button" class="end-share">Share</button><button type="button" class="end-again">Play again</button></div>
    </div>`;
  const $ = <T extends Element = HTMLElement>(s: string) => root.querySelector<T>(s)!;
  for (let i = 0; i < 14; i++) { // slow bubbles rising behind the panel
    const b = html('span', 'end-bubble');
    b.style.cssText = `--x:${(i * 37) % 100}vw;--s:${6 + ((i * 7) % 18)}px;--t:${9 + ((i * 5) % 8)}s;--d:${-((i * 3.1) % 12)}s`;
    $('.end-bubbles').append(b);
  }
  let card: CardData | undefined;
  let again = () => {};
  let shownAt = 0;
  let counting = 0;

  const stat = (value: number, label: string) => {
    const el = html('div', 'end-stat');
    el.append(html('b', '', '0'), html('small', '', label));
    el.dataset.value = String(value);
    return el;
  };
  /** The stats count up once the tree has grown (at once when skipped). */
  const countUp = (from: number) => {
    cancelAnimationFrame(counting);
    const tick = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - from) / 1100));
      const e = 1 - (1 - k) ** 3;
      for (const el of root.querySelectorAll<HTMLElement>('.end-stat')) {
        el.querySelector('b')!.textContent = Math.round(Number(el.dataset.value) * e).toLocaleString('en');
      }
      if (k < 1) counting = requestAnimationFrame(tick);
    };
    counting = requestAnimationFrame(tick);
  };

  const node = (p: Placed, delay: number, dead: boolean) => {
    const { gen, jump } = p;
    const r = jump ? 30 : 25;
    const tier = gen.design.tier;
    const g = svg('g', { class: `end-node t${tier}${jump ? ' jump' : ''}${dead ? ' dead' : ''}`, transform: `translate(${p.x} ${p.y})`, style: `--d:${delay}s` });
    const first = gen.design.generation - gen.gens + 1;
    const tip = [gen.gens > 1 ? `Generations ${first}–${gen.design.generation}` : `Generation ${gen.design.generation}`,
      ...(gen.deaths ? [`${gen.deaths} ${gen.deaths === 1 ? 'life' : 'lives'} lost`] : []),
      ...(gen.unlocks.length ? [`Found: ${gen.unlocks.map((u) => u.gene).join(', ')}`] : [])].join(' · ');
    const inner = svg('g', { class: 'end-pop' }, svg('title', {}, tip));
    // Deaths: short dead twigs hanging off the node, each ending in a cross.
    for (let k = 0; k < Math.min(3, gen.deaths); k++) {
      const a = (0.5 + k * 0.45) * Math.PI * 0.5 + 0.3;
      const [ex, ey] = [Math.cos(a) * (r + 22), Math.sin(a) * (r + 22)];
      inner.append(svg('path', { class: 'end-twig', d: `M${Math.cos(a) * r} ${Math.sin(a) * r}L${ex} ${ey}` }),
        svg('path', { class: 'end-cross', d: CROSS, transform: `translate(${ex + Math.cos(a) * 6} ${ey + Math.sin(a) * 6}) scale(0.7)` }));
    }
    if (gen.deaths > 3) inner.append(svg('text', { class: 'end-count', x: r + 20, y: r + 26 }, `✝${gen.deaths}`));
    if (jump) inner.append(svg('circle', { class: 'end-ring', r: r + 7 }));
    inner.append(svg('circle', { class: 'end-bubble-node', r }));
    const img = svg('image', { width: r * 2, height: r * 2, x: -r, y: -r, 'clip-path': 'url(#end-round)', class: 'end-img' });
    inner.append(img, svg('circle', { class: 'end-gloss', r: r * 0.9, cx: -r * 0.12, cy: -r * 0.18 }));
    // Parts found in that stretch: small icon badges along the top.
    const shown = gen.unlocks.slice(0, 3);
    for (const [k, u] of shown.entries()) {
      const badge = svg('g', { class: 'end-badge', transform: `translate(${(k - (shown.length - 1) / 2) * 19} ${-r - 7})` }, svg('circle', { r: 10 }));
      if (u.icon) badge.append(svg('image', { href: u.icon, width: 20, height: 20, x: -10, y: -10, 'clip-path': 'url(#end-round)' }));
      else badge.append(svg('path', { d: 'M-4 0h8M0 -4v8', class: 'end-plus' }));
      inner.append(badge);
    }
    if (gen.gens > 1) inner.append(svg('text', { class: 'end-count gens', x: r * 0.72, y: r * 0.95 }, `×${gen.gens}`));
    g.append(inner);
    return { g, img, design: gen.design };
  };

  const drawTree = (tree: Tree) => {
    const el = $<SVGSVGElement>('.end-tree');
    el.setAttribute('viewBox', `0 0 ${tree.w} ${tree.h}`);
    el.replaceChildren();
    const defs = svg('defs', {},
      svg('linearGradient', { id: 'end-trunk', x1: 0, x2: 1 }, svg('stop', { offset: 0, 'stop-color': '#7fd8ff' }), svg('stop', { offset: 0.35, 'stop-color': '#f5e27a' }),
        svg('stop', { offset: 0.7, 'stop-color': '#ffa45c' }), svg('stop', { offset: 1, 'stop-color': '#ffd678' })),
      svg('radialGradient', { id: 'end-cell', cx: 0.4, cy: 0.35 }, svg('stop', { offset: 0, 'stop-color': '#1d5a63' }), svg('stop', { offset: 1, 'stop-color': '#082a33' })),
      svg('clipPath', { id: 'end-round', clipPathUnits: 'objectBoundingBox' }, svg('circle', { cx: 0.5, cy: 0.5, r: 0.5 })),
      svg('radialGradient', { id: 'end-glow' }, svg('stop', { offset: 0, 'stop-color': '#ffe9a8', 'stop-opacity': 0.9 }), svg('stop', { offset: 1, 'stop-color': '#ffd678', 'stop-opacity': 0 })));
    el.append(defs);
    for (const c of tree.columns) el.append(svg('rect', { class: `end-column t${c.tier}`, x: c.x0 + 3, y: 4, width: c.x1 - c.x0 - 6, height: tree.h - 8, rx: 18 }));
    const span = (tree.land?.x ?? tree.w) - tree.root.x;
    const delayAt = (x: number) => GROW_AT + (GROW_FOR * (x - tree.root.x)) / span;
    const images: { img: SVGImageElement; design: CardData }[] = [];
    const layers = [svg('g', {}), svg('g', {})]; // branches under nodes
    for (const b of [...tree.branches].reverse()) { // the trunk drawn last, on top
      const ends = b.run.fate === 'evolved' && tree.land ? [tree.land] : [];
      const points = [tree.root, ...b.nodes, ...ends];
      const path = svg('path', { class: `end-branch${b.trunk ? ' trunk' : ' dead'}`, d: curve(points), pathLength: 1,
        style: `--d:${GROW_AT}s;--t:${(GROW_FOR * ((points.at(-1)!.x - tree.root.x) / span)).toFixed(2)}s` });
      layers[0]!.append(path);
      for (const p of b.nodes) {
        const n = node(p, delayAt(p.x), !b.trunk || b.run.fate === 'extinct');
        layers[1]!.append(n.g);
        images.push(n);
      }
      const last = b.nodes.at(-1);
      if (b.run.fate === 'extinct' && last) { // died out: a cross past its last node
        layers[1]!.append(svg('g', { class: 'end-node', transform: `translate(${last.x + 42} ${last.y})`, style: `--d:${delayAt(last.x + 42)}s` },
          svg('g', { class: 'end-pop' }, svg('path', { class: 'end-cross big', d: CROSS }))));
      }
    }
    layers[1]!.append(svg('g', { class: 'end-node root', transform: `translate(${tree.root.x} ${tree.root.y})`, style: `--d:${GROW_AT - 0.2}s` },
      svg('g', { class: 'end-pop' }, svg('circle', { r: 11 }), svg('circle', { r: 4, class: 'core' }))));
    if (tree.land) { // the landing: a gold crown with a sun over a hill
      layers[1]!.append(svg('g', { class: 'end-node land', transform: `translate(${tree.land.x} ${tree.land.y})`, style: `--d:${GROW_AT + GROW_FOR}s` },
        svg('circle', { class: 'end-flare', r: 70, fill: 'url(#end-glow)' }),
        svg('g', { class: 'end-pop' }, svg('circle', { r: 34 }), svg('circle', { class: 'sun', r: 8, cx: 7, cy: -8 }),
          svg('path', { class: 'hill', d: 'M-24 14Q-8 -6 6 6T26 12V20H-24Z' }))));
    }
    el.append(...layers);
    // Thumbnails: a few per frame (the game's shaders, read back), nodes fill in as they come.
    let i = 0;
    const fill = () => {
      for (const end = i + 3; i < Math.min(end, images.length); i++) {
        const url = portrait(images[i]!.design);
        if (url) images[i]!.img.setAttribute('href', url);
      }
      if (i < images.length) requestAnimationFrame(fill);
    };
    requestAnimationFrame(fill);
  };

  const hall = (ol: HTMLOListElement, rows: HallRow[], rank: number, win?: Omit<HallRow, 'rank'>) => {
    const row = (r: number, w: Omit<HallRow, 'rank'>) => {
      const li = html('li', r === rank ? 'self' : '');
      li.value = r;
      li.append(html('span', 'rank', String(r)), html('span', 'name', w.name), html('span', 'time', clock(w.seconds)), html('span', 'gens', `${w.generations} gen`));
      return li;
    };
    ol.replaceChildren(...rows.map((w) => row(w.rank, w)));
    if (!rows.length) ol.append(html('li', 'empty', 'No species has walked onto land yet'));
    if (win && rank > rows.length) ol.append(html('li', 'gap', '⋮'), row(rank, win));
  };

  /**
   * Everything on one screen, never a scrollbar (user rule): the tree gives up the height the rest needs; on a short
   * screen the Halls show their top five (and our row) first.
   */
  const fit = () => {
    if (root.hidden) return;
    const panel = $('.end-panel');
    const tree = $<SVGSVGElement>('.end-tree');
    tree.style.maxHeight = '';
    root.classList.remove('short');
    const over = () => panel.scrollHeight - panel.clientHeight;
    if (over() <= 0) return;
    const h = tree.getBoundingClientRect().height;
    if (h - over() < 150) root.classList.add('short');
    tree.style.maxHeight = `${Math.max(110, tree.getBoundingClientRect().height - Math.max(0, over()))}px`;
  };
  addEventListener('resize', fit);
  void document.fonts?.ready.then(fit);

  const finish = () => { // skip the entrance: everything at its end state
    if (root.classList.contains('settled')) return;
    root.classList.add('settled');
    countUp(performance.now() - 2000);
  };
  root.addEventListener('pointerdown', (e) => { if (!(e.target as Element).closest('button')) finish(); });
  addEventListener('keydown', (e) => { if (!root.hidden && e.key !== 'Tab' && e.key !== 'Enter' && e.key !== ' ') finish(); });

  $('.end-again').addEventListener('click', () => {
    root.hidden = true;
    root.className = '';
    again();
  });
  $('.end-share').addEventListener('click', async () => {
    if (!card) return;
    const button = $<HTMLButtonElement>('.end-share');
    const url = cardLink(card);
    try {
      const blob = await new Promise<Blob | null>((ok) => renderCard(card!).toBlob(ok, 'image/png'));
      const files = blob ? [new File([blob], 'species-card.png', { type: 'image/png' })] : [];
      const data: ShareData = { title: card.name, text: `${card.name} — Panspermia`, url, ...(files.length && navigator.canShare?.({ files }) ? { files } : {}) };
      if (navigator.share) return await navigator.share(data);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return; // the player closed the share sheet
    }
    try {
      await navigator.clipboard.writeText(url);
      button.textContent = 'Link copied';
    } catch {
      button.textContent = 'Copy failed';
      history.replaceState(null, '', url);
    }
    setTimeout(() => (button.textContent = 'Share'), 2500);
  });

  return {
    /** The entrance has played: the overlay covers the pool (the game may stop drawing it). */
    get covering() { return !root.hidden && performance.now() - shownAt > 1200; },
    get isOpen() { return !root.hidden; },
    /**
     * Show the end of the game: the session's runs (the last one just ended), its final card for the stats and Share,
     * what Play again does.
     */
    show(runs: readonly Run[], final: CardData, onAgain: () => void) {
      card = final;
      again = onAgain;
      const won = final.fate === 'evolved';
      root.className = won ? 'win' : 'extinct'; // drops 'in' and 'settled': the entrance plays again
      $('.end-name').textContent = final.name;
      $('.end-fate').textContent = won ? '✦ Walked onto land ✦' : '✝ Extinct';
      $('.end-stats').replaceChildren(stat(final.generation, 'generations'), stat(final.dna, 'DNA gathered'), stat(final.kills, 'rivals defeated'));
      drawTree(layout(runs));
      $('.end-share').textContent = 'Share';
      root.hidden = false;
      fit();
      void root.offsetWidth; // start the entrance from its first frame
      root.classList.add('in');
      shownAt = performance.now();
      countUp(shownAt + (GROW_AT + GROW_FOR) * 1000);
      setTimeout(() => $<HTMLButtonElement>('.end-again').focus({ preventScroll: true }), 3400);
    },
    /** The Hall of Fame (it may arrive after the screen). */
    hall(h: HallLists) {
      hall($<HTMLOListElement>('.today ol'), h.today, h.rankToday, h.win);
      hall($<HTMLOListElement>('.all ol'), h.allTime, h.rankAll, h.win);
      fit();
    },
  };
}
