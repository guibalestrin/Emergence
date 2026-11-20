import type { Simulation } from '../sim/sim';
import type { Agent } from '../sim/agent';
import { ACT_LABEL, Act, LEARNED_ACTS, TRAIT_LABEL, Traits, TICKS_PER_DAY, Candidate, clamp } from '../sim/types';
import { temperamentColor, groupColor } from './renderer';
import { sparkline } from './charts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const pct = (v: number) => `${Math.round(v * 100)}`;

const Q_LABEL: Record<string, string> = {
  [Act.Forage]: 'Coletar',
  [Act.Explore]: 'Explorar',
  [Act.Chop]: 'Cortar lenha',
  [Act.Socialize]: 'Conversar',
  [Act.Share]: 'Doar',
  [Act.Ask]: 'Pedir',
  [Act.Steal]: 'Roubar',
  [Act.Trade]: 'Trocar',
  [Act.Deposit]: 'Estocar',
};

export interface PanelHost {
  select(id: number | null, center?: boolean): void;
  follow: boolean;
  setFollow(v: boolean): void;
}

function meter(label: string, v: number, color: string, text = pct(v)) {
  return `<label>${label}</label><div class="m"><i style="width:${(clamp(v) * 100).toFixed(0)}%;background:${color}"></i></div><span class="v">${text}</span>`;
}
function needColor(v: number) {
  return v > 0.75 ? '#e2665c' : v > 0.5 ? '#e8b04a' : '#5fd0a5';
}
function fbar(v: number, scale = 1) {
  const w = Math.min(50, (Math.abs(v) / scale) * 50);
  return `<div class="fbar"><i class="${v >= 0 ? 'pos' : 'neg'}" style="width:${w.toFixed(1)}%"></i></div>`;
}
function dayOf(tick: number) {
  return `d${Math.floor(tick / TICKS_PER_DAY)}`;
}

export class AgentPanel {
  private head: HTMLElement;
  private dyn: HTMLElement;
  private traitsEl: HTMLElement;
  private rest: HTMLElement;
  private actions: HTMLElement;
  private agentId: number | null = null;
  private editing = false;
  private expanded = 0;
  private lastChoiceTick = -1;

  constructor(root: HTMLElement, private host: PanelHost, private getSim: () => Simulation) {
    root.innerHTML = `<div data-k="head"></div><div data-k="dyn"></div><div data-k="traits"></div><div data-k="rest"></div><div data-k="actions"></div>`;
    this.head = root.querySelector('[data-k=head]')!;
    this.dyn = root.querySelector('[data-k=dyn]')!;
    this.traitsEl = root.querySelector('[data-k=traits]')!;
    this.rest = root.querySelector('[data-k=rest]')!;
    this.actions = root.querySelector('[data-k=actions]')!;
    root.addEventListener('pointerdown', (e) => this.onPointer(e));
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('input', (e) => this.onInput(e));
  }

  setAgent(id: number | null) {
    if (id !== this.agentId) {
      this.agentId = id;
      this.editing = false;
      this.expanded = 0;
      this.lastChoiceTick = -1;
      this.renderTraits();
      this.renderActions();
    }
  }

  private agent(): Agent | undefined {
    return this.agentId !== null ? this.getSim().byId.get(this.agentId) : undefined;
  }

  // links/candidates use pointerdown: their DOM is refreshed several times per second
  private onPointer(e: Event) {
    const t = e.target as HTMLElement;
    const agentLink = t.closest('[data-agent]') as HTMLElement | null;
    if (agentLink) { this.host.select(Number(agentLink.dataset.agent), true); return; }
    const cand = t.closest('[data-cand]') as HTMLElement | null;
    if (cand) { const k = Number(cand.dataset.cand); this.expanded = this.expanded === k ? -1 : k; this.lastChoiceTick = -1; this.update(); }
  }

