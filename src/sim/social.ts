import type { Simulation } from './sim';
import type { Agent } from './agent';
import { RNG } from './rng';

/**
 * Groups are NOT a rule of the simulation. Agents never "join a group".
 * Groups are *measured*: clusters of agents connected by strong mutual trust.
 * If they appear, they appear because of who helped whom, who stole from whom,
 * who talked to whom and what was said about third parties.
 */
export interface Group {
  id: number;
  name: string;
  hue: number;
  members: number[];
  founded: number;
  peak: number;
}

export const GROUP_TRUST = 0.38;

export function mutualTrust(a: Agent, b: Agent) {
  const ra = a.rel.get(b.id), rb = b.rel.get(a.id);
  if (!ra || !rb) return -1;
  if (ra.fam < 0.12 || rb.fam < 0.12) return -1;
  return Math.min(ra.trust, rb.trust);
}

const GROUP_ROOTS = ['Vel', 'Oru', 'Tam', 'Isk', 'Bera', 'Nol', 'Quen', 'Saru', 'Dax', 'Lumi', 'Kor', 'Ema', 'Yth', 'Pal'];
const GROUP_SUFFIX = ['ar', 'enos', 'ita', 'unde', 'ai', 'oth', 'eri', 'anos'];

export function detectGroups(sim: Simulation, prev: Group[], rng: RNG): Group[] {
  const alive = sim.alive;
  const n = alive.length;
  const parent = alive.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (mutualTrust(alive[i], alive[j]) > GROUP_TRUST) parent[find(i)] = find(j);
    }
  const comps = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!comps.has(r)) comps.set(r, []);
    comps.get(r)!.push(alive[i].id);
  }
  const clusters = [...comps.values()].filter((c) => c.length >= 3).sort((a, b) => b.length - a.length);

  // match clusters to previous groups by overlap so identities persist
  const used = new Set<number>();
  const result: Group[] = [];
  for (const members of clusters) {
    let best: Group | null = null, bj = 0.25;
    const set = new Set(members);
    for (const g of prev) {
      if (used.has(g.id)) continue;
      const inter = g.members.filter((m) => set.has(m)).length;
      const jac = inter / (g.members.length + members.length - inter);
      if (jac > bj) { bj = jac; best = g; }
    }
    if (best) {
      used.add(best.id);
      result.push({ ...best, members, peak: Math.max(best.peak, members.length) });
    } else {
      const id = sim.nextGroupId++;
      const name = rng.pick(GROUP_ROOTS) + rng.pick(GROUP_SUFFIX);
      const g: Group = { id, name, hue: (id * 137.5 + 20) % 360, members, founded: sim.tick, peak: members.length };
      result.push(g);
      sim.log('group', `Surgiu um grupo coeso: os ${name} (${members.length} membros, unidos por confiança mútua)`, members.slice(0, 6));
    }
  }
  for (const g of prev) {
    if (!used.has(g.id)) {
      const survivors = g.members.filter((m) => sim.byId.get(m)?.alive).length;
      sim.log('group', `Os ${g.name} se dispersaram (${survivors} sobreviventes) — os laços de confiança se romperam`, g.members.slice(0, 6));
    }
  }
  for (const a of alive) a.group = -1;
  for (const g of result) for (const m of g.members) { const a = sim.byId.get(m); if (a) a.group = g.id; }
  return result;
}

export function gini(values: number[]) {
  const v = values.filter((x) => x >= 0).sort((a, b) => a - b);
  const n = v.length;
  if (n < 2) return 0;
  let sum = 0, cum = 0;
  for (let i = 0; i < n; i++) { sum += v[i]; cum += (i + 1) * v[i]; }
  if (sum <= 0) return 0;
  return (2 * cum) / (n * sum) - (n + 1) / n;
}
