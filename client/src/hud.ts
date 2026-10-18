// The in-game HUD (polish S3): discreet, minimal, out of the way of the pond. A glass panel top-left (species,
// energy and DNA gauges, children as icons), ability chips with cooldown rings and one status line bottom-centre,
// fading toasts top-centre, a red vignette instead of a health bar. Plain DOM, built once; update() only writes
// what changed. Styles: the shared design tokens in index.html.

export interface Ability { id: string; icon: string; label: string; hint: string; ready: number; active: boolean }
export interface HudState {
  name: string; generation: number; tier: number;
  /** Energy toward the size cap, 0..1. */
  energy: number;
  /** Spendable DNA, and lifetime DNA toward evolving (0..1; undefined at the top tier). */
  dna: number; evolve?: number;
  children: number;
  abilities: Ability[];
  status: string;
  /** Health share 0..1 (shown only as a vignette when low). */
  health: number;
}

/** Child icons by tier: a cell, a cell with a nucleus, an egg, a cocoon. */
export const CHILD_ICON = [
  '',
  '<circle cx="8" cy="8" r="5.5"/>',
  '<circle cx="8" cy="8" r="6"/><circle cx="9.5" cy="7" r="2" class="in"/>',
  '<ellipse cx="8" cy="8.5" rx="4.6" ry="6"/>',
  '<path d="M8 1.5C11.5 4 11.5 12 8 14.5 4.5 12 4.5 4 8 1.5Z"/><path d="M5.6 6h4.8M5.4 9h5.2" class="in"/>',
];

// The two gauges are molecules (user direction): energy a stylised starch chain — glucose rings joined by oxygen
// bridges, each with its CH2OH stub — in orange; DNA a double helix with its base pairs, in mossy green. A dim copy is
// the track, a bright copy clipped to the fill level shows how full it is.
const W = 200;
const H = 20;
function starch() {
  let d = '';
  let atoms = '';
  const ring = (cx: number, cy: number) => Array.from({ length: 6 }, (_, k) => {
    const a = ((-90 + 60 * k) * Math.PI) / 180;
    return [cx + 6.5 * Math.cos(a), cy + 6.5 * Math.sin(a)] as const;
  });
  const n = 7;
  for (let i = 0; i < n; i++) {
    const cx = 12 + i * 29;
    const v = ring(cx, 11);
    d += `M${v.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}Z`;
    d += `M${v[0]![0].toFixed(1)} ${v[0]![1].toFixed(1)}l-3 -3.5`; // CH2OH
    atoms += `<circle cx="${v[1]![0].toFixed(1)}" cy="${v[1]![1].toFixed(1)}" r="1.3"/>`; // the ring oxygen
    if (i < n - 1) { // the α-1,4 glycosidic bond, through its oxygen
      const [ax, ay] = v[2]!;
      const bx = cx + 29 + 6.5 * Math.cos((150 * Math.PI) / 180);
      const by = 11 + 6.5 * Math.sin((150 * Math.PI) / 180);
      const ox = (ax + bx) / 2;
      d += `M${ax.toFixed(1)} ${ay.toFixed(1)}L${ox.toFixed(1)} ${(ay + 3.5).toFixed(1)}L${bx.toFixed(1)} ${by.toFixed(1)}`;
      atoms += `<circle cx="${ox.toFixed(1)}" cy="${(ay + 3.5).toFixed(1)}" r="1.6"/>`;
    }
  }
  return `<path d="${d}"/>${atoms}`;
}
function helix() {
  const y = (x: number, s: number) => 10 + s * 6.5 * Math.sin((x / W) * Math.PI * 2 * 3.2);
  const strand = (s: number) => `M${Array.from({ length: W / 2 + 1 }, (_, k) => `${k * 2} ${y(k * 2, s).toFixed(1)}`).join('L')}`;
  let rungs = '';
  for (let x = 3; x < W; x += 6) {
    if (Math.abs(y(x, 1) - y(x, -1)) > 2.5) rungs += `M${x} ${y(x, 1).toFixed(1)}L${x} ${y(x, -1).toFixed(1)}`;
  }
  return `<path class="rungs" d="${rungs}"/><path d="${strand(1)}"/><path d="${strand(-1)}"/>`;
}
const MOLECULES = { energy: starch(), dna: helix() };
/** A molecule gauge (an SVG string); fill it with setMolecule. */
export function molecule(kind: 'energy' | 'dna', label: string) {
  const id = `clip-${kind}-${Math.random().toString(36).slice(2, 7)}`;
  return `<svg class="molecule ${kind}" viewBox="0 0 ${W} ${H}" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="100">
    <defs><clipPath id="${id}"><rect height="${H}" width="0"/></clipPath></defs>
    <g class="track">${MOLECULES[kind]}</g><g class="lit" clip-path="url(#${id})">${MOLECULES[kind]}</g></svg>`;
}
/** Fill a molecule gauge to `pct` (0..100). */
export function setMolecule(svg: Element, pct: number) {
  svg.querySelector('clipPath rect')!.setAttribute('width', String((W * Math.max(0, Math.min(100, pct))) / 100));
  svg.setAttribute('aria-valuenow', String(Math.round(pct)));
}

