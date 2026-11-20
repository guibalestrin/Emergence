// Sanity tests for the simulation core: `npm test`
import { Simulation } from '../src/sim/sim';
import { defaultConfig, TICKS_PER_DAY, Act } from '../src/sim/types';

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}

function fingerprint(sim: Simulation) {
  let h = 0;
  for (const a of sim.agents) h = (h * 31 + a.tile * 7 + Math.round(a.food * 100) + (a.alive ? 1 : 0)) | 0;
  return `${sim.alive.length}:${sim.events.length}:${h}`;
}

function run(seed: number, days: number, setup?: (s: Simulation) => void) {
  const sim = new Simulation(defaultConfig(seed));
  setup?.(sim);
  for (let i = 0; i < days * TICKS_PER_DAY; i++) sim.step();
  return sim;
}

// 1. Determinism: same seed → identical history (required for replay and experiments)
const a = run(42, 20), b = run(42, 20);
check('determinismo (mesma semente → mesma história)', fingerprint(a) === fingerprint(b), fingerprint(a));
const c = run(43, 20);
check('sementes diferentes → histórias diferentes', fingerprint(a) !== fingerprint(c));

// 2. Numerical health
let bad = 0;
for (const ag of a.agents) for (const v of [ag.hunger, ag.thirst, ag.health, ag.food, ag.wood, ag.outlook, ...Object.values(ag.q)]) if (!Number.isFinite(v)) bad++;
check('nenhum valor NaN/infinito', bad === 0);
check('necessidades dentro de [0,1]', a.alive.every((x) => x.hunger >= 0 && x.hunger <= 1 && x.thirst >= 0 && x.thirst <= 1));

// 3. Society survives a normal first year
const year = run(7, 40);
check('sociedade sobrevive ao primeiro ano', year.alive.length > 5, `${year.alive.length} vivos`);
check('agentes constroem abrigos', year.shelters.length > 0, `${year.shelters.length} abrigos`);
check('existe interação social', year.history.some((m) => m.talks > 0) && year.history.some((m) => m.shares + m.trades > 0));

// 4. Interventions have effects
const dry = run(7, 10, (s) => s.setClimate('drought', 10));
check('seca reduz o lençol freático', dry.world.waterTable < 0.7, dry.world.waterTable.toFixed(2));
const fire = new Simulation(defaultConfig(7));
let lit = false;
for (let i = 0; i < fire.world.terrain.length && !lit; i++) if (fire.world.terrain[i] === 3) lit = fire.ignite(i);
for (let i = 0; i < 60; i++) fire.step();
let scorched = 0;
for (let i = 0; i < fire.world.scorch.length; i++) if (fire.world.scorch[i] > 0) scorched++;
check('fogo se espalha', scorched > 9, `${scorched} tiles queimados`);

// 5. Explanations exist for decisions
const ex = run(9, 3);
const withWhy = ex.alive.filter((x) => x.lastChoice.length > 0 && x.lastChoice[0].factors.length > 0).length;
check('decisões têm explicação', withWhy === ex.alive.length);

// 6. Learning flag really disables learning
const nl = new Simulation({ ...defaultConfig(5), flags: { learning: false, gossip: true, knowledgeSharing: true, reproduction: true } });
for (let i = 0; i < 1500; i++) nl.step();
check('ablação de aprendizado mantém valores em zero', nl.agents.every((x) => Object.values(x.q).every((q) => q === 0)));
check('agentes coletam comida', ex.agents.some((x) => x.stats.harvested > 0) && Act.Forage === 'forage');

console.log(failed ? `\n${failed} teste(s) falharam` : '\nTodos os testes passaram');
process.exit(failed ? 1 : 0);
