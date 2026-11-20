import type { Simulation, DayMetrics } from '../sim/sim';

interface Series {
  label: string;
  color: string;
  get: (m: DayMetrics) => number | null;
  bars?: boolean;
}
interface ChartDef {
  title: string;
  series: Series[];
  fixed?: [number, number];
  value: (m: DayMetrics) => string;
  help: string;
}

const CHARTS: ChartDef[] = [
  {
    title: 'População',
    help: 'Indivíduos vivos. Faixas azuis = inverno.',
    series: [{ label: 'vivos', color: '#dde3ec', get: (m) => m.pop }],
    value: (m) => String(m.pop),
  },
  {
    title: 'Desigualdade',
    help: 'Coeficiente de Gini da riqueza (comida carregada + parte do estoque + lenha). 0 = igualdade total.',
    fixed: [0, 0.8],
    series: [{ label: 'Gini', color: '#e8b04a', get: (m) => m.gini }],
    value: (m) => m.gini.toFixed(2),
  },
  {
    title: 'Ajuda × Roubo',
    help: 'Doações + trocas (verde) e roubos (vermelho) por dia.',
    series: [
      { label: 'doações+trocas', color: '#5fd0a5', get: (m) => m.shares + m.trades, bars: true },
      { label: 'roubos', color: '#e2665c', get: (m) => m.thefts, bars: true },
    ],
    value: (m) => `${m.shares + m.trades} / ${m.thefts}`,
  },
  {
    title: 'Confiança',
    help: 'Confiança média entre conhecidos e confiança em estranhos (generalizada).',
    fixed: [-0.2, 1],
    series: [
      { label: 'entre conhecidos', color: '#79a7ff', get: (m) => m.trust },
      { label: 'em estranhos', color: '#c9b2f5', get: (m) => m.outlook },
    ],
    value: (m) => m.trust.toFixed(2),
  },
  {
    title: 'Estrutura social',
    help: 'Grupos coesos detectados e lares (abrigos habitados).',
    series: [
      { label: 'grupos', color: '#c38df2', get: (m) => m.groups },
      { label: 'lares', color: '#cdb68a', get: (m) => m.households },
    ],
    value: (m) => `${m.groups} grupos`,
  },
];

export class Charts {
  private canvases: HTMLCanvasElement[] = [];
  private values: HTMLElement[] = [];
  private lastLen = -1;
  private lastInterventions = -1;

  constructor(root: HTMLElement) {
    root.innerHTML = '';
    for (const def of CHARTS) {
      const el = document.createElement('div');
      el.className = 'chart';
      el.title = def.help;
      el.innerHTML = `<div class="ct"><span>${def.title}</span><b>—</b></div>
        <canvas></canvas>
        <div class="lg">${def.series.map((s) => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join('')}</div>`;
      root.appendChild(el);
      this.canvases.push(el.querySelector('canvas')!);
      this.values.push(el.querySelector('b')!);
    }
  }

  reset() {
    this.lastLen = -1;
  }

  update(sim: Simulation, force = false) {
    const h = sim.history;
    if (!force && h.length === this.lastLen && sim.interventions.length === this.lastInterventions) return;
    this.lastLen = h.length;
    this.lastInterventions = sim.interventions.length;
    CHARTS.forEach((def, k) => this.drawChart(def, this.canvases[k], h, sim));
    const last = h[h.length - 1];
    if (last) CHARTS.forEach((def, k) => (this.values[k].textContent = def.value(last)));
  }

  private drawChart(def: ChartDef, cv: HTMLCanvasElement, h: DayMetrics[], sim: Simulation) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth, hh = cv.clientHeight;
    if (w === 0 || hh === 0) return;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
    const c = cv.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, hh);
    const N = Math.max(40, h.length);
    const data = h;
    let lo = 0, hi = 1;
    if (def.fixed) [lo, hi] = def.fixed;
    else {
      hi = 1;
      for (const m of data) for (const s of def.series) { const v = s.get(m); if (v !== null && v > hi) hi = v; }
      hi *= 1.1;
    }
    const X = (i: number) => (i / (N - 1)) * (w - 4) + 2;
    const Y = (v: number) => hh - 3 - ((v - lo) / (hi - lo)) * (hh - 8);
    // winters
    c.fillStyle = 'rgba(121,167,255,0.08)';
    for (let i = 0; i < data.length; i++) if (data[i].season === 3) c.fillRect(X(i) - (w / N) / 2, 0, w / N + 0.5, hh);
    // droughts
    c.fillStyle = 'rgba(232,176,74,0.07)';
    for (let i = 0; i < data.length; i++) if (data[i].rainfall < 0.6) c.fillRect(X(i) - (w / N) / 2, 0, w / N + 0.5, hh);
    // zero line
    if (lo < 0) {
      c.strokeStyle = 'rgba(255,255,255,0.08)';
      c.beginPath(); c.moveTo(0, Y(0)); c.lineTo(w, Y(0)); c.stroke();
    }
    // intervention markers
    c.strokeStyle = 'rgba(121,167,255,0.55)';
    c.setLineDash([2, 2]);
    for (const iv of sim.interventions) {
      const day = iv.tick / 100;
      const i = day - (data[0]?.day ?? 0);
      if (i < 0 || i > N) continue;
      c.beginPath(); c.moveTo(X(i), 0); c.lineTo(X(i), hh); c.stroke();
    }
    c.setLineDash([]);
    def.series.forEach((s, si) => {
      if (s.bars) {
        const bw = Math.max(1, (w / N) * 0.42);
        c.fillStyle = s.color;
        for (let i = 0; i < data.length; i++) {
          const v = s.get(data[i]);
          if (!v) continue;
          c.fillRect(X(i) - bw + si * bw, Y(v), bw, Y(lo) - Y(v));
        }
        return;
      }
      c.strokeStyle = s.color;
      c.lineWidth = 1.5;
      c.beginPath();
      let started = false;
      for (let i = 0; i < data.length; i++) {
        const v = s.get(data[i]);
        if (v === null) { started = false; continue; }
        if (!started) { c.moveTo(X(i), Y(v)); started = true; } else c.lineTo(X(i), Y(v));
      }
      c.stroke();
    });
    c.fillStyle = 'rgba(134,145,163,0.8)';
    c.font = '10px ui-monospace, monospace';
    c.textAlign = 'left';
    c.fillText(def.fixed ? String(hi) : String(Math.round(hi)), 2, 9);
  }
}

export function sparkline(cv: HTMLCanvasElement, values: number[], lo: number, hi: number, color: string) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth || 300, h = cv.clientHeight || 36;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const c = cv.getContext('2d')!;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  const Y = (v: number) => h - 2 - ((v - lo) / (hi - lo)) * (h - 4);
  if (lo < 0) {
    c.strokeStyle = 'rgba(255,255,255,0.1)';
    c.beginPath(); c.moveTo(0, Y(0)); c.lineTo(w, Y(0)); c.stroke();
  }
  if (values.length < 2) return;
  c.strokeStyle = color;
  c.lineWidth = 1.5;
  c.beginPath();
  values.forEach((v, i) => {
    const x = (i / (values.length - 1)) * (w - 2) + 1;
    if (i === 0) c.moveTo(x, Y(v)); else c.lineTo(x, Y(v));
  });
  c.stroke();
}
