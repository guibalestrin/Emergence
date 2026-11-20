import { EXPERIMENTS, SUMMARY_FIELDS, meanSd, welch, RunSummary, ExperimentSpec } from '../sim/experiment';
import LabWorker from './lab.worker?worker&inline';

const COLORS = ['#79a7ff', '#e8b04a', '#5fd0a5', '#e2665c'];
let worker: Worker | null = null;
let lastResults: { spec: ExperimentSpec; results: RunSummary[] } | null = null;

export function renderLab(box: HTMLElement, close: () => void) {
  let current = EXPERIMENTS[0];
  box.innerHTML = `
    <button class="btn icon close" data-x>✕</button>
    <h1>LABORATÓRIO</h1>
    <p>O mundo ao vivo mostra <b>uma</b> história. Para separar padrões reais de acaso, o laboratório roda o <b>mesmo experimento várias vezes</b>
       (sementes diferentes) em cada condição, sem gráficos, em segundo plano — e compara as médias. Cada condição altera <b>uma única variável</b>.</p>
    <div class="cols3" id="lab-exps"></div>
    <div class="form">
      <label>Repetições por condição</label><div><input type="range" id="lab-seeds" min="2" max="10" value="4"> <span id="lab-seeds-v">4</span> sementes</div>
      <label>Duração</label><div><input type="range" id="lab-days" min="32" max="160" step="8" value="96"> <span id="lab-days-v">96</span> dias (${'1 ano = 32 dias'})</div>
    </div>
    <div class="row"><button class="btn accent" id="lab-run">Rodar experimento</button><span class="sub" id="lab-est"></span></div>
    <div class="progress"><i id="lab-prog"></i></div>
    <div class="sub" id="lab-status"></div>
    <div id="lab-out"></div>`;
  box.querySelector('[data-x]')!.addEventListener('click', close);
  const exps = box.querySelector('#lab-exps')!;
  const drawCards = () => {
    exps.innerHTML = EXPERIMENTS.map(
      (e) => `<div class="card" data-exp="${e.id}" style="cursor:pointer;${e.id === current.id ? 'border-color:var(--accent)' : ''}">
        <h3>${e.title}</h3><p>${e.question}</p><p style="margin-top:6px;color:var(--faint)">${e.conditions.map((c) => c.name).join(' · ')}</p></div>`,
    ).join('');
  };
  drawCards();
  exps.addEventListener('click', (ev) => {
    const el = (ev.target as HTMLElement).closest('[data-exp]') as HTMLElement | null;
    if (!el) return;
    current = EXPERIMENTS.find((e) => e.id === el.dataset.exp)!;
    drawCards();
    est();
  });
  const seeds = box.querySelector('#lab-seeds') as HTMLInputElement;
  const days = box.querySelector('#lab-days') as HTMLInputElement;
  const est = () => {
    (box.querySelector('#lab-seeds-v') as HTMLElement).textContent = seeds.value;
    (box.querySelector('#lab-days-v') as HTMLElement).textContent = days.value;
    const runs = Number(seeds.value) * current.conditions.length;
    const secs = runs * Number(days.value) * 0.05;
    (box.querySelector('#lab-est') as HTMLElement).textContent = `${runs} simulações · ~${Math.max(5, Math.round(secs))} s`;
  };
  seeds.addEventListener('input', est);
  days.addEventListener('input', est);
  est();
  const prog = box.querySelector('#lab-prog') as HTMLElement;
  const status = box.querySelector('#lab-status') as HTMLElement;
  const out = box.querySelector('#lab-out') as HTMLElement;
  const runBtn = box.querySelector('#lab-run') as HTMLButtonElement;
  if (lastResults) showResults(out, lastResults.spec, lastResults.results);

  runBtn.addEventListener('click', () => {
    worker?.terminate();
    worker = new LabWorker();
    const spec = current;
    runBtn.disabled = true;
    out.innerHTML = '';
    const t0 = performance.now();
    worker.onmessage = (e) => {
      if (e.data.type === 'progress') {
        prog.style.width = `${(e.data.value * 100).toFixed(1)}%`;
        status.textContent = `Rodando: ${e.data.label}…`;
      } else if (e.data.type === 'done') {
        runBtn.disabled = false;
        status.textContent = `Concluído em ${((performance.now() - t0) / 1000).toFixed(1)} s.`;
        lastResults = { spec, results: e.data.results };
        showResults(out, spec, e.data.results);
        worker?.terminate();
        worker = null;
      }
    };
    worker.onerror = (e) => {
      runBtn.disabled = false;
      status.textContent = `Erro no experimento: ${e.message}`;
    };
    worker.postMessage({ id: spec.id, seeds: Number(seeds.value), days: Number(days.value) });
  });
}