export function createHud(root: HTMLElement) {
  root.innerHTML = `
    <div class="hud-panel" hidden>
      <div class="hud-name"><span class="species"></span><small class="gen"></small></div>
      <div class="hud-row" title="Energy: grow to your size cap to reproduce">
        <span class="hud-label">Energy</span>${molecule('energy', 'Energy')}
      </div>
      <div class="hud-row" title="DNA to spend in the editor; the helix fills toward evolving">
        <span class="hud-label">DNA <b class="dna-num"></b></span>${molecule('dna', 'Evolution')}
      </div>
      <div class="children" aria-label="Children in reserve"></div>
    </div>
    <div class="hud-bottom"><div class="hud-status" role="status"></div><div class="hud-abilities"></div></div>
    <div class="hud-toasts" aria-live="polite"></div>
    <div class="hud-message"></div>
    <div class="hud-vignette"></div>
    <div class="hud-perf"></div>`;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const panel = $('.hud-panel');
  const energy = root.querySelector('.molecule.energy')!;
  const dna = root.querySelector<SVGSVGElement>('.molecule.dna')!;
  const abilities = $('.hud-abilities');
  const vignette = $('.hud-vignette');
  const last: Record<string, string | number | boolean> = {};
  /** Write only when the value changed (this runs every frame). */
  const set = (key: string, value: string | number | boolean, write: () => void) => {
    if (last[key] === value) return;
    last[key] = value;
    write();
  };
  const chips = new Map<string, HTMLElement>();
  const unlocks: { label: string; icon?: string }[] = [];
  const showUnlock = () => {
    const u = unlocks[0];
    if (!u) return;
    const card = document.createElement('div');
    card.className = 'unlock';
    card.setAttribute('role', 'status');
    card.innerHTML = `<div class="unlock-icon"><i class="ring"></i>${Array.from({ length: 10 }, (_, k) =>
      `<i class="spark" style="--a:${k * 36}deg"></i>`).join('')}${u.icon ? `<img src="${u.icon}" alt="">` : '<b>?</b>'}</div>
      <div class="unlock-text"><small>New part discovered</small><strong></strong><small>Place it in your next generation</small></div>`;
    card.querySelector('strong')!.textContent = u.label;
    root.append(card);
    setTimeout(() => {
      card.remove();
      unlocks.shift();
      showUnlock();
    }, 3600);
  };

  return {
    update(s: HudState | undefined) {
      set('shown', !!s, () => { panel.hidden = !s; });
      if (!s) {
        set('status', '', () => { $('.hud-status').textContent = ''; });
        abilities.replaceChildren();
        chips.clear();
        vignette.style.opacity = '0';
        return;
      }
      set('name', s.name, () => { $('.species').textContent = s.name; });
      set('gen', s.generation, () => { $('.gen').textContent = `gen ${s.generation}`; });
      const e = Math.round(s.energy * 100);
      set('energy', e, () => {
        setMolecule(energy, e);
        energy.classList.toggle('full', e >= 99);
      });
      set('dna', Math.floor(s.dna), () => { $('.dna-num').textContent = String(Math.floor(s.dna)); });
      const v = s.evolve === undefined ? -1 : Math.round(s.evolve * 100);
      set('evolve', v, () => {
        dna.style.display = v < 0 ? 'none' : '';
        setMolecule(dna, Math.max(0, v));
        dna.classList.toggle('ready', v >= 100);
      });
      set('children', `${s.children}/${s.tier}`, () => {
        const box = $('.children');
        box.setAttribute('aria-label', `${s.children} children in reserve`);
        box.innerHTML = Array.from({ length: Math.min(9, s.children) },
          () => `<svg viewBox="0 0 16 16" aria-hidden="true">${CHILD_ICON[s.tier] ?? CHILD_ICON[1]}</svg>`).join('')
          || '<small>no children left</small>';
      });
      set('status', s.status, () => { $('.hud-status').textContent = s.status; });
      // Ability chips: one per ability the species has, a conic ring filling up as it recharges.
      const ids = s.abilities.map((a) => a.id).join();
      set('abilities', ids, () => {
        chips.clear();
        abilities.replaceChildren(...s.abilities.map((a) => {
          const chip = document.createElement('div');
          chip.className = 'chip';
          chip.title = `${a.label} (${a.hint})`;
          chip.innerHTML = `<span aria-hidden="true">${a.icon}</span><small>${a.hint}</small>`;
          chips.set(a.id, chip);
          return chip;
        }));
      });
      for (const a of s.abilities) {
        const chip = chips.get(a.id)!;
        const ready = Math.round(a.ready * 100);
        set(`chip-${a.id}`, `${ready}/${a.active}`, () => {
          chip.style.setProperty('--p', `${ready}%`);
          chip.classList.toggle('ready', ready >= 100 && !a.active);
          chip.classList.toggle('active', a.active);
        });
      }
      const hurt = Math.round(Math.max(0, Math.min(1, (0.5 - s.health) / 0.5)) * 100) / 100;
      set('hurt', hurt, () => { vignette.style.opacity = String(hurt * 0.85); });
    },
    /** Energy and DNA just taken in: a "+N" pops beside each gauge, in its colour, and floats away. */
    gain(energy: number, dna: number) {
      for (const [amount, kind] of [[energy, 'energy'], [dna, 'dna']] as const) {
        if (amount < 1) continue;
        const pop = document.createElement('span');
        pop.className = `gain ${kind}`;
        pop.textContent = `+${Math.round(amount)}`;
        root.querySelector(`.molecule.${kind}`)?.parentElement?.append(pop);
        setTimeout(() => pop.remove(), 1400);
      }
    },
    /**
     * A part discovered (user direction: an animation, not a text): a card drops in under the top edge — the part's
     * icon in a turning ring of DNA green with sparks bursting out, its name — holds, then rises away. Several queue.
     */
    unlock(label: string, icon?: string) {
      unlocks.push({ label, icon });
      if (unlocks.length === 1) showUnlock();
    },
    /** A short notice that fades away (deaths, refusals). */
    toast(text: string) {
      const box = $('.hud-toasts');
      const t = document.createElement('div');
      t.className = 'toast';
      t.textContent = text;
      box.append(t);
      while (box.children.length > 3) box.firstElementChild!.remove();
      setTimeout(() => t.remove(), 4500);
    },
    /** A persistent centred message (connecting, disconnected); '' clears it. */
    message(text: string) { $('.hud-message').textContent = text; },
    /** Dev readout in a corner. */
    perf(text: string) { set('perf', text, () => { $('.hud-perf').textContent = text; }); },
  };
}
export type Hud = ReturnType<typeof createHud>;
