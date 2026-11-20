import type { Simulation } from './sim';
import type { Agent, Intent } from './agent';
import {
  Act,
  ACT_LABEL,
  Candidate,
  Factor,
  LEARNED_ACTS,
  LearnedAct,
  SHELTER_COST,
  CARRY_FOOD,
  CARRY_WOOD,
  TICKS_PER_YEAR as _TICKS_PER_YEAR,
  W as _W,
  H as _H,
  clamp,
} from './types';
const TICKS_PER_YEAR = _TICKS_PER_YEAR;
const W = _W;
const H = _H;
import { dist } from './world';

/**
 * Agent decision-making: a transparent utility-based architecture.
 *
 *  1. Every possible action is scored from the agent's needs, personality
 *     traits, memories, relationships and what it currently perceives.
 *  2. Strategic actions are then weighted by a value the agent has LEARNED
 *     from the outcomes of its own past attempts (a per-agent bandit).
 *  3. A little noise makes the choice "soft" (agents are not perfectly
 *     rational), and the best candidate is executed.
 *
 * Each factor is kept with a human-readable label so the UI can show *why*
 * an agent chose what it did.
 */

interface C extends Candidate {
  make: () => Intent | null;
}

const LEARNED = new Set<Act>(LEARNED_ACTS);

export function anticipation(sim: Simulation, a: Agent) {
  // How strongly the agent prepares for winter. Agents who lived through a
  // winter (or whose parents did) anticipate it more — experience, not script.
  const season = sim.season();
  const dayInSeason = sim.dayInSeason();
  const seasonal = [0.15, 0.45 + dayInSeason * 0.05, 1.0, 0.7][season];
  const experience = clamp(0.25 + a.wintersSeen * 0.4);
  return seasonal * experience;
}

export function decide(sim: Simulation, a: Agent, keep?: Act) {
  const cands = candidates(sim, a, keep);
  cands.sort((x, y) => y.score - x.score);
  let chosen: Intent | null = null;
  for (const c of cands) {
    chosen = c.make();
    if (chosen) {
      // move chosen to front for the explanation panel
      const i = cands.indexOf(c);
      if (i > 0) {
        cands.splice(i, 1);
        cands.unshift(c);
      }
      break;
    }
  }
  a.lastChoice = cands.slice(0, 5).map(({ make, ...rest }) => rest);
  a.lastChoiceTick = sim.tick;
  a.intent = chosen ?? { act: Act.Idle, tile: a.tile, path: [], work: 5, started: sim.tick, label: ACT_LABEL[Act.Idle] };
}