  private onClick(e: Event) {
    const t = e.target as HTMLElement;
    const sim = this.getSim();
    const act = (t.closest('[data-action]') as HTMLElement | null)?.dataset.action;
    const a = this.agent();
    if (!act || !a) return;
    switch (act) {
      case 'edit': this.editing = !this.editing; this.renderTraits(); this.renderActions(); break;
      case 'follow': this.host.setFollow(!this.host.follow); this.renderActions(); break;
      case 'amnesia':
        a.rel.clear(); a.foodMem.clear(); a.journal = []; a.outlook = 0.15;
        for (const k of LEARNED_ACTS) a.q[k] = 0;
        a.remember(sim.tick, 'Perdi todas as memórias (intervenção)', 0);
        sim.intervene(`amnésia aplicada a ${a.name}`);
        break;
      case 'infect': if (sim.infect(a)) sim.intervene(`${a.name} foi infectado(a)`); break;
      case 'feed': a.food += 5; sim.intervene(`5 de comida dados a ${a.name}`); break;
      case 'exile': sim.intervene(`${a.name} foi exilado(a)`); sim.remove(a); this.host.select(null); break;
    }
    this.update();
  }

  private onInput(e: Event) {
    const t = e.target as HTMLInputElement;
    const key = t.dataset.trait as keyof Traits | undefined;
    const a = this.agent();
    if (!key || !a) return;
    a.traits[key] = Number(t.value) / 100;
    const v = t.parentElement?.nextElementSibling;
    if (v) v.textContent = t.value;
  }
  /** called on 'change' (slider released) to log the intervention once */
  commitEdit() {
    const a = this.agent();
    if (a) this.getSim().intervene(`personalidade de ${a.name} alterada`);
  }

  private renderTraits() {
    const a = this.agent();
    if (!a) { this.traitsEl.innerHTML = ''; return; }
    const keys = Object.keys(TRAIT_LABEL) as (keyof Traits)[];
    this.traitsEl.innerHTML = `<h3>Personalidade <button class="btn small" data-action="edit">${this.editing ? 'concluir' : 'editar'}</button></h3>
      <div class="meters">${keys
        .map((k) =>
          this.editing
            ? `<label>${TRAIT_LABEL[k]}</label><div><input type="range" min="0" max="100" value="${pct(a.traits[k])}" data-trait="${k}"></div><span class="v">${pct(a.traits[k])}</span>`
            : meter(TRAIT_LABEL[k], a.traits[k], '#8fa3c0'),
        )
        .join('')}</div>`;
    if (this.editing) this.traitsEl.querySelectorAll('input').forEach((i) => i.addEventListener('change', () => this.commitEdit()));
  }

  private renderActions() {
    const a = this.agent();
    if (!a || !a.alive) { this.actions.innerHTML = ''; return; }
    this.actions.innerHTML = `<h3>Intervir neste indivíduo</h3><div class="row">
      <button class="btn small" data-action="follow">${this.host.follow ? 'parar de seguir' : 'seguir com a câmera'}</button>
      <button class="btn small" data-action="feed">dar comida</button>
      <button class="btn small" data-action="infect">infectar</button>
      <button class="btn small" data-action="amnesia" title="Apaga relações, memórias e aprendizado">amnésia</button>
      <button class="btn small danger" data-action="exile">exilar</button></div>`;
  }

