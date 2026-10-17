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

export function createHud(root: HTMLElement) {
  root.innerHTML = `
    <div class="hud-panel" hidden>
      <div class="hud-name"><span class="species"></span><small class="gen"></small></div>
      <div class="hud-row" title="Energy: grow to your size cap to reproduce">
        <span class="hud-label">Energy</span><div class="gauge energy" role="meter" aria-label="Energy" aria-valuemin="0" aria-valuemax="100"><i></i></div>
      </div>
      <div class="hud-row" title="DNA to spend in the editor; the bar fills toward evolving">
        <span class="hud-label">DNA <b class="dna-num"></b></span><div class="gauge dna" role="meter" aria-label="Evolution" aria-valuemin="0" aria-valuemax="100"><i></i></div>
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
  const energy = $('.gauge.energy');
  const dna = $('.gauge.dna');
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
        (energy.firstElementChild as HTMLElement).style.width = `${e}%`;
        energy.setAttribute('aria-valuenow', String(e));
        energy.classList.toggle('full', e >= 99);
      });
      set('dna', Math.floor(s.dna), () => { $('.dna-num').textContent = String(Math.floor(s.dna)); });
      const v = s.evolve === undefined ? -1 : Math.round(s.evolve * 100);
      set('evolve', v, () => {
        dna.hidden = v < 0;
        (dna.firstElementChild as HTMLElement).style.width = `${Math.max(0, v)}%`;
        dna.setAttribute('aria-valuenow', String(Math.max(0, v)));
        dna.classList.toggle('ready', v >= 100);
        dna.title = v >= 100 ? 'Ready to evolve at your next division' : 'Lifetime DNA toward evolving';
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
    /** A short notice that fades away (unlocks, deaths, refusals). */
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