function showResults(out: HTMLElement, spec: ExperimentSpec, results: RunSummary[]) {
  const conds = spec.conditions.map((c) => c.name);
  const two = conds.length === 2;
  const rows = SUMMARY_FIELDS.map((f) => {
    const cells = conds.map((c) => {
      const { mean, sd } = meanSd(results.filter((r) => r.condition === c).map((r) => r[f.key] as number));
      return `<td>${mean.toFixed(f.digits)} <span style="color:var(--faint)">± ${sd.toFixed(f.digits)}</span></td>`;
    });
    let sig = '';
    if (two) {
      const t = welch(
        results.filter((r) => r.condition === conds[0]).map((r) => r[f.key] as number),
        results.filter((r) => r.condition === conds[1]).map((r) => r[f.key] as number),
      );
      sig = `<td class="sig" title="estatística t de Welch">${Math.abs(t) > 2.2 ? '● ' : ''}${t.toFixed(1)}</td>`;
    }
    return `<tr><td>${f.label}</td>${cells.join('')}${sig}</tr>`;
  }).join('');
  const survived = conds.map((c) => {
    const rs = results.filter((r) => r.condition === c);
    return `${c}: ${rs.filter((r) => r.survived).length}/${rs.length} sociedades sobreviveram`;
  });
  out.innerHTML = `
    <h2>Resultados — ${spec.title}</h2>
    <p class="sub">${survived.join(' · ')}</p>
    <canvas class="labcanvas" id="lab-chart"></canvas>
    <div class="sub" style="margin-top:4px">${conds.map((c, i) => `<span style="color:${COLORS[i]}">━ ${c}</span>`).join(' &nbsp; ')} &nbsp; — população média ao longo do tempo (faixas = inverno)</div>
    <table class="res"><tr><th>Métrica (média ± desvio)</th>${conds.map((c) => `<th>${c}</th>`).join('')}${two ? '<th>t</th>' : ''}</tr>${rows}</table>
    ${two ? '<p class="sub">● |t| &gt; 2,2: a diferença entre as condições é provavelmente maior do que a variação natural entre sementes. Sem ●, não há evidência de efeito — <b>um resultado nulo também é um resultado</b>.</p>' : ''}
    <p class="sub"><b>Como interpretar:</b> cada linha resume ${results.length / conds.length} sociedades independentes por condição. Como só uma variável muda entre condições, diferenças consistentes indicam um efeito causal <i>dentro deste modelo</i> — não necessariamente em sociedades humanas reais.</p>
    <div class="row"><button class="btn" id="lab-csv">Exportar CSV</button></div>`;
  drawLabChart(out.querySelector('#lab-chart') as HTMLCanvasElement, conds, results);
  out.querySelector('#lab-csv')!.addEventListener('click', () => {
    const cols = ['condition', 'seed', ...SUMMARY_FIELDS.map((f) => f.key as string)];
    const csv = [cols.join(','), ...results.map((r) => cols.map((c) => JSON.stringify((r as any)[c])).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `emergence-${spec.id}.csv`;
    a.click();
  });
}

function drawLabChart(cv: HTMLCanvasElement, conds: string[], results: RunSummary[]) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * dpr;
  cv.height = h * dpr;
  const c = cv.getContext('2d')!;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const len = Math.max(...results.map((r) => r.popSeries.length));
  const means = conds.map((cn) => {
    const rs = results.filter((r) => r.condition === cn);
    return Array.from({ length: len }, (_, i) => rs.reduce((s, r) => s + (r.popSeries[i] ?? 0), 0) / rs.length);
  });
  const max = Math.max(10, ...means.flat()) * 1.1;
  const X = (i: number) => 30 + (i / Math.max(1, len - 1)) * (w - 40);
  const Y = (v: number) => h - 18 - (v / max) * (h - 30);
  c.fillStyle = 'rgba(121,167,255,0.08)';
  for (let d = 0; d < len; d++) if (Math.floor(d / 8) % 4 === 3) c.fillRect(X(d), 0, (w - 40) / len + 0.5, h - 18);
  c.fillStyle = '#5b6577';
  c.font = '10px ui-monospace, monospace';
  for (let v = 0; v <= max; v += Math.ceil(max / 4 / 10) * 10) { c.fillText(String(v), 4, Y(v) + 3); }
  for (let d = 0; d < len; d += 32) c.fillText(`ano ${d / 32 + 1}`, X(d) + 2, h - 5);
  means.forEach((m, k) => {
    c.strokeStyle = COLORS[k];
    c.lineWidth = 2;
    c.beginPath();
    m.forEach((v, i) => (i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v))));
    c.stroke();
  });
}