  update() {
    const sim = this.getSim();
    const a = this.agent();
    if (!a) { this.renderEmpty(sim); return; }
    const group = sim.groups.find((g) => g.id === a.group);
    const home = sim.homeOf(a);
    const age = a.age(a.alive ? sim.tick : a.deathTick);
    this.head.innerHTML = `<h2><span class="swatch" style="background:${temperamentColor(a)};${group ? `box-shadow:0 0 0 2px ${groupColor(group.hue)}` : ''}"></span>${esc(a.name)}
        ${group ? `<span class="badge" style="color:${groupColor(group.hue)}">${esc(group.name)}</span>` : ''}</h2>
      <div class="sub">${age.toFixed(1)} anos${age < 1.5 ? ' (criança)' : ''} · ${home ? `mora em um abrigo com ${home.owners.length - 1} outro(s)` : 'sem abrigo'}${a.parents.length ? ` · filho(a) de ${a.parents.map((p) => `<a data-agent="${p}">${esc(sim.byId.get(p)?.name ?? '?')}</a>`).join(' e ')}` : ''}</div>`;

    if (!a.alive) {
      this.dyn.innerHTML = `<div class="doing"><div class="now">✝ Morreu de <b>${esc(a.deathCause)}</b> no ${dayOf(a.deathTick)}</div></div>`;
    } else {
      const it = a.intent;
      const chosen = a.lastChoice;
      if (a.lastChoiceTick !== this.lastChoiceTick || !this.dyn.innerHTML) {
        this.lastChoiceTick = a.lastChoiceTick;
        const max = Math.max(0.05, ...chosen.map((c) => c.score));
        this.dyn.innerHTML = `<div class="doing"><div class="now">Agora: <b>${esc(it?.label ?? ACT_LABEL[Act.Idle])}</b></div>
          <div class="sub">Decidiu há ${sim.tick - a.lastChoiceTick} ticks. Por quê? Opções que considerou (clique para ver os fatores):</div>
          <div class="why">${chosen.map((c, k) => this.candHtml(c, k, max)).join('')}</div></div>`;
      } else {
        const now = this.dyn.querySelector('.now b');
        if (now) now.textContent = it?.label ?? ACT_LABEL[Act.Idle];
        const sub = this.dyn.querySelector('.sub');
        if (sub) sub.textContent = `Decidiu há ${sim.tick - a.lastChoiceTick} ticks. Por quê? Opções que considerou (clique para ver os fatores):`;
      }
    }

    if (!this.editing) this.renderTraits();

    const relRows = [...a.rel.entries()]
      .filter(([id, r]) => r.fam > 0.06 && sim.byId.get(id))
      .sort((x, y) => y[1].trust - x[1].trust);
    const friends = relRows.slice(0, 6);
    const foes = relRows.filter(([, r]) => r.trust < -0.1).slice(-4).reverse();
    const relHtml = (rows: typeof relRows) =>
      rows
        .map(([id, r]) => {
          const b = sim.byId.get(id)!;
          const notes = [a.kin.has(id) ? 'família' : '', r.given ? `me deu ${Math.round(r.given)}` : '', r.taken ? `me roubou ${Math.round(r.taken)}` : '', !b.alive ? 'falecido' : '']
            .filter(Boolean)
            .join(' · ');
          return `<div class="rel" data-agent="${id}"><span class="swatch" style="background:${temperamentColor(b)};width:10px;height:10px;${b.alive ? '' : 'opacity:.35'}"></span>
            <span class="who">${esc(b.name)} <span class="note">${notes}</span></span>${fbar(r.trust)}<span class="v" style="font-family:var(--mono);font-size:11px;color:var(--muted);text-align:right">${r.trust >= 0 ? '+' : ''}${r.trust.toFixed(2)}</span></div>`;
        })
        .join('');

    this.rest.innerHTML = `
      <h3>Necessidades e saúde</h3>
      <div class="meters">
        ${meter('Fome', a.hunger, needColor(a.hunger))}
        ${meter('Sede', a.thirst, needColor(a.thirst))}
        ${meter('Cansaço', a.fatigue, needColor(a.fatigue))}
        ${meter('Frio', a.cold, needColor(a.cold))}
        ${meter('Solidão', a.loneliness, needColor(a.loneliness))}
        ${meter('Saúde', a.health, a.health < 0.4 ? '#e2665c' : '#79a7ff')}
      </div>
      ${a.sick > 0 ? `<div class="sub" style="color:#9be05a">🦠 doente (${a.sick} ticks restantes)</div>` : ''}
      <h3>Posses</h3>
      <div class="inv"><span>🍓 comida <b>${a.food.toFixed(1)}</b></span><span>🪵 lenha <b>${a.wood.toFixed(1)}</b></span>
        ${home ? `<span>🏠 estoque <b>${home.food.toFixed(0)}</b> comida · <b>${home.wood.toFixed(0)}</b> lenha</span>` : ''}</div>
      <h3>Estratégias aprendidas <span class="badge" title="Valor esperado aprendido pela própria experiência; multiplica a atratividade da ação">−1 … +1</span></h3>
      <div class="qbars">${LEARNED_ACTS.map((k) => `<label>${Q_LABEL[k]}</label>${fbar(a.q[k], 0.6)}<span class="v" style="font-family:var(--mono);font-size:11px;color:var(--muted);text-align:right">${a.q[k] >= 0 ? '+' : ''}${a.q[k].toFixed(2)}</span>`).join('')}</div>
      <h3>Habilidades</h3>
      <div class="meters">${meter('Coleta', a.skills.forage, '#e0546f')}${meter('Lenha', a.skills.wood, '#b7834f')}${meter('Construção', a.skills.build, '#cdb68a')}</div>
      <h3>Confiança em estranhos <span class="badge">${a.outlook >= 0 ? '+' : ''}${a.outlook.toFixed(2)}</span></h3>
      <canvas class="spark" data-k="spark"></canvas>
      <div class="sub">Visão de mundo moldada pela experiência: cai quando é roubado, sobe quando recebe ajuda de quem não é família.</div>
      <h3>Relações (${relRows.length} conhecidos)</h3>
      <div class="rels">${relHtml(friends) || '<div class="empty">ainda não conhece ninguém</div>'}</div>
      ${foes.length ? `<h3>Desafetos</h3><div class="rels">${relHtml(foes)}</div>` : ''}
      <h3>Memórias marcantes</h3>
      <ul class="journal">${a.journal.slice(-12).reverse().map((m) => `<li class="${m.valence > 0.15 ? 'pos' : m.valence < -0.15 ? 'neg' : ''}"><time>${dayOf(m.tick)}</time>${esc(m.text)}</li>`).join('') || '<li>nada ainda</li>'}</ul>
      <h3>Histórico</h3>
      <div class="sub">Coletou ${a.stats.harvested.toFixed(0)} · doou ${a.stats.given} · recebeu ${a.stats.received} · roubou ${a.stats.stolen} (pego ${a.stats.caught}×) · foi roubado ${a.stats.victim} · trocas ${a.stats.trades} · conversas ${a.stats.talks} · filhos ${a.children.length}</div>`;
    const sp = this.rest.querySelector('[data-k=spark]') as HTMLCanvasElement;
    if (sp) sparkline(sp, a.outlookHistory, -1, 1, '#c9b2f5');
    if (!a.alive) this.actions.innerHTML = '';
  }