function candidates(sim: Simulation, a: Agent, keep?: Act): C[] {
  const t = a.traits;
  const tick = sim.tick;
  const w = sim.world;
  const season = sim.season();
  const night = sim.isNight();
  const home = a.home >= 0 ? sim.shelters[a.home] : null;
  const adult = a.isAdult(tick);
  const ant = anticipation(sim, a);
  const out: C[] = [];

  const add = (act: Act, label: string, factors: Factor[], make: () => Intent | null) => {
    let base = 0;
    for (const f of factors) base += f.value;
    if (base <= 0.005) return;
    let learned = 1;
    if (LEARNED.has(act)) learned = 1 + 0.8 * a.q[act as LearnedAct];
    if (keep === act) base += 0.08; // commitment: avoid dithering between plans
    const score = base * learned + 0.045 * sim.rng.gumbel();
    out.push({ act, label, factors, base, learned, score, make });
  };
  const intent = (act: Act, tile: number, work: number, label: string, extra: Partial<Intent> = {}): Intent | null => {
    const path = sim.pf.to(a.tile, tile, extra.adjacent ?? false);
    if (!path) return null;
    return { act, tile, path, work, started: tick, label, ...extra };
  };

  // ---- danger ---------------------------------------------------------
  const fire = sim.fireNear(a.tile, 4);
  if (fire >= 0) {
    add(Act.Flee, 'Fugir do incêndio', [{ label: 'Fogo próximo', value: 3 }], () => {
      const path = sim.pf.search(a.tile, (i) => sim.fireNear(i, 6) < 0, 3000);
      return path ? { act: Act.Flee, tile: path[path.length - 1] ?? a.tile, path, work: 0, started: tick, label: 'Fugindo do fogo' } : null;
    });
  }

  // ---- bodily needs ---------------------------------------------------
  if (a.food >= 1 && a.hunger > 0.25) {
    add(Act.Eat, 'Comer do que carrega', [{ label: 'Fome', value: a.hunger ** 1.4 * 1.4 }], () => ({
      act: Act.Eat, tile: a.tile, path: [], work: 3, started: tick, label: ACT_LABEL[Act.Eat],
    }));
  }
  if (home && home.food >= 1 && a.food < 1 && a.hunger > 0.3) {
    const d = dist(a.tile, home.tile);
    add(Act.Withdraw, 'Pegar comida do estoque', [
      { label: 'Fome', value: a.hunger * 1.15 },
      { label: 'Distância', value: -d * 0.008 },
    ], () => intent(Act.Withdraw, home.tile, 2, 'Indo pegar comida no abrigo'));
  }
  const water = nearestWater(sim, a);
  if (water >= 0 && a.thirst > 0.15) {
    const d = dist(a.tile, water);
    add(Act.Drink, 'Beber água', [
      { label: 'Sede', value: a.thirst ** 1.3 * 1.5 },
      { label: 'Distância', value: -d * 0.006 },
    ], () => intent(Act.Drink, water, 3, 'Indo beber água', { adjacent: true }));
  }
  if (a.fatigue > 0.2) {
    const goHome = home && night && dist(a.tile, home.tile) < 22;
    const f: Factor[] = [{ label: 'Cansaço', value: a.fatigue ** 1.5 * 1.25 }];
    if (night) f.push({ label: 'É noite', value: 0.12 + a.fatigue * 0.3 });
    if (goHome) f.push({ label: 'Abrigo por perto', value: 0.08 });
    add(Act.Rest, 'Descansar', f, () =>
      goHome ? intent(Act.Rest, home!.tile, 45, 'Indo dormir no abrigo') : { act: Act.Rest, tile: a.tile, path: [], work: 35, started: tick, label: 'Descansando' },
    );
  }
  if (season === 3 && a.cold > 0.2 && home && home.wood > 0.3) {
    add(Act.Warm, 'Aquecer-se no abrigo', [{ label: 'Frio', value: a.cold * 1.35 }], () =>
      intent(Act.Warm, home.tile, 28, 'Indo se aquecer no abrigo'),
    );
  }

  // ---- work -----------------------------------------------------------
  const stockTarget = 4 + 14 * ant;
  const stocked = a.food + (home ? home.food * 0.6 : 0);
  const prudence = t.diligence * ant * clamp(1 - stocked / stockTarget) * 0.75;

  const spot = bestSpot(a.foodMem, a.tile, 0.6);
  if (spot >= 0 && a.food < CARRY_FOOD - 1) {
    const amt = a.foodMem.get(spot)!.amt;
    const d = dist(a.tile, spot);
    add(Act.Forage, 'Coletar alimento', [
      { label: 'Fome', value: a.hunger * 0.85 },
      { label: 'Previdência (estocar)', value: prudence },
      { label: 'Local conhecido', value: clamp(amt / (1 + d * 0.08), 0, 4) * 0.05 },
      { label: 'Habilidade de coleta', value: a.skills.forage * 0.12 },
      { label: 'Cansaço', value: -a.fatigue * 0.15 },
    ], () => intent(Act.Forage, spot, 4, 'Indo coletar alimento'));
  }

  const foodKnown = spot >= 0 && a.foodMem.get(spot)!.amt > 1.2;
  const ef: Factor[] = [{ label: 'Curiosidade', value: t.curiosity * 0.22 }];
  if (!foodKnown) ef.push({ label: 'Não conhece comida', value: 0.12 + a.hunger * 0.55 + prudence * 0.5 });
  if (water < 0) ef.push({ label: 'Não conhece água', value: 0.1 + a.thirst * 1.1 });
  ef.push({ label: 'Cansaço', value: -a.fatigue * 0.25 });
  add(Act.Explore, 'Explorar o mundo', ef, () => {
    const tile = exploreTarget(sim, a);
    return tile >= 0 ? intent(Act.Explore, tile, 0, 'Explorando território', {}) : null;
  });

  let woodNeed = 0;
  let woodWhy = '';
  if (adult && a.home < 0 && a.wood < SHELTER_COST) {
    woodNeed = 0.22 + t.diligence * 0.25 + ant * 0.2;
    woodWhy = 'Quer construir abrigo';
  } else if (home && home.wood < 8) {
    woodNeed = ((8 - home.wood) / 8) * (season >= 2 ? 0.55 : 0.12) * (0.5 + t.diligence) * Math.max(0.3, ant);
    woodWhy = 'Lenha para o inverno';
  }
  const tree = bestSpot(a.woodMem, a.tile, 0.8);
  if (adult && tree >= 0 && a.wood < CARRY_WOOD && woodNeed + a.skills.wood * 0.1 > 0.03) {
    add(Act.Chop, 'Cortar lenha', [
      { label: woodWhy || 'Hábito', value: woodNeed },
      { label: 'Habilidade com lenha', value: a.skills.wood * 0.12 },
      { label: 'Fome', value: -a.hunger * 0.35 },
      { label: 'Cansaço', value: -a.fatigue * 0.2 },
    ], () => intent(Act.Chop, tree, 6, 'Indo cortar lenha'));
  }

  if (adult && a.home < 0 && a.wood >= SHELTER_COST) {
    add(Act.Build, 'Construir abrigo', [
      { label: 'Sem abrigo', value: 0.85 },
      { label: 'Inverno se aproxima', value: ant * 0.3 },
    ], () => {
      const site = buildSite(sim, a);
      return site >= 0 ? intent(Act.Build, site, Math.round(22 * (1 - a.skills.build * 0.5)), 'Indo construir abrigo') : null;
    });
  }

  if (home && (a.food >= 4 || a.wood >= 2)) {
    const d = dist(a.tile, home.tile);
    add(Act.Deposit, 'Guardar no abrigo', [
      { label: 'Excedente carregado', value: Math.max(0, a.food - 3) * 0.05 + a.wood * 0.03 },
      { label: 'Previdência', value: ant * t.diligence * 0.35 },
      { label: 'Distância', value: -d * 0.008 },
    ], () => intent(Act.Deposit, home.tile, 2, 'Levando suprimentos ao abrigo'));
  }

  // ---- social ---------------------------------------------------------
  const near = sim.agentsNear(a.tile, 10, a.id);

  if (a.loneliness > 0.15) {
    let best: Agent | null = null, bs = -1e9;
    for (const b of sim.agentsNear(a.tile, 26, a.id)) {
      const r = a.rel.get(b.id);
      const tr = a.trustIn(b.id);
      if (tr < -0.25) continue;
      const s = (tr + 0.45) * (0.5 + (r?.fam ?? 0)) + (a.kin.has(b.id) ? 0.3 : 0) - dist(a.tile, b.tile) * 0.015;
      if (s > bs) { bs = s; best = b; }
    }
    if (best) {
      const b = best;
      add(Act.Socialize, `Conversar com ${b.name}`, [
        { label: 'Solidão × sociabilidade', value: a.loneliness * (0.3 + t.sociability) * 0.85 },
        { label: `Afinidade com ${b.name}`, value: clamp(bs, -0.5, 1.2) * 0.15 },
        { label: 'Fome/Sede', value: -(a.hunger + a.thirst) * 0.25 },
      ], () => intent(Act.Socialize, b.tile, 6, `Indo conversar com ${b.name}`, { agent: b.id, adjacent: true }));
    }
  }

  const atHome = home !== null && dist(a.tile, home.tile) <= 1;
  const avail = a.food + (atHome ? home!.food : 0);
  const surplus = clamp((avail - 2 - a.hunger * 3) / 4);
  if (surplus > 0) {
    let best: Agent | null = null, bs = 0, bf: Factor[] = [];
    for (const b of near) {
      if (b.hunger < 0.45 || b.food >= 1 || (b.home >= 0 && b.home === a.home && sim.shelters[b.home].food >= 1)) continue;
      const tr = a.trustIn(b.id);
      const r = a.rel.get(b.id);
      const f: Factor[] = [
        { label: 'Generosidade', value: t.generosity * 0.45 * surplus },
        { label: `Necessidade de ${b.name}`, value: b.hunger * 0.35 * surplus },
        { label: 'Confiança', value: tr * 0.35 * surplus },
      ];
      if (a.kin.has(b.id)) f.push({ label: 'Parentesco', value: 0.35 * surplus });
      if (r && r.given > 0) f.push({ label: 'Retribuir ajuda recebida', value: Math.min(0.3, r.given * 0.05) * surplus });
      f.push({ label: 'Custo de doar', value: -0.12 });
      const s = f.reduce((x, y) => x + y.value, 0);
      if (s > bs) { bs = s; best = b; bf = f; }
    }
    if (best) {
      const b = best;
      add(Act.Share, `Doar comida a ${b.name}`, bf, () => {
        // fetch food from the store before walking over
        if (atHome && a.food < 3) {
          const take = Math.min(home!.food, 3 - a.food);
          home!.food -= take;
          a.food += take;
        }
        return intent(Act.Share, b.tile, 1, `Levando comida para ${b.name}`, { agent: b.id, adjacent: true });
      });
    }
  }

  if (a.hunger > 0.4 && a.food < 1) {
    let best: Agent | null = null, bs = -1;
    for (const b of near) {
      if (sim.available(b) < 3) continue;
      const tr = a.trustIn(b.id);
      const r = a.rel.get(b.id);
      const s = tr + (r && r.given > 0 ? 0.25 : 0) + (a.kin.has(b.id) ? 0.4 : 0) - dist(a.tile, b.tile) * 0.02;
      if (s > bs) { bs = s; best = b; }
    }
    if (best) {
      const b = best;
      add(Act.Ask, `Pedir comida a ${b.name}`, [
        { label: 'Fome', value: a.hunger * 0.55 },
        { label: `Confiança em ${b.name}`, value: clamp(bs, -1, 1) * 0.25 },
        { label: 'Orgulho (ousadia)', value: -t.boldness * 0.12 },
      ], () => intent(Act.Ask, b.tile, 1, `Indo pedir comida a ${b.name}`, { agent: b.id, adjacent: true }));
    }
  }

  if (adult && a.food < 5) {
    const greed = (1 - t.generosity) * t.boldness;
    const despair = a.hunger > 0.8 ? (a.hunger - 0.8) * 2.5 * (0.3 + t.boldness) * 0.5 : 0;
    let best: Agent | null = null, bs = 0, bf: Factor[] = [];
    for (const b of near) {
      if (b.food < 2 || a.kin.has(b.id)) continue;
      const tr = a.trustIn(b.id);
      const witnesses = sim.agentsNear(b.tile, 5, a.id).length - 1;
      const f: Factor[] = [
        { label: 'Fome', value: a.hunger * 0.5 },
        { label: 'Ganância', value: greed * 0.4 },
        { label: 'Desespero', value: despair },
        { label: `Oportunidade (${b.name} carrega ${Math.floor(b.food)})`, value: (Math.min(b.food, 8) / 8) * greed * 0.5 },
        { label: 'Ousadia', value: t.boldness * 0.15 },
        { label: tr < 0 ? `Rancor de ${b.name}` : `Confiança em ${b.name}`, value: -tr * 0.35 },
        { label: 'Testemunhas', value: -Math.max(0, witnesses) * 0.07 },
        { label: 'Norma internalizada', value: -0.15 - t.generosity * 0.15 },
      ];
      const s = f.reduce((x, y) => x + y.value, 0);
      if (s > bs) { bs = s; best = b; bf = f; }
    }
    if (best) {
      const b = best;
      add(Act.Steal, `Roubar de ${b.name}`, bf, () => intent(Act.Steal, b.tile, 1, `Aproximando-se de ${b.name}…`, { agent: b.id, adjacent: true }));
    }
    // unattended storehouses are tempting too
    let bestSh = -1, bss = 0, bsf: Factor[] = [];
    for (const sh of sim.shelters) {
      if (!sh.alive || sh.id === a.home || sh.food < 2) continue;
      const d = dist(a.tile, sh.tile);
      if (d > 14) continue;
      if (sh.owners.some((o) => a.kin.has(o))) continue;
      const guards = sim.agentsNear(sh.tile, 4, a.id).length;
      const tr = sh.owners.length ? sh.owners.reduce((s, o) => s + a.trustIn(o), 0) / sh.owners.length : -0.2;
      const f: Factor[] = [
        { label: 'Fome', value: a.hunger * 0.5 },
        { label: 'Ganância', value: greed * 0.4 },
        { label: 'Desespero', value: despair },
        { label: `Oportunidade (estoque de ${Math.floor(sh.food)})`, value: (Math.min(sh.food, 20) / 20) * greed * 0.5 },
        { label: 'Ousadia', value: t.boldness * 0.15 },
        { label: 'Confiança nos donos', value: -tr * 0.3 },
        { label: 'Pessoas por perto', value: -guards * 0.1 },
        { label: 'Distância', value: -d * 0.01 },
        { label: 'Norma internalizada', value: -0.18 - t.generosity * 0.15 },
      ];
      const s = f.reduce((x, y) => x + y.value, 0);
      if (s > bss) { bss = s; bestSh = sh.id; bsf = f; }
    }
    if (bestSh >= 0) {
      const sh = sim.shelters[bestSh];
      add(Act.Steal, 'Saquear estoque alheio', bsf, () => intent(Act.Steal, sh.tile, 2, 'Indo saquear um abrigo', { shelter: sh.id }));
    }
  }

  // barter: wood <-> food
  const wantsWood = sim.wantsWood(a);
  if ((!wantsWood && a.wood >= 3 && a.hunger > 0.3 && a.food < 2) || (wantsWood && a.food >= 4)) {
    const giveFood = wantsWood;
    let best: Agent | null = null, bs = -0.3;
    for (const b of near) {
      const bw = sim.wantsWood(b);
      if (giveFood ? bw || b.wood < 3 || b.food >= 6 : !bw || sim.available(b) < 4) continue;
      const s = a.trustIn(b.id) - dist(a.tile, b.tile) * 0.02;
      if (s > bs) { bs = s; best = b; }
    }
    if (best) {
      const b = best;
      add(Act.Trade, `Trocar ${giveFood ? 'comida por lenha' : 'lenha por comida'} com ${b.name}`, [
        { label: giveFood ? 'Precisa de lenha' : 'Fome', value: giveFood ? 0.3 : a.hunger * 0.5 },
        { label: 'Tem excedente para trocar', value: 0.12 },
        { label: `Confiança em ${b.name}`, value: bs * 0.2 },
      ], () => intent(Act.Trade, b.tile, 1, `Indo negociar com ${b.name}`, { agent: b.id, adjacent: true }));
    }
  }

  if (sim.cfg.flags.reproduction && adult && a.age(tick) < 6 && a.hunger < 0.45 && a.health > 0.7 &&
      tick - a.lastBirth > TICKS_PER_YEAR * 0.75 && sim.alive.length < sim.popCap()) {
    let best: Agent | null = null, bs = 0.35;
    for (const b of sim.agentsNear(a.tile, 20, a.id)) {
      if (!b.isAdult(tick) || a.kin.has(b.id)) continue;
      const tr = a.trustIn(b.id);
      if (tr > bs) { bs = tr; best = b; }
    }
    if (best) {
      const b = best;
      add(Act.Court, `Formar família com ${b.name}`, [
        { label: `Vínculo com ${b.name}`, value: (bs - 0.25) * 0.9 + 0.05 },
        { label: 'Sociabilidade', value: t.sociability * 0.1 },
        { label: 'Bem nutrido', value: (1 - a.hunger) * 0.1 },
        { label: 'Tem abrigo', value: home ? 0.12 : -0.05 },
        { label: 'Inverno', value: season === 3 ? -0.2 : 0 },
      ], () => intent(Act.Court, b.tile, 4, `Indo encontrar ${b.name}`, { agent: b.id, adjacent: true }));
    }
  }

  add(Act.Idle, 'Vagar', [{ label: 'Sem urgências', value: 0.04 }], () => {
    for (let k = 0; k < 8; k++) {
      const x = (a.tile % W) + sim.rng.int(9) - 4, y = ((a.tile / W) | 0) + sim.rng.int(9) - 4;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const tile = y * W + x;
      if (w.passable(tile)) return intent(Act.Idle, tile, 3, 'Vagando');
    }
    return null;
  });

  return out;
}

