import type { Simulation } from './sim';
import type { Agent } from './agent';
import { Act } from './types';

/**
 * Pattern detectors. Nothing here influences the simulation: these functions
 * only *measure* the current society and describe, in plain language, patterns
 * that no rule creates directly. Each insight carries the evidence (numbers,
 * agents) so the observer can check it.
 */
export interface Insight {
  icon: string;
  title: string;
  text: string;
  agents: number[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function detectInsights(sim: Simulation): Insight[] {
  const out: Insight[] = [];
  const al = sim.alive.filter((a) => a.isAdult(sim.tick));
  if (al.length < 4) return out;

  // 1. Inequality and what distinguishes the rich
  const wealth = (a: Agent) => a.wealth((sim.homeOf(a)?.food ?? 0) / Math.max(1, sim.homeOf(a)?.owners.length ?? 1));
  const sorted = [...al].sort((a, b) => wealth(b) - wealth(a));
  const total = sorted.reduce((s, a) => s + wealth(a), 0);
  const k = Math.max(1, Math.round(sorted.length * 0.2));
  const top = sorted.slice(0, k), rest = sorted.slice(k);
  const share = total > 0 ? top.reduce((s, a) => s + wealth(a), 0) / total : 0;
  if (share > 0.38 && rest.length) {
    const dil = [mean(top.map((a) => a.traits.diligence)), mean(rest.map((a) => a.traits.diligence))];
    const sk = [mean(top.map((a) => a.skills.forage)), mean(rest.map((a) => a.skills.forage))];
    const st = [mean(top.map((a) => a.stats.stolen)), mean(rest.map((a) => a.stats.stolen))];
    const reasons: string[] = [];
    if (dil[0] - dil[1] > 0.08) reasons.push(`são mais diligentes (${dil[0].toFixed(2)} vs ${dil[1].toFixed(2)})`);
    if (sk[0] - sk[1] > 0.05) reasons.push(`têm mais habilidade de coleta (${sk[0].toFixed(2)} vs ${sk[1].toFixed(2)})`);
    if (st[0] > st[1] * 1.5 && st[0] > 2) reasons.push(`roubaram mais (${st[0].toFixed(1)} vs ${st[1].toFixed(1)} em média)`);
    if (top.filter((a) => a.home >= 0).length / top.length > rest.filter((a) => a.home >= 0).length / rest.length + 0.2) reasons.push('têm abrigo com estoque com mais frequência');
    out.push({
      icon: '⚖️',
      title: 'Concentração de riqueza',
      text: `Os 20% mais ricos detêm ${pct(share)} da riqueza.${reasons.length ? ` Em média, eles ${reasons.join(', ')}.` : ' Nenhum traço explica sozinho — pode ser sorte de localização.'}`,
      agents: top.slice(0, 4).map((a) => a.id),
    });
  }

  // 2. Reputation spread by gossip: distrust from people never harmed directly
  let worst: { a: Agent; n: number; hearsay: number } | null = null;
  for (const a of sim.alive) {
    let n = 0, hearsay = 0;
    for (const b of sim.alive) {
      const r = b.rel.get(a.id);
      if (!r || r.trust > -0.3) continue;
      n++;
      if (r.taken === 0) hearsay++;
    }
    if (n >= 3 && (!worst || n > worst.n)) worst = { a, n, hearsay };
  }
  if (worst) {
    out.push({
      icon: '🗣️',
      title: 'Má reputação',
      text: `${worst.a.name} é visto(a) com desconfiança por ${worst.n} pessoas${worst.hearsay ? ` — ${worst.hearsay} delas nunca foram roubadas por ele(a): souberam por testemunho ou fofoca` : ''}. Roubou ${worst.a.stats.stolen} no total e foi pego(a) ${worst.a.stats.caught}×.`,
      agents: [worst.a.id],
    });
  }

  // 3. Learned strategies around theft
  const thieves = al.filter((a) => a.q.steal > 0.12);
  const reformed = al.filter((a) => a.stats.caught > 0 && a.q.steal < -0.15);
  if (thieves.length || reformed.length) {
    out.push({
      icon: '🎲',
      title: 'Estratégias aprendidas',
      text: `${thieves.length ? `${thieves.length} indivíduo(s) aprenderam que roubar compensa (raramente foram pegos). ` : ''}${reformed.length ? `${reformed.length} foram pegos e passaram a evitar o roubo.` : ''} Ninguém foi programado como "ladrão": isso vem da experiência.`,
      agents: [...thieves.slice(0, 3), ...reformed.slice(0, 2)].map((a) => a.id),
    });
  }

  // 4. Division of labour
  const frac = (a: Agent, act: Act) => (a.recentLabor.length >= 10 ? a.recentLabor.filter((x) => x === act).length / a.recentLabor.length : -1);
  const woodcutters = al.filter((a) => frac(a, Act.Chop) > 0.55);
  const foragers = al.filter((a) => frac(a, Act.Forage) > 0.9);
  if (woodcutters.length >= 2 && foragers.length >= 2) {
    out.push({
      icon: '🪓',
      title: 'Divisão do trabalho',
      text: `${woodcutters.length} indivíduos se especializaram em lenha e ${foragers.length} quase só coletam comida. A habilidade cresce com a prática, e a prática é reforçada pelo retorno maior — um ciclo que gera especialização.`,
      agents: [...woodcutters.slice(0, 3), ...foragers.slice(0, 2)].map((a) => a.id),
    });
  }

  // 5. Reciprocity
  let pairs = 0;
  const pairAgents: number[] = [];
  for (const a of sim.alive)
    for (const [id, r] of a.rel) {
      if (id <= a.id || r.gaveTo <= 0 || r.given <= 0 || a.kin.has(id)) continue;
      pairs++;
      if (pairAgents.length < 4) pairAgents.push(a.id, id);
    }
  if (pairs > 0) {
    out.push({
      icon: '🤝',
      title: 'Reciprocidade',
      text: `${pairs} par(es) de não-parentes já se ajudaram mutuamente com comida. Quem recebe ajuda passa a confiar mais — e tende a retribuir.`,
      agents: pairAgents,
    });
  }

  // 6. Shared homes between non-kin
  const mixed = sim.shelters.filter((s) => s.alive && s.owners.length >= 2 && s.owners.some((o, i) => s.owners.slice(i + 1).some((p) => !sim.byId.get(o)?.kin.has(p))));
  if (mixed.length) {
    out.push({
      icon: '🏘️',
      title: 'Lares por afinidade',
      text: `${mixed.length} abrigo(s) são compartilhados por indivíduos que não são parentes — escolheram morar juntos por confiança mútua.`,
      agents: mixed.slice(0, 3).flatMap((s) => s.owners.slice(0, 2)),
    });
  }

  // 7. Erosion of generalized trust
  const disillusioned = al.filter((a) => a.outlookHistory.length > 10 && a.outlookHistory[0] - a.outlook > 0.2);
  if (disillusioned.length >= 2) {
    out.push({
      icon: '🌫️',
      title: 'Desconfiança crescente',
      text: `${disillusioned.length} indivíduos confiam bem menos em estranhos do que antes — após serem roubados ou recusados. A confiança social é moldada pela história, não fixada.`,
      agents: disillusioned.slice(0, 4).map((a) => a.id),
    });
  }

  // 8. Crisis response (after a shock)
  const h = sim.history;
  const lastShock = sim.interventions.filter((i) => /Seca|incêndio|doença/i.test(i.label)).pop();
  if (lastShock && h.length > 4) {
    const day = Math.floor(lastShock.tick / 100);
    const before = h.filter((m) => m.day < day && m.day >= day - 6);
    const after = h.filter((m) => m.day >= day);
    if (before.length >= 3 && after.length >= 3) {
      const coop = (arr: typeof h) => {
        const s = arr.reduce((x, m) => x + m.shares + m.trades, 0), t = arr.reduce((x, m) => x + m.thefts, 0);
        return { help: s / arr.length, theft: t / arr.length };
      };
      const b = coop(before), a = coop(after);
      out.push({
        icon: '📉',
        title: `Reação a: ${lastShock.label}`,
        text: `Antes: ${b.help.toFixed(1)} ajudas e ${b.theft.toFixed(1)} roubos por dia. Depois: ${a.help.toFixed(1)} ajudas e ${a.theft.toFixed(1)} roubos por dia. Gini ${mean(before.map((m) => m.gini)).toFixed(2)} → ${mean(after.map((m) => m.gini)).toFixed(2)}.`,
        agents: [],
      });
    }
  }
  return out;
}
