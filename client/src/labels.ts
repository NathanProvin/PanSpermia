import type { Player } from '@panspermia/shared';
import * as THREE from 'three';

// Species names floating above cells (DOM text: crisp at any zoom, cheap for ~50 cells), and the live
// leaderboard of the biggest cells in the room. Names come from players and are only ever set as
// textContent. Two colour codes (user direction): every name wears its phase's colour (bacteria blue, eukaryotes
// yellow, plankton orange, animals red: who to hunt, who to flee), and the ranking's top three are a podium of bold
// gold, silver and bronze names, a dot of the phase colour before each name.

const LEADERS = 8;
const PODIUM = ['gold', 'silver', 'bronze'];

export function createLabels(layer: HTMLElement, board: HTMLOListElement) {
  const labels = new Map<string, HTMLDivElement>();
  const v = new THREE.Vector3();
  let boardKey = '';

  return {
    /** Place each named cell's label just above it; `at` gives its rendered position and radius. */
    update(players: Map<string, Player>, selfId: string, camera: THREE.Camera, at: (id: string) => { x: number; y: number; r: number } | undefined, show: boolean) {
      layer.hidden = !show;
      for (const [id, el] of labels) {
        if (!players.has(id)) {
          el.remove();
          labels.delete(id);
        }
      }
      if (!show) return;
      for (const [id, p] of players) {
        const pos = at(id);
        if (!p.name || !pos) continue;
        let el = labels.get(id);
        if (!el) {
          el = document.createElement('div');
          layer.append(el);
          labels.set(id, el);
        }
        const cls = id === selfId ? 'self' : `tier-${p.tier}`;
        if (el.className !== cls) el.className = cls;
        if (el.textContent !== p.name) el.textContent = p.name;
        v.set(pos.x, pos.y + pos.r * 1.25, 0).project(camera);
        const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
        el.style.display = visible ? '' : 'none';
        if (visible) {
          el.style.transform = `translate(${((v.x + 1) / 2) * innerWidth}px, ${((1 - v.y) / 2) * innerHeight}px) translate(-50%, -100%)`;
        }
      }
    },
    /** Biggest cells first; the DOM only changes when the ranking or rounded masses do. */
    leaderboard(players: Map<string, Player>, selfId: string, show: boolean) {
      board.hidden = !show;
      // Mates ('~' ids) answer a call; they're not contestants.
      const top = [...players].filter(([id, p]) => p.name && !id.startsWith('~')).sort(([, a], [, b]) => b.mass - a.mass).slice(0, LEADERS);
      const key = top.map(([id, p]) => `${id}:${p.tier}:${Math.round(p.mass)}`).join();
      if (key === boardKey) return;
      boardKey = key;
      board.replaceChildren(...top.map(([id, p], rank) => {
        const li = document.createElement('li');
        li.className = [PODIUM[rank] ?? '', `tier-${p.tier}`, id === selfId ? 'self' : ''].filter(Boolean).join(' ');
        const dot = document.createElement('i');
        const name = document.createElement('span');
        name.textContent = p.name;
        li.append(dot, name, ` · ${Math.round(p.mass)}`);
        return li;
      }));
    },
  };
}
