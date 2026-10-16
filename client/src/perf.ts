// Frame budget: CPU ms per section, GPU ms per frame (timer query), frame interval and draw calls, as the
// median and 95th percentile of the last WINDOW frames (steady cost and stutter apart). The adaptive
// resolution reads it in production; in dev it shows in the HUD and as `perf()` from the console.
// `?off=floor,haze,bloom,plankton,nutrients` switches layers off so each one's cost shows by difference.
import type * as THREE from 'three';

export const off = new Set((new URLSearchParams(location.search).get('off') ?? '').split(',').filter(Boolean));

const WINDOW = 120;
const NOT_CPU = new Set(['gpu', 'calls', 'frame']);

export function createPerf(renderer: THREE.WebGLRenderer) {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const pending: WebGLQuery[] = [];
  const samples: Record<string, number[]> = {};
  const add = (key: string, v: number) => {
    const s = (samples[key] ??= []);
    s.push(v);
    if (s.length > WINDOW) s.shift();
  };
  const pick = (key: string, q: number) => {
    const s = [...(samples[key] ?? [0])].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
  };
  let at = 0;
  let query: WebGLQuery | null = null;
  renderer.info.autoReset = false; // the composer renders several passes: count the whole frame

  return {
    /** { section: [median, p95] } over the last WINDOW frames. */
    stats: () => Object.fromEntries(Object.keys(samples).map((k) => [k, [+pick(k, 0.5).toFixed(2), +pick(k, 0.95).toFixed(2)]])),
    /** Median of a sample key (ms), undefined before the first sample. */
    median: (key: string) => (samples[key]?.length ? pick(key, 0.5) : undefined),
    /** Forget samples (after a change that invalidates them). */
    reset(...keys: string[]) { for (const k of keys) delete samples[k]; },
    /** Record a sample that isn't a CPU section (e.g. the frame interval). */
    sample: add,
    /** Start of the frame's CPU work. */
    begin() {
      at = performance.now();
      renderer.info.reset();
    },
    /** Close a CPU section (time since the last mark). */
    mark(section: string) {
      const now = performance.now();
      add(section, now - at);
      at = now;
    },
    gpuBegin() {
      if (!timer || pending.length > 3) return;
      query = gl.createQuery();
      gl.beginQuery(timer.TIME_ELAPSED_EXT, query!);
    },
    gpuEnd() {
      if (query) {
        gl.endQuery(timer!.TIME_ELAPSED_EXT);
        pending.push(query);
        query = null;
      }
      while (pending.length && gl.getQueryParameter(pending[0]!, gl.QUERY_RESULT_AVAILABLE)) {
        const q = pending.shift()!;
        if (!gl.getParameter(timer!.GPU_DISJOINT_EXT)) add('gpu', gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(q);
      }
      add('calls', renderer.info.render.calls);
    },
    text() {
      const cpu = Object.keys(samples).filter((k) => !NOT_CPU.has(k));
      return `cpu ${cpu.reduce((s, k) => s + pick(k, 0.5), 0).toFixed(1)} ms · gpu ${pick('gpu', 0.5).toFixed(1)} ms · ${pick('calls', 0.5)} calls`;
    },
  };
}