  private candHtml(c: Candidate, k: number, max: number) {
    const open = k === this.expanded;
    const fmax = Math.max(0.2, ...c.factors.map((f) => Math.abs(f.value)));
    return `<div class="cand ${k === 0 ? 'chosen' : ''}" data-cand="${k}"><span class="name">${k === 0 ? '▸ ' : ''}${esc(c.label)}</span>
        <div class="bar"><i style="width:${Math.max(2, (c.score / max) * 100).toFixed(0)}%"></i></div><span class="num">${c.score.toFixed(2)}</span></div>
      ${open ? `<div class="factors">${c.factors.filter((f) => Math.abs(f.value) > 0.004).map((f) => `<div class="factor"><span>${esc(f.label)} <span style="font-family:var(--mono);font-size:10.5px">${f.value >= 0 ? '+' : ''}${f.value.toFixed(2)}</span></span>${fbar(f.value, fmax)}</div>`).join('')}
        ${c.learned !== 1 ? `<div class="learned">× ${c.learned.toFixed(2)} pelo que aprendeu com experiências anteriores</div>` : ''}</div>` : ''}`;
  }

  private renderEmpty(sim: Simulation) {
    this.traitsEl.innerHTML = '';
    this.actions.innerHTML = '';
    this.dyn.innerHTML = '';
    const al = sim.alive;
    const by = (f: (a: Agent) => number) => (al.length ? al.reduce((b, a) => (f(a) > f(b) ? a : b)) : null);
    const rows: [string, Agent | null, string][] = [
      ['Mais rico', by((a) => a.wealth(sim.homeOf(a)?.food ?? 0)), 'maior riqueza (comida, lenha, estoque)'],
      ['Mais generoso', by((a) => a.stats.given), 'mais comida doada'],
      ['Mais conectado', by((a) => [...a.rel.values()].filter((r) => r.trust > 0.4).length), 'mais laços de confiança'],
      ['Maior ladrão', by((a) => a.stats.stolen), 'mais comida roubada'],
      ['Mais desconfiado', by((a) => -a.outlook), 'menor confiança em estranhos'],
      ['Mais velho', by((a) => a.age(sim.tick)), 'maior idade'],
    ];
    this.head.innerHTML = `<div class="empty"><p><b>Clique em qualquer indivíduo</b> no mapa para ver quem ele é, o que está fazendo e <b>por que tomou essa decisão</b>.</p>
      <p>Ou comece por alguém notável:</p></div>
      <div class="notables">${rows
        .filter(([, a]) => a)
        .map(([k, a, d]) => `<div class="notable" data-agent="${a!.id}" title="${d}"><span class="swatch" style="background:${temperamentColor(a!)}"></span><div><div class="k">${k}</div><div class="n">${esc(a!.name)}</div></div></div>`)
        .join('')}</div>`;
    this.rest.innerHTML = '';
  }
}

