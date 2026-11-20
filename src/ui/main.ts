import '../style.css';
import { Simulation } from '../sim/sim';
import { defaultConfig, SimConfig, SEASONS, SimEvent, EventKind, W } from '../sim/types';
import { TRAIT_PRESETS } from '../sim/agent';
import { Renderer, ViewState } from './renderer';
import { Charts } from './charts';
import { AgentPanel, SocietyPanel, PanelHost } from './panels';
import { renderLab } from './lab';

const BASE_TPS = 8; // simulation ticks per second at 1× (1 day = 100 ticks)
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;

type Tool = 'observe' | 'plant' | 'gift' | 'clear' | 'forest' | 'water' | 'fire' | 'spawn' | 'disease';
const BRUSH_TOOLS = new Set<Tool>(['plant', 'clear', 'forest', 'water']);
const TOOL_HINT: Record<Tool, string> = {
  observe: 'Clique em um indivíduo para inspecioná-lo · arraste para mover · roda do mouse para zoom',
  plant: 'Arraste para plantar arbustos de frutas',
  gift: 'Clique para lançar uma dádiva de comida no chão',
  clear: 'Arraste para remover vegetação',
  forest: 'Arraste para plantar floresta (lenha)',
  water: 'Arraste para criar um lago',
  fire: 'Clique em grama ou floresta para iniciar um incêndio',
  spawn: 'Clique para introduzir um novo indivíduo com a personalidade escolhida',
  disease: 'Clique em um indivíduo para infectá-lo com uma doença contagiosa',
};

class App implements PanelHost {
  sim!: Simulation;
  cfg: SimConfig;
  renderer: Renderer;
  charts: Charts;
  agentPanel: AgentPanel;
  societyPanel: SocietyPanel;
  paused = false;
  speed = 1;
  tool: Tool = 'observe';
  follow = false;
  view: ViewState = { selected: null, hovered: null, showNet: false, showGlyphs: true, brush: null };
  private acc = 0;
  private last = performance.now();
  private lastPanel = 0;
  private lastFeed = 0;
  private feedFilter = 'all';
  private feedCount = -1;
  private tab: 'agent' | 'society' = 'agent';
  private mouse = { x: 0, y: 0, down: false, button: 0, dragX: 0, dragY: 0, moved: false, painted: false };

  constructor() {
    this.cfg = defaultConfig(Math.floor(Math.random() * 99999) + 1);
    this.renderer = new Renderer($('#world') as HTMLCanvasElement);
    this.charts = new Charts($('#charts'));
    this.agentPanel = new AgentPanel($('#panel-agent'), this, () => this.sim);
    this.societyPanel = new SocietyPanel($('#panel-society'), this);
    this.newWorld(this.cfg);
    this.bindUI();
    this.renderer.resize();
    this.renderer.fit();
    let fitted = false;
    new ResizeObserver(() => {
      this.renderer.resize();
      if (!fitted && this.renderer.width > 0) { this.renderer.fit(); fitted = true; }
      this.charts.update(this.sim, true);
    }).observe($('#stage'));
    requestAnimationFrame((t) => this.frame(t));
    let seenIntro = false;
    try { seenIntro = sessionStorage.getItem('emergence-intro') === '1'; } catch { /* storage may be unavailable */ }
    if (!seenIntro) this.showHelp();
    this.hint(TOOL_HINT.observe);
  }

  newWorld(cfg: SimConfig) {
    this.cfg = cfg;
    this.sim = new Simulation(cfg);
    this.view.selected = null;
    this.follow = false;
    this.agentPanel.setAgent(null);
    this.charts.reset();
    this.feedCount = -1;
    this.acc = 0;
    this.sim.log('milestone', `Um novo mundo começa (semente ${cfg.seed}). ${cfg.agents} desconhecidos, sem regras sociais pré-definidas.`, []);
  }

