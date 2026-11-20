import { Simulation, DayMetrics } from './sim';
import { SimConfig, SimFlags, TICKS_PER_DAY, defaultConfig, DEFAULT_FLAGS } from './types';

/**
 * Batch experiments: the same world-generation procedure run many times under
 * controlled conditions, so differences can be attributed to the manipulated
 * variable rather than to luck. Shared by the in-app lab (Web Worker) and the
 * command-line runner (scripts/experiment.ts).
 */

export interface Condition {
  name: string;
  abundance?: number;
  flags?: Partial<SimFlags>;
  /** Optional scheduled shock, e.g. a drought on day 40. */
  shock?: { day: number; kind: 'drought' | 'deluge'; days: number };
  harshWinter?: boolean;
}

export interface ExperimentSpec {
  id: string;
  title: string;
  question: string;
  conditions: Condition[];
  seeds: number;
  days: number;
}

export interface RunSummary {
  condition: string;
  seed: number;
  survived: boolean;
  finalPop: number;
  peakPop: number;
  births: number;
  deaths: number;
  meanGini: number;
  thefts: number;
  shares: number;
  trades: number;
  coop: number; // overall cooperation index
  finalTrust: number;
  finalOutlook: number;
  meanGroups: number;
  finalLargestGroup: number;
  popSeries: number[];
  trustSeries: number[];
  giniSeries: number[];
}

export const EXPERIMENTS: ExperimentSpec[] = [
  {
    id: 'scarcity',
    title: 'Escassez × Cooperação',
    question: 'Como a quantidade de recursos naturais afeta cooperação, conflito e desigualdade?',
    conditions: [
      { name: 'Escasso (0.6×)', abundance: 0.6 },
      { name: 'Normal (1×)', abundance: 1 },
      { name: 'Abundante (1.6×)', abundance: 1.6 },
    ],
    seeds: 5,
    days: 96,
  },
  {
    id: 'gossip',
    title: 'O papel da fofoca',
    question: 'Reputação transmitida por conversa reduz o roubo? (ablação do mecanismo de fofoca)',
    conditions: [
      { name: 'Com fofoca', flags: { gossip: true } },
      { name: 'Sem fofoca', flags: { gossip: false } },
    ],
    seeds: 6,
    days: 96,
  },
  {
    id: 'learning',
    title: 'Aprender com a experiência',
    question: 'O que muda quando os agentes NÃO aprendem com os resultados de suas ações?',
    conditions: [
      { name: 'Com aprendizado', flags: { learning: true } },
      { name: 'Sem aprendizado', flags: { learning: false } },
    ],
    seeds: 6,
    days: 96,
  },
  {
    id: 'knowledge',
    title: 'Conhecimento compartilhado',
    question: 'Contar aos outros onde há comida aumenta a sobrevivência?',
    conditions: [
      { name: 'Compartilham locais', flags: { knowledgeSharing: true } },
      { name: 'Não compartilham', flags: { knowledgeSharing: false } },
    ],
    seeds: 6,
    days: 96,
  },
  {
    id: 'drought',
    title: 'Choque de seca',
    question: 'Como a sociedade responde a uma seca de 16 dias antes do inverno?',
    conditions: [
      { name: 'Sem seca' },
      { name: 'Seca no dia 40', shock: { day: 40, kind: 'drought', days: 16 } },
    ],
    seeds: 6,
    days: 96,
  },
];

export function configFor(cond: Condition, seed: number): SimConfig {
  const c = defaultConfig(seed);
  c.abundance = cond.abundance ?? 1;
  c.flags = { ...DEFAULT_FLAGS, ...(cond.flags ?? {}) };
  return c;
}

export function runOne(cond: Condition, seed: number, days: number, onDay?: (d: number) => void): RunSummary {
  const sim = new Simulation(configFor(cond, seed));
  if (cond.harshWinter) sim.setHarshWinter(true);
  for (let d = 0; d < days; d++) {
    if (cond.shock && d === cond.shock.day) sim.setClimate(cond.shock.kind, cond.shock.days);
    for (let t = 0; t < TICKS_PER_DAY; t++) sim.step();
    onDay?.(d);
    if (sim.alive.length === 0) break;
  }
  return summarize(cond.name, seed, sim.history);
}

export function summarize(condition: string, seed: number, h: DayMetrics[]): RunSummary {
  const sum = (f: (m: DayMetrics) => number) => h.reduce((s, m) => s + f(m), 0);
  const last = h[h.length - 1];
  const shares = sum((m) => m.shares), thefts = sum((m) => m.thefts), trades = sum((m) => m.trades);
  const living = h.filter((m) => m.pop > 1);
  return {
    condition,
    seed,
    survived: last.pop > 0,
    finalPop: last.pop,
    peakPop: Math.max(...h.map((m) => m.pop)),
    births: sum((m) => m.births),
    deaths: sum((m) => m.deaths),
    meanGini: living.length ? living.reduce((s, m) => s + m.gini, 0) / living.length : 0,
    thefts,
    shares,
    trades,
    coop: shares + trades + thefts ? (shares + trades) / (shares + trades + thefts) : 0,
    finalTrust: last.trust,
    finalOutlook: last.outlook,
    meanGroups: living.length ? living.reduce((s, m) => s + m.groups, 0) / living.length : 0,
    finalLargestGroup: last.largestGroup,
    popSeries: h.map((m) => m.pop),
    trustSeries: h.map((m) => m.trust),
    giniSeries: h.map((m) => m.gini),
  };
}

export const SUMMARY_FIELDS: { key: keyof RunSummary; label: string; digits: number }[] = [
  { key: 'finalPop', label: 'População final', digits: 1 },
  { key: 'deaths', label: 'Mortes', digits: 1 },
  { key: 'births', label: 'Nascimentos', digits: 1 },
  { key: 'meanGini', label: 'Desigualdade (Gini médio)', digits: 2 },
  { key: 'shares', label: 'Doações', digits: 0 },
  { key: 'thefts', label: 'Roubos', digits: 1 },
  { key: 'trades', label: 'Trocas', digits: 1 },
  { key: 'coop', label: 'Índice de cooperação', digits: 2 },
  { key: 'finalTrust', label: 'Confiança final', digits: 2 },
  { key: 'finalOutlook', label: 'Confiança em estranhos', digits: 2 },
  { key: 'meanGroups', label: 'Grupos (média)', digits: 1 },
];

export function meanSd(xs: number[]) {
  const n = xs.length;
  const m = xs.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, n - 1);
  return { mean: m, sd: Math.sqrt(v) };
}

/** Welch's t statistic — a simple, honest indicator of whether a difference is larger than run-to-run noise. */
export function welch(a: number[], b: number[]) {
  const A = meanSd(a), B = meanSd(b);
  const se = Math.sqrt(A.sd ** 2 / Math.max(1, a.length) + B.sd ** 2 / Math.max(1, b.length));
  return se > 0 ? (A.mean - B.mean) / se : 0;
}
