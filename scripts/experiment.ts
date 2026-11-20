// Command-line experiment runner.
//   npm run experiment                 → list experiments
//   npm run experiment -- gossip       → run one experiment, print table, write CSV to results/
//   npm run experiment -- gossip 10 120 → override seeds and days
import { mkdirSync, writeFileSync } from 'node:fs';
import { EXPERIMENTS, runOne, SUMMARY_FIELDS, meanSd, welch, RunSummary } from '../src/sim/experiment';

const [id, seedsArg, daysArg] = process.argv.slice(2);
const spec = EXPERIMENTS.find((e) => e.id === id);
if (!spec) {
  console.log('Experimentos disponíveis:\n');
  for (const e of EXPERIMENTS) console.log(`  ${e.id.padEnd(10)} ${e.title} — ${e.question}`);
  console.log('\nUso: npm run experiment -- <id> [sementes] [dias]');
  process.exit(0);
}
const seeds = Number(seedsArg ?? spec.seeds);
const days = Number(daysArg ?? spec.days);
console.log(`\n${spec.title}\n${spec.question}\n${seeds} sementes × ${spec.conditions.length} condições × ${days} dias\n`);

const results: RunSummary[] = [];
const t0 = Date.now();
for (const cond of spec.conditions)
  for (let s = 1; s <= seeds; s++) {
    const r = runOne(cond, 1000 + s, days);
    results.push(r);
    process.stdout.write(`  ${cond.name} seed ${1000 + s}: pop ${r.finalPop}, roubos ${r.thefts}, doações ${r.shares}\n`);
  }

console.log(`\nResultados (média ± desvio padrão)  [${((Date.now() - t0) / 1000).toFixed(1)}s]\n`);
const header = 'Métrica'.padEnd(28) + spec.conditions.map((c) => c.name.padStart(22)).join('');
console.log(header);
for (const f of SUMMARY_FIELDS) {
  let line = f.label.padEnd(28);
  for (const c of spec.conditions) {
    const xs = results.filter((r) => r.condition === c.name).map((r) => r[f.key] as number);
    const { mean, sd } = meanSd(xs);
    line += `${mean.toFixed(f.digits)} ± ${sd.toFixed(f.digits)}`.padStart(22);
  }
  if (spec.conditions.length === 2) {
    const a = results.filter((r) => r.condition === spec.conditions[0].name).map((r) => r[f.key] as number);
    const b = results.filter((r) => r.condition === spec.conditions[1].name).map((r) => r[f.key] as number);
    const t = welch(a, b);
    line += `   t=${t.toFixed(1)}${Math.abs(t) > 2.2 ? ' *' : ''}`;
  }
  console.log(line);
}
if (spec.conditions.length === 2) console.log('\n* |t| > 2.2: diferença provavelmente maior que a variação entre sementes');

mkdirSync('results', { recursive: true });
const cols = ['condition', 'seed', ...SUMMARY_FIELDS.map((f) => f.key)];
const csv = [cols.join(','), ...results.map((r) => cols.map((c) => (r as any)[c]).join(','))].join('\n');
const file = `results/${spec.id}-${Date.now()}.csv`;
writeFileSync(file, csv);
console.log(`\nCSV salvo em ${file}`);