  select(id: number | null, center = false) {
    this.view.selected = id;
    this.agentPanel.setAgent(id);
    if (id !== null) {
      this.setTab('agent');
      const a = this.sim.byId.get(id);
      if (a && center) this.renderer.centerOn(a.tile);
    } else this.follow = false;
    this.agentPanel.update();
  }
  setFollow(v: boolean) {
    this.follow = v;
  }

  // ---------------------------------------------------------------- loop --
  private frame(now: number) {
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    if (!this.paused) {
      this.acc += dt * BASE_TPS * this.speed;
      let n = 0;
      const max = 120;
      while (this.acc >= 1 && n < max) {
        this.sim.step();
        this.acc -= 1;
        n++;
      }
      if (n >= max) this.acc = 0;
    }
    const alpha = this.paused ? 1 : Math.min(1, this.acc);
    if (this.follow && this.view.selected !== null) {
      const a = this.sim.byId.get(this.view.selected);
      if (a?.alive) {
        const p = this.renderer.agentPos(a, alpha);
        this.renderer.cam.x += (p.x - this.renderer.cam.x) * 0.15;
        this.renderer.cam.y += (p.y - this.renderer.cam.y) * 0.15;
      }
    }
    this.renderer.draw(this.sim, alpha, this.view, now);
    if (now - this.lastPanel > 250) {
      this.lastPanel = now;
      this.updateTop();
      if (this.tab === 'agent') this.agentPanel.update();
      else if (now % 1000 < 260) this.societyPanel.update(this.sim);
      this.charts.update(this.sim);
    }
    if (now - this.lastFeed > 400) {
      this.lastFeed = now;
      this.updateFeed();
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  private updateTop() {
    const s = this.sim;
    $('#date').textContent = `${s.dateLabel()} · ${s.isNight() ? 'noite' : 'dia'}`;
    const cl = $('#climate');
    if (s.climate) {
      const left = Math.ceil((s.climate.until - s.tick) / 100);
      cl.textContent = `${s.climate.label} · ${left}d`;
      cl.className = 'pill warn';
    } else if (s.season() === 3) {
      cl.textContent = s.harshWinter ? 'inverno rigoroso' : 'inverno';
      cl.className = 'pill cold';
    } else {
      cl.textContent = `${SEASONS[s.season()].toLowerCase()} · clima normal`;
      cl.className = 'pill';
    }
    $('#popcount').textContent = `${s.alive.length} vivos · ${s.groups.length} grupos`;
    $('#cl-winter').classList.toggle('lit', s.harshWinter);
    $('#cl-drought').classList.toggle('lit', !!s.climate && s.climate.rain < 1);
    $('#cl-deluge').classList.toggle('lit', !!s.climate && s.climate.rain > 1);
  }

  private updateFeed() {
    const ev = this.sim.events;
    const key = ev.length * 10 + ['all', 'social', 'conflict', 'life', 'world'].indexOf(this.feedFilter);
    if (key === this.feedCount) return;
    this.feedCount = key;
    const groups: Record<string, EventKind[]> = {
      social: ['share', 'trade', 'household', 'group', 'milestone'],
      conflict: ['theft'],
      life: ['birth', 'death', 'disease'],
      world: ['climate', 'intervention', 'fire', 'build', 'milestone'],
    };
    const allow = this.feedFilter === 'all' ? null : new Set(groups[this.feedFilter]);
    const out: SimEvent[] = [];
    for (let i = ev.length - 1; i >= 0 && out.length < 120; i--) {
      const e = ev[i];
      if (allow && !allow.has(e.kind)) continue;
      // keep the "all" feed readable: shares are frequent, show only some
      if (!allow && e.kind === 'share' && i % 3 !== 0) continue;
      out.push(e);
    }
    $('#events').innerHTML = out
      .map((e, k) => `<li class="k-${e.kind}" data-ev="${k}"><time>d${Math.floor(e.tick / 100)}</time><span>${e.text}</span></li>`)
      .join('');
    ($('#events') as any)._ev = out;
  }

  // ------------------------------------------------------------------ UI --
  private hintTimer = 0;
  hint(text: string) {
    const h = $('#hint');
    h.textContent = text;
    h.classList.add('show');
    clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => h.classList.remove('show'), 4500);
  }

  private setTab(t: 'agent' | 'society') {
    this.tab = t;
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.tab === t));
    $('#panel-agent').classList.toggle('hidden', t !== 'agent');
    $('#panel-society').classList.toggle('hidden', t !== 'society');
    if (t === 'society') this.societyPanel.update(this.sim);
  }

  private setTool(t: Tool) {
    this.tool = t;
    document.querySelectorAll('.tool[data-tool]').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.tool === t));
    $('#world').classList.toggle('painting', t !== 'observe');
    this.hint(TOOL_HINT[t]);
  }

  private setSpeed(s: number) {
    this.speed = s;
    document.querySelectorAll('#speeds button').forEach((b) => b.classList.toggle('on', Number((b as HTMLElement).dataset.speed) === s));
    if (this.paused) this.togglePause();
  }
  private togglePause() {
    this.paused = !this.paused;
    $('#play').textContent = this.paused ? '▶' : '⏸';
  }

  private bindUI() {
    $('#play').addEventListener('click', () => this.togglePause());
    document.querySelectorAll('#speeds button').forEach((b) =>
      b.addEventListener('click', () => this.setSpeed(Number((b as HTMLElement).dataset.speed))),
    );
    document.querySelectorAll('.tool[data-tool]').forEach((b) =>
      b.addEventListener('click', () => this.setTool((b as HTMLElement).dataset.tool as Tool)),
    );
    document.querySelectorAll('.tabs button').forEach((b) =>
      b.addEventListener('click', () => this.setTab((b as HTMLElement).dataset.tab as 'agent' | 'society')),
    );
    const preset = $('#preset') as HTMLSelectElement;
    preset.innerHTML = Object.entries(TRAIT_PRESETS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
    preset.addEventListener('change', () => this.setTool('spawn'));

    $('#cl-drought').addEventListener('click', () => { this.sim.setClimate('drought', 16); this.hint('Seca severa: a chuva cai, lagos rasos secam e plantas crescem pouco. Observe como reagem.'); });
    $('#cl-deluge').addEventListener('click', () => { this.sim.setClimate('deluge', 12); this.hint('Chuvas abundantes: plantas crescem mais rápido.'); });
    $('#cl-winter').addEventListener('click', () => this.sim.setHarshWinter(!this.sim.harshWinter));
    $('#cl-normal').addEventListener('click', () => this.sim.setClimate('normal'));
    $('#ov-net').addEventListener('change', (e) => (this.view.showNet = (e.target as HTMLInputElement).checked));
    $('#ov-glyph').addEventListener('change', (e) => (this.view.showGlyphs = (e.target as HTMLInputElement).checked));

    $('#btn-new').addEventListener('click', () => this.showNewWorld());
    $('#btn-replay').addEventListener('click', () => {
      this.newWorld({ ...this.cfg, flags: { ...this.cfg.flags } });
      this.hint(`Mundo reiniciado com a mesma semente (${this.cfg.seed}). Sem intervenções, a história se repete exatamente.`);
    });
    $('#btn-lab').addEventListener('click', () => this.openModal((box) => renderLab(box, () => this.closeModal())));
    $('#btn-help').addEventListener('click', () => this.showHelp());
    $('#modal').addEventListener('pointerdown', (e) => { if (e.target === $('#modal')) this.closeModal(); });

    $('#feedfilter').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      this.feedFilter = b.dataset.f!;
      document.querySelectorAll('#feedfilter button').forEach((x) => x.classList.toggle('on', x === b));
      this.updateFeed();
    });
    $('#events').addEventListener('pointerdown', (e) => {
      const li = (e.target as HTMLElement).closest('li') as HTMLElement | null;
      const list = ($('#events') as any)._ev as SimEvent[] | undefined;
      if (!li || !list) return;
      const ev = list[Number(li.dataset.ev)];
      if (!ev) return;
      if (ev.agents.length) this.select(ev.agents[0], true);
      else if (ev.tile !== undefined) this.renderer.centerOn(ev.tile);
    });

    const cv = $('#world') as HTMLCanvasElement;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      this.renderer.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    cv.addEventListener('pointerdown', (e) => {
      const r = cv.getBoundingClientRect();
      Object.assign(this.mouse, { x: e.clientX - r.left, y: e.clientY - r.top, down: true, button: e.button, dragX: e.clientX, dragY: e.clientY, moved: false, painted: false });
      cv.setPointerCapture(e.pointerId);
      if (e.button === 0 && this.tool !== 'observe') this.applyTool(this.mouse.x, this.mouse.y, true);
    });
    cv.addEventListener('pointermove', (e) => {
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      this.mouse.x = x; this.mouse.y = y;
      const tile = this.renderer.screenToTile(x, y);
      this.view.brush = BRUSH_TOOLS.has(this.tool) && tile >= 0 ? { tile, radius: Number(($('#brush') as HTMLInputElement).value) } : null;
      if (this.mouse.down) {
        const dx = e.clientX - this.mouse.dragX, dy = e.clientY - this.mouse.dragY;
        if (Math.abs(dx) + Math.abs(dy) > 3) this.mouse.moved = true;
        if (this.tool === 'observe' || this.mouse.button !== 0) {
          this.renderer.cam.x -= dx / this.renderer.cam.zoom;
          this.renderer.cam.y -= dy / this.renderer.cam.zoom;
          this.mouse.dragX = e.clientX; this.mouse.dragY = e.clientY;
          if (this.mouse.moved) { cv.classList.add('dragging'); this.follow = false; }
        } else if (BRUSH_TOOLS.has(this.tool)) this.applyTool(x, y, false);
      }
      this.updateTooltip(x, y);
    });
    cv.addEventListener('pointerup', () => {
      cv.classList.remove('dragging');
      if (this.mouse.down && !this.mouse.moved && this.mouse.button === 0 && this.tool === 'observe') {
        const a = this.renderer.pickAgent(this.sim, this.mouse.x, this.mouse.y, Math.min(1, this.acc));
        this.select(a ? a.id : null);
      }
      if (this.mouse.painted && BRUSH_TOOLS.has(this.tool)) {
        const names: Record<string, string> = { plant: 'arbustos plantados', clear: 'vegetação removida', forest: 'floresta plantada', water: 'lago criado' };
        this.sim.intervene(names[this.tool]);
      }
      this.mouse.down = false;
    });
    cv.addEventListener('pointerleave', () => { this.view.brush = null; this.view.hovered = null; $('#tooltip').style.display = 'none'; });

    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || !$('#modal').classList.contains('hidden')) {
        if (e.key === 'Escape') this.closeModal();
        return;
      }
      if (e.key === ' ') { e.preventDefault(); this.togglePause(); }
      else if (e.key >= '1' && e.key <= '4') this.setSpeed([1, 3, 10, 30][Number(e.key) - 1]);
      else if (e.key === 'Escape') { this.setTool('observe'); this.select(null); }
      else if (e.key === 'f' && this.view.selected !== null) this.follow = !this.follow;
      else if (e.key === 'r') this.renderer.fit();
    });
  }

  private updateTooltip(x: number, y: number) {
    const tt = $('#tooltip');
    const a = this.renderer.pickAgent(this.sim, x, y, Math.min(1, this.acc));
    this.view.hovered = a ? a.id : null;
    if (!a || this.mouse.down) { tt.style.display = 'none'; return; }
    const g = this.sim.groups.find((x) => x.id === a.group);
    tt.innerHTML = `<b>${a.name}</b>${g ? ` · ${g.name}` : ''}<small>${this.sim.actLabel(a)}</small>`;
    tt.style.display = 'block';
    tt.style.left = `${x + 14}px`;
    tt.style.top = `${y + 10}px`;
  }

  private applyTool(x: number, y: number, first: boolean) {
    const tile = this.renderer.screenToTile(x, y);
    if (tile < 0) return;
    const s = this.sim;
    const radius = Number(($('#brush') as HTMLInputElement).value);
    switch (this.tool) {
      case 'plant': case 'clear': case 'forest': case 'water':
        s.paint(this.tool, tile, radius);
        this.mouse.painted = true;
        break;
      case 'gift':
        if (!first) return;
        s.paint('gift', tile, 1);
        s.intervene(`dádiva de comida no ponto (${tile % W}, ${Math.floor(tile / W)})`);
        break;
      case 'fire':
        if (!first) return;
        if (s.ignite(tile)) { s.intervene('incêndio iniciado'); s.log('fire', 'Um incêndio começou!', [], tile); }
        else this.hint('O fogo só pega em grama ou floresta.');
        break;
      case 'spawn': {
        if (!first) return;
        const p = ($('#preset') as HTMLSelectElement).value;
        const a = s.spawnPreset(tile, p);
        if (a) { s.intervene(`${a.name} (${TRAIT_PRESETS[p].label.toLowerCase()}) introduzido(a)`); this.select(a.id); }
        else this.hint('Escolha um local de terra firme.');
        break;
      }
      case 'disease': {
        if (!first) return;
        const a = this.renderer.pickAgent(s, x, y, 1);
        if (a && s.infect(a)) { s.intervene(`doença introduzida em ${a.name}`); s.log('disease', `${a.name} adoeceu — a doença se espalha pelo contato próximo`, [a.id], a.tile); }
        else this.hint(a ? `${a.name} já está doente ou imune.` : 'Clique sobre um indivíduo.');
        break;
      }
    }
  }

  // -------------------------------------------------------------- modals --
  openModal(fill: (box: HTMLElement) => void) {
    const box = $('#modalbox');
    fill(box);
    $('#modal').classList.remove('hidden');
  }
  closeModal() {
    $('#modal').classList.add('hidden');
    try { sessionStorage.setItem('emergence-intro', '1'); } catch { /* ignore */ }
  }

  showHelp() {
    this.openModal((box) => {
      box.innerHTML = `<button class="btn icon close" data-x>✕</button>
        <h1>EMERGENCE</h1>
        <p style="font-size:15px;color:var(--text)">Um pequeno mundo habitado por indivíduos artificiais. <b>Ninguém escreveu a história deles.</b></p>
        <p>Cada indivíduo tem necessidades (fome, sede, cansaço, frio, solidão), uma personalidade e uma memória. A cada momento ele avalia o que pode fazer
           — coletar, explorar, guardar comida, conversar, doar, pedir, trocar, roubar, construir um abrigo, formar família — e escolhe com base no que sente,
           no que lembra, em quem confia e no que <b>aprendeu com as próprias experiências</b>. Amizades, grupos, desigualdade e conflitos não são regras: surgem (ou não) das interações.</p>
        <div class="cols3">
          <div class="card"><div class="big">🔍</div><h3>Observe</h3><p>Clique em alguém para ver o que está fazendo, <b>por que decidiu isso</b>, quem são seus amigos e desafetos, e o que o marcou.</p></div>
          <div class="card"><div class="big">☀️</div><h3>Intervenha</h3><p>Provoque uma seca, inicie um incêndio, espalhe uma doença, plante comida, introduza um oportunista ou mude a personalidade de alguém. Veja como a sociedade reage.</p></div>
          <div class="card"><div class="big">🧪</div><h3>Investigue</h3><p>No <b>Laboratório</b>, rode o mesmo experimento dezenas de vezes e compare condições: escassez × cooperação, o papel da fofoca, do aprendizado…</p></div>
        </div>
        <h2>Como ler o mundo</h2>
        <p><b>Cor do corpo</b>: temperamento (verde-azulado = generoso, laranja = egoísta/ousado). <b>Anel colorido</b>: pertence a um grupo emergente.
           <b>Linhas</b>: verde = doação, âmbar = troca, azul tracejado = conversa, vermelho = roubo (com "!" quando alguém viu). Ponto vermelho = carregando comida.
           Faixas azuis nos gráficos = inverno, quando nada cresce e o frio exige abrigo e lenha.</p>
        <p><b>Atalhos</b>: <span class="kbd">Espaço</span> pausar · <span class="kbd">1</span>–<span class="kbd">4</span> velocidade · <span class="kbd">F</span> seguir selecionado · <span class="kbd">R</span> recentralizar · <span class="kbd">Esc</span> limpar seleção</p>
        <div class="row" style="margin-top:14px"><button class="btn accent" data-x>Entrar no experimento</button></div>`;
      box.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => this.closeModal()));
    });
  }

  showNewWorld() {
    this.openModal((box) => {
      const c = this.cfg;
      box.innerHTML = `<button class="btn icon close" data-x>✕</button>
        <h1>NOVO MUNDO</h1>
        <p>Cada semente gera um mapa e uma população diferentes. A mesma semente com a mesma configuração sempre produz a mesma história — por isso é possível repetir e comparar.</p>
        <div class="form">
          <label>Semente</label><div><input type="number" id="nw-seed" value="${Math.floor(Math.random() * 99999) + 1}"> <button class="btn small" id="nw-rand">aleatória</button></div>
          <label>Indivíduos iniciais</label><div><input type="range" id="nw-agents" min="8" max="70" value="${c.agents}"> <span id="nw-agents-v">${c.agents}</span></div>
          <label>Abundância de recursos</label><div><input type="range" id="nw-ab" min="0.4" max="2" step="0.1" value="${c.abundance}"> <span id="nw-ab-v">${c.abundance}×</span></div>
          <label>Mecanismos (ablação)</label><div class="flags">
            <label class="chk"><input type="checkbox" id="nw-learning" ${c.flags.learning ? 'checked' : ''}> aprendizado por experiência</label>
            <label class="chk"><input type="checkbox" id="nw-gossip" ${c.flags.gossip ? 'checked' : ''}> fofoca / reputação</label>
            <label class="chk"><input type="checkbox" id="nw-know" ${c.flags.knowledgeSharing ? 'checked' : ''}> compartilhar locais de comida</label>
            <label class="chk"><input type="checkbox" id="nw-repro" ${c.flags.reproduction ? 'checked' : ''}> reprodução</label>
          </div>
        </div>
        <div class="row" style="margin-top:16px"><button class="btn accent" id="nw-go">Gerar mundo</button><button class="btn" data-x>Cancelar</button></div>`;
      box.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => this.closeModal()));
      const g = (id: string) => box.querySelector(id) as HTMLInputElement;
      g('#nw-rand').addEventListener('click', () => (g('#nw-seed').value = String(Math.floor(Math.random() * 99999) + 1)));
      g('#nw-agents').addEventListener('input', () => (g('#nw-agents-v').textContent = g('#nw-agents').value));
      g('#nw-ab').addEventListener('input', () => (g('#nw-ab-v').textContent = g('#nw-ab').value + '×'));
      g('#nw-go').addEventListener('click', () => {
        this.newWorld({
          seed: Math.max(1, Math.floor(Number(g('#nw-seed').value) || 1)),
          agents: Number(g('#nw-agents').value),
          abundance: Number(g('#nw-ab').value),
          flags: { learning: g('#nw-learning').checked, gossip: g('#nw-gossip').checked, knowledgeSharing: g('#nw-know').checked, reproduction: g('#nw-repro').checked },
        });
        this.closeModal();
      });
    });
  }
}

new App();