export class SocietyPanel {
  constructor(private root: HTMLElement, host: PanelHost) {
    root.addEventListener('pointerdown', (e) => {
      const el = (e.target as HTMLElement).closest('[data-agent]') as HTMLElement | null;
      if (el) host.select(Number(el.dataset.agent), true);
    });
  }

  update(sim: Simulation) {
    const h = sim.history;
    const last = h[h.length - 1];
    const recent = h.slice(-5);
    const sum = (f: (m: (typeof h)[0]) => number, arr = h) => arr.reduce((s, m) => s + f(m), 0);
    const coopDen = sum((m) => m.shares + m.trades + m.thefts, recent);
    const coop = coopDen ? sum((m) => m.shares + m.trades, recent) / coopDen : null;
    const born = sum((m) => m.births), died = sum((m) => m.deaths);
    const causes: Record<string, number> = {};
    for (const a of sim.agents) if (!a.alive) causes[a.deathCause] = (causes[a.deathCause] ?? 0) + 1;
    const f = sim.cfg.flags;
    this.root.innerHTML = `
      <div class="kpis">
        <div class="kpi"><div class="l">População</div><div class="v">${sim.alive.length}</div><div class="d">${born} nascidos · ${died} mortos</div></div>
        <div class="kpi"><div class="l">Desigualdade (Gini)</div><div class="v">${last ? last.gini.toFixed(2) : '—'}</div><div class="d">0 = todos iguais</div></div>
        <div class="kpi"><div class="l">Cooperação (5 dias)</div><div class="v">${coop === null ? '—' : pct(coop) + '%'}</div><div class="d">ajuda ÷ (ajuda + roubo)</div></div>
        <div class="kpi"><div class="l">Confiança média</div><div class="v">${last ? last.trust.toFixed(2) : '—'}</div><div class="d">em estranhos: ${last ? last.outlook.toFixed(2) : '—'}</div></div>
        <div class="kpi"><div class="l">Totais</div><div class="v" style="font-size:14px">${sum((m) => m.shares)} doações</div><div class="d">${sum((m) => m.trades)} trocas · ${sum((m) => m.thefts)} roubos</div></div>
        <div class="kpi"><div class="l">Lares</div><div class="v">${last?.households ?? 0}</div><div class="d">${sim.shelters.filter((s) => s.alive).length} abrigos construídos</div></div>
      </div>
      <h3>Grupos emergentes (${sim.groups.length})</h3>
      <div class="groups">${
        sim.groups
          .map((g) => `<div class="group"><div class="gh"><span class="swatch" style="background:${groupColor(g.hue)}"></span>${esc(g.name)} <span class="badge">${g.members.length} membros</span><span class="badge">desde ${dayOf(g.founded)}</span></div>
            <div class="gm">${g.members.map((m) => `<a data-agent="${m}">${esc(sim.byId.get(m)?.name ?? '?')}</a>`).join(', ')}</div></div>`)
          .join('') || '<div class="empty">Nenhum grupo coeso ainda. Grupos aparecem quando 3+ indivíduos desenvolvem confiança mútua forte.</div>'
      }</div>
      <h3>Causas de morte</h3>
      <div class="sub">${Object.entries(causes).map(([k, v]) => `${esc(k)}: ${v}`).join(' · ') || 'nenhuma morte ainda'}</div>
      <h3>Configuração deste mundo</h3>
      <div class="flags sub">
        <span>Semente <b style="font-family:var(--mono)">${sim.cfg.seed}</b> · abundância ${sim.cfg.abundance}× · ${sim.cfg.agents} indivíduos iniciais</span>
        <span>Aprendizado ${f.learning ? '✔' : '✘'} · Fofoca ${f.gossip ? '✔' : '✘'} · Compartilhar locais ${f.knowledgeSharing ? '✔' : '✘'} · Reprodução ${f.reproduction ? '✔' : '✘'}</span>
      </div>
      <div class="note-box"><b>O que é regra e o que é emergente?</b><br>
        <b>Programado:</b> necessidades, estações, como plantas crescem, o que cada ação faz, como a confiança muda após cada interação.<br>
        <b>Não programado:</b> quem fica amigo de quem, grupos, lares compartilhados, quem enriquece, ondas de roubo, especialização, migração após a seca. Grupos não existem como regra — são <i>medidos</i> na rede de confiança.</div>`;
  }
}
