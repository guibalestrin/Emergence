// Runs batch experiments off the main thread so the live world keeps running.
import { EXPERIMENTS, runOne, RunSummary } from '../sim/experiment';

self.onmessage = (e: MessageEvent) => {
  const { id, seeds, days } = e.data as { id: string; seeds: number; days: number };
  const spec = EXPERIMENTS.find((x) => x.id === id)!;
  const total = spec.conditions.length * seeds;
  const results: RunSummary[] = [];
  let done = 0;
  for (let s = 1; s <= seeds; s++)
    for (const cond of spec.conditions) {
      const r = runOne(cond, 1000 + s, days, (d) => {
        if (d % 8 === 0) (self as any).postMessage({ type: 'progress', value: (done + d / days) / total, label: `${cond.name} · semente ${1000 + s}` });
      });
      results.push(r);
      done++;
      (self as any).postMessage({ type: 'progress', value: done / total, label: `${cond.name} · semente ${1000 + s}` });
    }
  (self as any).postMessage({ type: 'done', results });
};
