import type { Player } from '@panspermia/shared';
import * as THREE from 'three';

// Species names floating above cells (DOM text: crisp at any zoom, cheap for ~50 cells), and the live
// leaderboard of the biggest cells in the room. Names come from players and are only ever set as
// textContent.

const LEADERS = 8;

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
          el.className = id === selfId ? 'self' : '';
          layer.append(el);
          labels.set(id, el);
        }
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
      const key = top.map(([id, p]) => `${id}:${Math.round(p.mass)}`).join();
      if (key === boardKey) return;
      boardKey = key;
      board.replaceChildren(...top.map(([id, p]) => {
        const li = document.createElement('li');
        li.textContent = `${p.name} · ${Math.round(p.mass)}`;
        if (id === selfId) li.className = 'self';
        return li;
      }));
    },
  };
}