/** Best remembered resource spot by amount discounted by distance. */
export function bestSpot(mem: Map<number, { amt: number; t: number }>, from: number, minAmt: number) {
  let best = -1, bv = 0;
  for (const [tile, s] of mem) {
    if (s.amt < minAmt) continue;
    const v = Math.min(s.amt, 5) / (1 + dist(from, tile) * 0.09);
    if (v > bv) { bv = v; best = tile; }
  }
  return best;
}

function nearestWater(sim: Simulation, a: Agent) {
  let best = -1, bd = 1e9;
  for (const tile of a.waterMem.keys()) {
    const d = dist(a.tile, tile);
    if (d < bd) { bd = d; best = tile; }
  }
  return best;
}

function exploreTarget(sim: Simulation, a: Agent) {
  const w = sim.world;
  const ax = a.tile % W, ay = (a.tile / W) | 0;
  let best = -1, bs = -1;
  for (let k = 0; k < 18; k++) {
    const ang = sim.rng.next() * Math.PI * 2;
    const r = 8 + sim.rng.next() * 18;
    const x = Math.round(ax + Math.cos(ang) * r), y = Math.round(ay + Math.sin(ang) * r);
    if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
    const tile = y * W + x;
    if (!w.passable(tile)) continue;
    let unseen = 0;
    for (let dy = -4; dy <= 4; dy += 2)
      for (let dx = -4; dx <= 4; dx += 2) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && !a.seen[ny * W + nx]) unseen++;
      }
    const s = unseen + sim.rng.next() * 3;
    if (s > bs) { bs = s; best = tile; }
  }
  return best;
}

function buildSite(sim: Simulation, a: Agent): number {
  const w = sim.world;
  // settle near trusted friends' homes if possible — social geography
  let anchor = a.tile;
  let bt = 0.35;
  for (const [id, r] of a.rel) {
    const b = sim.byId.get(id);
    if (!b || !b.alive || b.home < 0) continue;
    if (r.trust > bt) { bt = r.trust; anchor = sim.shelters[b.home].tile; }
  }
  const ok = (i: number) => {
    if (!w.passable(i) || w.isDryBed(i)) return false;
    for (const sh of sim.shelters) if (sh.alive && dist(sh.tile, i) < 3) return false;
    return true;
  };
  const path = sim.pf.search(anchor, ok, 2500);
  if (!path) return ok(anchor) ? anchor : -1;
  return path.length ? path[path.length - 1] : anchor;
}
