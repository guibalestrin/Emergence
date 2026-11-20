import { RNG } from './rng';
import { World, PathFinder, dist } from './world';
import { Agent, Intent, makeName, randomTraits, inheritTraits, TRAIT_PRESETS } from './agent';
import { decide, anticipation } from './brain';
import { detectGroups, gini, Group } from './social';
import {
  Act,
  ACT_LABEL,
  CARRY_FOOD,
  CARRY_WOOD,
  DAYS_PER_SEASON as _DAYS_PER_SEASON,
  Fx,
  H as _H,
  LEARNED_ACTS,
  LearnedAct,
  NIGHT_START as _NIGHT_START,
  N_TILES as _N_TILES,
  SHELTER_COST,
  STORE_CAP,
  SEASONS,
  SimConfig,
  SimEvent,
  EventKind,
  TICKS_PER_DAY as _TICKS_PER_DAY,
  TICKS_PER_YEAR as _TICKS_PER_YEAR,
  Traits,
  W as _W,
  clamp,
} from './types';
const DAYS_PER_SEASON = _DAYS_PER_SEASON;
const H = _H;
const NIGHT_START = _NIGHT_START;
const N_TILES = _N_TILES;
const TICKS_PER_DAY = _TICKS_PER_DAY;
const TICKS_PER_YEAR = _TICKS_PER_YEAR;
const W = _W;

export interface Shelter {
  id: number;
  tile: number;
  owners: number[];
  food: number;
  wood: number;
  built: number;
  builder: number;
  alive: boolean;
}

export interface DayMetrics {
  day: number;
  season: number;
  pop: number;
  births: number;
  deaths: number;
  gini: number;
  shares: number;
  thefts: number;
  caught: number;
  trades: number;
  talks: number;
  refusals: number;
  conflicts: number;
  coop: number | null; // (shares+trades) / (shares+trades+thefts)
  trust: number; // mean pairwise trust among acquaintances
  outlook: number; // mean generalized trust in strangers
  groups: number;
  largestGroup: number; // fraction of population in the largest group
  households: number;
  health: number;
  worldFood: number;
  stored: number;
  specialization: number;
  qShare: number;
  qSteal: number;
  rainfall: number;
}

export interface Intervention {
  tick: number;
  label: string;
}

const DAY_COUNTERS = () => ({ shares: 0, thefts: 0, caught: 0, trades: 0, births: 0, deaths: 0, talks: 0, refusals: 0, conflicts: 0 });

export class Simulation {
  cfg: SimConfig;
  rng: RNG;
  world = new World();
  pf: PathFinder;
  tick = 0;
  agents: Agent[] = [];
  alive: Agent[] = [];
  byId = new Map<number, Agent>();
  shelters: Shelter[] = [];
  events: SimEvent[] = [];
  fx: Fx[] = [];
  history: DayMetrics[] = [];
  groups: Group[] = [];
  interventions: Intervention[] = [];
  nextId = 1;
  nextGroupId = 1;
  harshWinter = false;
  climate: { rain: number; until: number; label: string } | null = null;
  milestones = new Set<string>();
  day = DAY_COUNTERS();
  private discoveries = new Map<number, number>();

  constructor(cfg: SimConfig) {
    this.cfg = cfg;
    this.rng = new RNG(cfg.seed);
    this.pf = new PathFinder(this.world);
    this.world.generate(this.rng, cfg.abundance);
    this.populate(cfg.agents);
    this.recordDay();
  }

  // ---------------------------------------------------------------- time --
  season() {
    return Math.floor(this.tick / (TICKS_PER_DAY * DAYS_PER_SEASON)) % 4;
  }
  dayNumber() {
    return Math.floor(this.tick / TICKS_PER_DAY);
  }
  dayInSeason() {
    return this.dayNumber() % DAYS_PER_SEASON;
  }
  year() {
    return Math.floor(this.tick / TICKS_PER_YEAR) + 1;
  }
  timeOfDay() {
    return (this.tick % TICKS_PER_DAY) / TICKS_PER_DAY;
  }
  isNight() {
    return this.tick % TICKS_PER_DAY >= NIGHT_START;
  }
  popCap() {
    return 90;
  }
  dateLabel() {
    return `Ano ${this.year()} · ${SEASONS[this.season()]} · dia ${this.dayInSeason() + 1}`;
  }

  // -------------------------------------------------------------- set-up --
  private populate(n: number) {
    // a few scattered bands of strangers; nobody starts with relationships
    const centers: number[] = [];
    for (let k = 0; k < 400 && centers.length < 3; k++) {
      const x = 8 + this.rng.int(W - 16), y = 6 + this.rng.int(H - 12);
      const i = y * W + x;
      if (!this.world.passable(i)) continue;
      if (centers.some((c) => dist(c, i) < 18)) continue;
      // must reach water
      if (!this.pf.search(i, (j) => this.world.nearWater(j), 2500)) continue;
      centers.push(i);
    }
    if (!centers.length) centers.push(this.findPassable());
    for (let k = 0; k < n; k++) {
      const c = centers[k % centers.length];
      const tile = this.findNear(c, 6);
      const age = this.rng.range(1.6, 4.5);
      this.spawn(tile, randomTraits(this.rng), -age * TICKS_PER_YEAR);
    }
  }

  private findPassable() {
    for (;;) {
      const i = this.rng.int(N_TILES);
      if (this.world.passable(i)) return i;
    }
  }
  findNear(c: number, r: number) {
    const cx = c % W, cy = (c / W) | 0;
    for (let k = 0; k < 60; k++) {
      const x = cx + this.rng.int(2 * r + 1) - r, y = cy + this.rng.int(2 * r + 1) - r;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = y * W + x;
      if (this.world.passable(i)) return i;
    }
    return this.world.passable(c) ? c : this.findPassable();
  }

  spawn(tile: number, traits: Traits, born: number, name?: string): Agent {
    const a = new Agent(this.nextId++, name ?? makeName(this.rng), tile, born, traits, N_TILES);
    a.food = 2 + this.rng.int(2);
    a.wintersSeen = Math.max(0, Math.floor(a.age(this.tick)));
    a.hunger = this.rng.range(0.1, 0.3);
    a.thirst = this.rng.range(0.1, 0.3);
    a.fatigue = this.rng.range(0.1, 0.3);
    this.agents.push(a);
    this.alive.push(a);
    this.byId.set(a.id, a);
    this.see(a, 8);
    return a;
  }

  // ---------------------------------------------------------------- loop --
  step() {
    this.tick++;
    const season = this.season();
    if (this.climate && this.tick >= this.climate.until) {
      this.log('climate', `Fim de: ${this.climate.label}. O clima volta ao normal.`, []);
      this.climate = null;
    }
    this.world.rainfall = this.climate ? this.climate.rain : 1;
    this.world.step(this.rng, season, this.tick);

    const list = this.alive.slice();
    const off = this.tick % Math.max(1, list.length);
    for (let k = 0; k < list.length; k++) {
      const a = list[(k + off) % list.length];
      if (a.alive) this.stepAgent(a, season);
    }
    if (season === 3) this.burnFuel();
    this.spreadDisease();

    if (this.tick % 50 === 0) this.groups = detectGroups(this, this.groups, this.rng);
    if (this.tick % TICKS_PER_DAY === 0) this.endOfDay();
    if (this.fx.length > 200) this.fx.splice(0, this.fx.length - 200);
  }

  private stepAgent(a: Agent, season: number) {
    a.prevTile = a.tile;
    const child = !a.isAdult(this.tick);
    const acting = a.intent?.act;
    const resting = (acting === Act.Rest || acting === Act.Warm) && a.intent!.path.length === 0;

    // ---- needs ----
    a.hunger = clamp(a.hunger + (child ? 0.75 : 1) / (TICKS_PER_DAY * 1.6));
    a.thirst = clamp(a.thirst + 1 / (TICKS_PER_DAY * 0.9));
    if (!resting) a.fatigue = clamp(a.fatigue + 1 / (TICKS_PER_DAY * 1.1));
    a.loneliness = clamp(a.loneliness + (0.25 + a.traits.sociability) / (TICKS_PER_DAY * 2.2));
    if (season === 3 && !this.isWarm(a)) a.cold = clamp(a.cold + (this.harshWinter ? 1.7 : 1) / (TICKS_PER_DAY * 0.9));
    else a.cold = Math.max(0, a.cold - 0.04);

    // ---- health ----
    let dmg = 0;
    let cause = '';
    if (a.hunger >= 1) { dmg += 0.003; cause = 'fome'; }
    if (a.thirst >= 1) { dmg += 0.004; cause = 'sede'; }
    if (a.cold >= 1) { dmg += 0.0022; cause = cause || 'frio'; }
    if (a.sick > 0) { dmg += 0.0012; a.sick--; if (a.sick === 0) { a.immune = true; a.remember(this.tick, 'Recuperei-me da doença', 0.4); } cause = cause || 'doença'; }
    if (this.world.fire[a.tile] > 0) { dmg += 0.05; cause = 'incêndio'; }
    if (dmg > 0) a.health -= dmg;
    else if (a.hunger < 0.6 && a.thirst < 0.6 && a.cold < 0.6) a.health = Math.min(1, a.health + 0.0015);
    if (a.health <= 0) return this.die(a, cause || 'exaustão');
    const age = a.age(this.tick);
    if (age > 7 && this.rng.chance((age - 7) * 0.00005)) return this.die(a, 'velhice');

    if ((this.tick + a.id) % 4 === 0) this.see(a, 5);

    // ---- (re)decide ----
    const it = a.intent;
    if (!it) decide(this, a);
    else if ((this.tick + a.id) % 10 === 0) {
      const fire = it.act !== Act.Flee && this.fireNear(a.tile, 4) >= 0;
      const urgent = Math.max(a.hunger, a.thirst, a.cold) > 0.72 && !SERVES_URGENT.has(it.act);
      const stale = this.tick - it.started > 60;
      if (fire || urgent || stale) decide(this, a, it.act);
    }
    this.exec(a);
  }

  private exec(a: Agent) {
    const it = a.intent;
    if (!it) return;
    const w = this.world;

    if (it.agent !== undefined) {
      const b = this.byId.get(it.agent);
      if (!b || !b.alive) return this.fail(a, 'O outro não estava mais lá');
      if (dist(a.tile, b.tile) > 1) {
        if (it.path.length === 0 || (dist(it.tile, b.tile) > 1 && this.tick % 3 === 0)) {
          const p = this.pf.to(a.tile, b.tile, true);
          if (!p) return this.fail(a, `Não conseguiu alcançar ${b.name}`);
          it.path = p;
          it.tile = b.tile;
        }
      } else it.path.length = 0;
    }

    if (it.path.length > 0) {
      const next = it.path[0];
      if (!w.passable(next)) {
        const p = this.pf.to(a.tile, it.tile, it.adjacent ?? false);
        if (!p) return this.fail(a, 'Caminho bloqueado');
        it.path = p;
        return;
      }
      a.tile = next;
      it.path.shift();
      return;
    }

    // arrived: work
    if (it.work > 0) {
      it.work--;
      const home = a.home >= 0 ? this.shelters[a.home] : null;
      const atHome = home !== null && dist(a.tile, home.tile) <= 1;
      if (it.act === Act.Rest) {
        a.fatigue = Math.max(0, a.fatigue - 0.022 * (atHome ? 1.7 : 1));
        if (a.fatigue < 0.03) it.work = 0;
      } else if (it.act === Act.Warm) {
        a.fatigue = Math.max(0, a.fatigue - 0.01);
        if (a.cold <= 0) it.work = 0;
      }
      if (it.work > 0) return;
    }
    a.intent = null;
    this.complete(a, it);
  }

  private fail(a: Agent, why: string) {
    a.intent = null;
    a.lastChoice = a.lastChoice.length ? a.lastChoice : [];
    void why;
  }

  private learn(a: Agent, act: Act, reward: number) {
    if (!this.cfg.flags.learning) return;
    if (!(LEARNED_ACTS as readonly Act[]).includes(act)) return;
    const k = act as LearnedAct;
    const lr = 0.08 + 0.14 * a.traits.curiosity;
    a.q[k] += lr * (clamp(reward, -1, 1) - a.q[k]);
  }

  private labor(a: Agent, act: Act) {
    a.recentLabor.push(act);
    if (a.recentLabor.length > 30) a.recentLabor.shift();
  }

  private complete(a: Agent, it: Intent) {
    const w = this.world;
    const tick = this.tick;
    switch (it.act) {
      case Act.Eat: {
        const n = Math.min(a.food, Math.ceil((a.hunger - 0.05) / 0.38));
        if (n > 0) { a.food -= n; a.hunger = Math.max(0, a.hunger - 0.38 * n); }
        break;
      }
      case Act.Drink: {
        if (w.nearWater(a.tile)) a.thirst = 0;
        else {
          a.waterMem.delete(it.tile);
          a.remember(tick, 'A água que eu conhecia secou', -0.4);
        }
        break;
      }
      case Act.Withdraw: {
        const sh = this.shelters[a.home];
        if (!sh || dist(a.tile, sh.tile) > 1) break;
        const take = Math.min(sh.food, 3, CARRY_FOOD - a.food);
        if (take >= 0.5) {
          sh.food -= take;
          a.food += take;
          // the payoff of having stored earlier reinforces the habit of storing
          this.learn(a, Act.Deposit, 0.55);
        } else a.remember(tick, 'Encontrei o estoque do abrigo vazio', -0.5);
        break;
      }
      case Act.Forage: {
        const avail = w.food[a.tile];
        const h = Math.max(0, Math.min(avail, 0.7 + a.skills.forage * 1.6, CARRY_FOOD - a.food));
        a.food += h;
        w.food[a.tile] -= h;
        a.foodMem.set(a.tile, { amt: w.food[a.tile], t: tick });
        a.skills.forage = Math.min(1, a.skills.forage + 0.012 * (1 - a.skills.forage));
        a.stats.harvested += h;
        this.labor(a, Act.Forage);
        if (h < 0.3) {
          a.remember(tick, 'Fui coletar e não havia mais comida', -0.25);
          // competition: resentment toward whoever is foraging around the emptied spot
          for (const o of this.agentsNear(a.tile, 2, a.id)) {
            if (o.intent?.act === Act.Forage || o.food > a.food + 2) {
              a.adjustTrust(o.id, -0.06 * (0.5 + a.hunger), tick);
              this.day.conflicts++;
            }
          }
        }
        this.learn(a, Act.Forage, h >= 0.3 ? Math.min(0.7, h * 0.22) : -0.35);
        break;
      }
      case Act.Explore: {
        const found = this.discoveries.get(a.id) ?? 0;
        this.discoveries.set(a.id, 0);
        if (found > 0) a.remember(tick, `Descobri ${found} novos locais com comida`, 0.3);
        this.learn(a, Act.Explore, found > 0 ? Math.min(0.6, 0.2 + found * 0.08) : -0.15);
        break;
      }
      case Act.Chop: {
        const avail = w.wood[a.tile];
        const h = Math.max(0, Math.min(avail, 0.8 + a.skills.wood * 1.5, CARRY_WOOD - a.wood));
        a.wood += h;
        w.wood[a.tile] -= h;
        a.woodMem.set(a.tile, { amt: w.wood[a.tile], t: tick });
        a.skills.wood = Math.min(1, a.skills.wood + 0.012 * (1 - a.skills.wood));
        this.labor(a, Act.Chop);
        this.learn(a, Act.Chop, h >= 0.3 ? Math.min(0.7, h * 0.2) : -0.3);
        break;
      }
      case Act.Build: {
        if (a.home >= 0 || a.wood < SHELTER_COST || !w.passable(a.tile)) break;
        if (this.shelters.some((s) => s.alive && dist(s.tile, a.tile) < 2)) break;
        const sh: Shelter = { id: this.shelters.length, tile: a.tile, owners: [a.id], food: 0, wood: 0, built: tick, builder: a.id, alive: true };
        this.shelters.push(sh);
        w.shelterAt[a.tile] = sh.id;
        w.version++;
        a.wood -= SHELTER_COST;
        a.home = sh.id;
        a.skills.build = Math.min(1, a.skills.build + 0.2);
        a.remember(tick, 'Construí meu abrigo', 0.6);
        this.log('build', `${a.name} construiu um abrigo`, [a.id], a.tile);
        this.milestone('shelter', 'Primeiro abrigo construído — o começo de assentamentos', [a.id]);
        break;
      }
      case Act.Deposit: {
        const sh = this.shelters[a.home];
        if (!sh || dist(a.tile, sh.tile) > 1) break;
        const f = Math.max(0, Math.min(a.food - 2, STORE_CAP - sh.food));
        sh.food += f; a.food -= f;
        sh.wood += a.wood; a.wood = 0;
        this.learn(a, Act.Deposit, 0.05);
        break;
      }
      case Act.Socialize: this.talk(a, this.byId.get(it.agent!)!); break;
      case Act.Share: this.give(a, this.byId.get(it.agent!)!, true); break;
      case Act.Ask: this.ask(a, this.byId.get(it.agent!)!); break;
      case Act.Steal:
        if (it.shelter !== undefined) this.raid(a, this.shelters[it.shelter]);
        else this.steal(a, this.byId.get(it.agent!)!);
        break;
      case Act.Trade: this.trade(a, this.byId.get(it.agent!)!); break;
      case Act.Court: this.court(a, this.byId.get(it.agent!)!); break;
      default: break;
    }
  }

  // ------------------------------------------------------ social actions --
  private talk(a: Agent, b: Agent) {
    if (!b || !b.alive || dist(a.tile, b.tile) > 1) return;
    const tick = this.tick;
    if (b.trustIn(a.id) < -0.3) {
      a.adjustTrust(b.id, -0.04, tick);
      a.remember(tick, `${b.name} se recusou a falar comigo`, -0.3);
      this.addFx('refuse', a, b);
      this.learn(a, Act.Socialize, -0.25);
      return;
    }
    this.day.talks++;
    a.stats.talks++; b.stats.talks++;
    a.loneliness = Math.max(0, a.loneliness - 0.7);
    b.loneliness = Math.max(0, b.loneliness - 0.5);
    // mere-exposure effect: talking builds trust, but with diminishing returns
    const fam = (a.getRel(b.id, tick).fam + b.getRel(a.id, tick).fam) / 2;
    const warmth = (0.03 + 0.03 * (a.traits.sociability + b.traits.sociability) / 2) * (1 - fam * 0.6) * (a.hunger > 0.7 ? 0.3 : 1);
    a.adjustTrust(b.id, warmth, tick);
    b.adjustTrust(a.id, warmth, tick);
    a.getRel(b.id, tick).fam = clamp(a.getRel(b.id, tick).fam + 0.08);
    b.getRel(a.id, tick).fam = clamp(b.getRel(a.id, tick).fam + 0.08);

    let learned = 0;
    if (this.cfg.flags.knowledgeSharing) {
      learned += this.shareKnowledge(a, b);
      this.shareKnowledge(b, a);
    }
    if (this.cfg.flags.gossip) {
      this.gossip(a, b);
      this.gossip(b, a);
    }
    // households form between people who trust each other deeply
    this.maybeJoinHousehold(a, b);
    this.maybeJoinHousehold(b, a);
    this.addFx('talk', a, b);
    this.learn(a, Act.Socialize, 0.12 + a.traits.sociability * 0.15 + Math.min(0.25, learned * 0.12));
  }

  /** `from` tells `to` the best food spots it knows that `to` doesn't. */
  private shareKnowledge(from: Agent, to: Agent): number {
    if (from.trustIn(to.id) < -0.1) return 0;
    const spots = [...from.foodMem.entries()].filter(([, s]) => s.amt > 1.5).sort((x, y) => y[1].amt - x[1].amt);
    let n = 0;
    for (const [tile, s] of spots) {
      const mine = to.foodMem.get(tile);
      if (mine && mine.t >= s.t) continue;
      to.foodMem.set(tile, { ...s });
      if (++n >= 2) break;
    }
    for (const [tile, t] of from.waterMem) {
      if (!to.waterMem.has(tile)) { to.waterMem.set(tile, t); break; }
    }
    return n;
  }

  /** `s` tells `l` its strongest opinion about someone else. */
  private gossip(s: Agent, l: Agent) {
    let target = -1, strongest = 0.25;
    for (const [id, r] of s.rel) {
      if (id === l.id || r.fam < 0.15) continue;
      const o = this.byId.get(id);
      if (!o || !o.alive) continue;
      if (Math.abs(r.trust) > strongest) { strongest = Math.abs(r.trust); target = id; }
    }
    if (target < 0) return;
    const credibility = clamp(l.trustIn(s.id));
    if (credibility <= 0) return;
    const opinion = s.rel.get(target)!.trust;
    const lr = l.getRel(target, this.tick);
    lr.trust = clamp(lr.trust + 0.3 * credibility * (opinion - lr.trust), -1, 1);
    lr.fam = clamp(lr.fam + 0.02);
    if (opinion < -0.4) l.remember(this.tick, `${s.name} me alertou sobre ${this.byId.get(target)!.name}`, -0.15);
  }

  private maybeJoinHousehold(host: Agent, guest: Agent) {
    if (host.home < 0 || guest.home >= 0 || !guest.isAdult(this.tick)) return;
    if (host.trustIn(guest.id) < 0.5 || guest.trustIn(host.id) < 0.5) return;
    const sh = this.shelters[host.home];
    if (sh.owners.length >= 5) return;
    sh.owners.push(guest.id);
    guest.home = sh.id;
    guest.remember(this.tick, `${host.name} me acolheu em seu abrigo`, 0.7);
    host.remember(this.tick, `Acolhi ${guest.name} no meu abrigo`, 0.4);
    this.log('household', `${guest.name} passou a morar com ${host.name} (confiança mútua alta)`, [host.id, guest.id], sh.tile);
    this.milestone('household', 'Primeiro lar compartilhado entre não-parentes', [host.id, guest.id]);
  }

  private give(a: Agent, b: Agent, voluntary: boolean) {
    if (!b || !b.alive || dist(a.tile, b.tile) > 1) return false;
    const amt = Math.min(Math.floor(this.available(a) - 1), 3, Math.max(1, Math.ceil(b.hunger * 3)));
    if (amt < 1) return false;
    const tick = this.tick;
    this.takeFood(a, amt);
    b.food = Math.min(CARRY_FOOD + 3, b.food + amt);
    a.stats.given += amt; b.stats.received += amt;
    const rb = b.getRel(a.id, tick);
    rb.given += amt;
    b.adjustTrust(a.id, 0.2, tick);
    a.adjustTrust(b.id, 0.05, tick);
    a.getRel(b.id, tick).gaveTo += amt;
    if (!b.kin.has(a.id)) b.outlook = clamp(b.outlook + 0.03, -1, 1);
    // reciprocity: if b had helped a before, b's past generosity paid off
    const ra = a.rel.get(b.id);
    void ra;
    const back = b.rel.get(a.id);
    if (back && back.gaveTo > 0) this.learn(b, Act.Share, 0.6);
    // bystanders form an opinion: indirect reputation for generosity
    for (const o of this.agentsNear(a.tile, 5, a.id)) {
      if (o.id === b.id) continue;
      o.adjustTrust(a.id, 0.05, tick);
    }
    b.remember(tick, `${a.name} me deu ${amt} de comida`, 0.6);
    a.remember(tick, `Dei ${amt} de comida para ${b.name}`, 0.25);
    this.day.shares++;
    this.addFx('share', a, b);
    this.log('share', `${a.name} ${voluntary ? 'doou' : 'cedeu'} ${amt} de comida a ${b.name}`, [a.id, b.id], a.tile);
    if (voluntary) this.learn(a, Act.Share, a.traits.generosity * 0.5 - 0.1 + (a.kin.has(b.id) ? 0.25 : 0));
    this.milestone('share', 'Primeiro ato de partilha entre indivíduos', [a.id, b.id]);
    return true;
  }

  private ask(a: Agent, b: Agent) {
    if (!b || !b.alive || dist(a.tile, b.tile) > 1) return;
    const tick = this.tick;
    const rel = b.rel.get(a.id);
    const willing =
      b.traits.generosity * 0.5 +
      b.trustIn(a.id) * 0.45 +
      (b.kin.has(a.id) ? 0.5 : 0) +
      (rel && rel.given > 0 ? 0.25 : 0) - // a helped b before → b reciprocates
      b.hunger * 0.45 -
      0.28 +
      this.rng.gauss() * 0.08;
    if (this.available(b) >= 2 && willing > 0 && this.give(b, a, false)) {
      this.learn(a, Act.Ask, 0.5);
      return;
    }
    this.day.refusals++;
    a.adjustTrust(b.id, -0.07, tick);
    a.remember(tick, `${b.name} recusou meu pedido de comida`, -0.35);
    this.addFx('refuse', a, b);
    this.learn(a, Act.Ask, -0.3);
  }

  private witnesses(tile: number, ...exclude: number[]) {
    return this.agentsNear(tile, 5, -1).filter((o) => !exclude.includes(o.id) && this.rng.chance(0.45));
  }

  private steal(a: Agent, b: Agent) {
    if (!b || !b.alive || dist(a.tile, b.tile) > 1 || b.food < 1) return;
    const tick = this.tick;
    const amt = Math.min(Math.floor(b.food), 2 + Math.floor(a.traits.boldness * 2), CARRY_FOOD - Math.floor(a.food));
    if (amt <= 0) return;
    b.food -= amt;
    a.food += amt;
    a.stats.stolen += amt; b.stats.victim += amt;
    const victimSaw = this.rng.chance(0.55);
    const seen = this.witnesses(a.tile, a.id, b.id);
    let recovered = false;
    if (victimSaw) {
      b.adjustTrust(a.id, -0.6, tick);
      b.getRel(a.id, tick).taken += amt;
      b.outlook = clamp(b.outlook - 0.06, -1, 1);
      b.remember(tick, `${a.name} roubou minha comida`, -0.8);
      // bold victims confront the thief
      if (this.rng.chance(b.traits.boldness * 0.8)) {
        const back = Math.min(amt, a.food);
        a.food -= back; b.food += back;
        a.health -= 0.08; b.health -= 0.05;
        a.adjustTrust(b.id, -0.25, tick);
        recovered = true;
        b.remember(tick, `Enfrentei ${a.name} e recuperei minha comida`, 0.1);
      }
    } else {
      b.outlook = clamp(b.outlook - 0.05, -1, 1);
      b.remember(tick, 'Alguém levou minha comida sem eu ver', -0.5);
    }
    let punisher: Agent | null = null;
    for (const o of seen) {
      o.adjustTrust(a.id, -0.35, tick);
      o.adjustTrust(b.id, 0.03, tick);
      o.remember(tick, `Vi ${a.name} roubando ${b.name}`, -0.4);
      // third-party punishment: a bold bystander who cares about the victim intervenes
      const care = 0.4 * o.traits.boldness + 0.3 * o.traits.generosity + 0.3 * Math.max(0, o.trustIn(b.id)) - (o.kin.has(a.id) ? 1 : 0);
      if (!recovered && !punisher && this.rng.chance(care * 0.7)) punisher = o;
    }
    if (punisher) {
      const back = Math.min(amt, a.food);
      a.food -= back; b.food += back;
      a.health -= 0.06; punisher.health -= 0.02;
      a.adjustTrust(punisher.id, -0.3, tick);
      b.adjustTrust(punisher.id, 0.25, tick);
      punisher.remember(tick, `Obriguei ${a.name} a devolver o que roubou de ${b.name}`, 0.2);
      a.remember(tick, `${punisher.name} me obrigou a devolver a comida`, -0.5);
      b.remember(tick, `${punisher.name} me defendeu de ${a.name}`, 0.6);
      recovered = true;
      this.milestone('punish', 'Primeira punição por terceiros: alguém defendeu uma vítima que não era da família', [punisher.id, a.id]);
    }
    const caught = victimSaw || seen.length > 0;
    if (caught) { a.stats.caught++; this.day.caught++; }
    this.day.thefts++;
    this.addFx(caught ? 'caught' : 'steal', a, b);
    this.log('theft',
      `${a.name} roubou ${amt} de comida de ${b.name}` +
        (punisher ? ` — ${punisher.name} interveio e obrigou a devolução` : recovered ? ' — e foi confrontado(a); a comida foi recuperada' : caught ? ` — visto por ${victimSaw ? 'a vítima' : ''}${victimSaw && seen.length ? ' e ' : ''}${seen.length ? seen.length + ' testemunha(s)' : ''}` : ' — ninguém percebeu'),
      [a.id, b.id], a.tile);
    a.remember(tick, caught ? `Fui pego roubando ${b.name}` : `Roubei ${b.name} sem ser visto`, caught ? -0.5 : 0.1);
    this.learn(a, Act.Steal, (caught ? -0.55 : 0.25 + amt * 0.08) - a.traits.generosity * 0.25 - (recovered ? 0.3 : 0));
    this.milestone('theft', 'Primeiro roubo registrado', [a.id, b.id]);
  }

  private raid(a: Agent, sh: Shelter) {
    if (!sh || !sh.alive || dist(a.tile, sh.tile) > 1 || sh.food < 1) return;
    const tick = this.tick;
    const amt = Math.min(Math.floor(sh.food), 4, CARRY_FOOD - Math.floor(a.food));
    if (amt <= 0) return;
    sh.food -= amt;
    a.food += amt;
    a.stats.stolen += amt;
    const seen = this.witnesses(a.tile, a.id);
    for (const o of seen) {
      const owner = sh.owners.includes(o.id);
      o.adjustTrust(a.id, owner ? -0.6 : -0.3, tick);
      o.remember(tick, owner ? `${a.name} saqueou nosso abrigo` : `Vi ${a.name} saqueando um abrigo`, -0.5);
    }
    for (const oid of sh.owners) {
      const o = this.byId.get(oid);
      if (o) o.outlook = clamp(o.outlook - 0.04, -1, 1);
    }
    const caught = seen.length > 0;
    if (caught) { a.stats.caught++; this.day.caught++; }
    this.day.thefts++;
    this.addFxTiles(caught ? 'caught' : 'steal', a.tile, sh.tile);
    const ownerName = sh.owners.length ? this.byId.get(sh.owners[0])?.name ?? '?' : 'ninguém';
    this.log('theft', `${a.name} saqueou ${amt} de comida do abrigo de ${ownerName}${caught ? ` (visto por ${seen.length})` : ' sem ser visto'}`, [a.id, ...sh.owners.slice(0, 2)], sh.tile);
    this.learn(a, Act.Steal, (caught ? -0.55 : 0.3 + amt * 0.06) - a.traits.generosity * 0.25);
  }

  private trade(a: Agent, b: Agent) {
    if (!b || !b.alive || dist(a.tile, b.tile) > 1) return;
    const tick = this.tick;
    const aw = this.wantsWood(a), bw = this.wantsWood(b);
    let ok = false;
    let what = '';
    const accept = b.trustIn(a.id) > -0.15;
    if (aw && !bw && a.food >= 4 && b.wood >= 3 && b.food < 6) {
      if (accept) { a.food -= 2; b.food += 2; b.wood -= 3; a.wood += 3; ok = true; what = '2 comida por 3 lenha'; }
    } else if (!aw && bw && a.wood >= 3 && this.available(b) >= 4) {
      if (accept) { a.wood -= 3; b.wood += 3; this.takeFood(b, 2); a.food += 2; ok = true; what = '3 lenha por 2 comida'; }
    }
    if (ok) {
      a.adjustTrust(b.id, 0.08, tick);
      b.adjustTrust(a.id, 0.08, tick);
      a.stats.trades++; b.stats.trades++;
      this.day.trades++;
      this.addFx('trade', a, b);
      this.log('trade', `${a.name} e ${b.name} trocaram ${what}`, [a.id, b.id], a.tile);
      this.learn(a, Act.Trade, 0.45);
      this.learn(b, Act.Trade, 0.25);
      this.milestone('trade', 'Primeira troca: surge uma economia de escambo', [a.id, b.id]);
    } else {
      a.adjustTrust(b.id, -0.02, tick);
      this.addFx('refuse', a, b);
      this.learn(a, Act.Trade, -0.2);
    }
  }

  private court(a: Agent, b: Agent) {
    if (!b || !b.alive || dist(a.tile, b.tile) > 1) return;
    const tick = this.tick;
    const ok =
      this.cfg.flags.reproduction &&
      b.isAdult(tick) &&
      b.trustIn(a.id) > 0.35 &&
      b.hunger < 0.6 &&
      tick - b.lastBirth > TICKS_PER_YEAR * 0.75 &&
      this.alive.length < this.popCap();
    if (!ok) {
      a.adjustTrust(b.id, -0.03, tick);
      return;
    }
    const traits = inheritTraits(this.rng, a.traits, b.traits);
    const c = this.spawn(a.tile, traits, tick);
    c.food = 0;
    const gift = Math.min(1, a.food) + Math.min(1, b.food);
    a.food -= Math.min(1, a.food); b.food -= Math.min(1, b.food);
    c.food = gift;
    c.hunger = 0.3;
    a.hunger = clamp(a.hunger + 0.15); b.hunger = clamp(b.hunger + 0.15);
    a.lastBirth = b.lastBirth = tick;
    c.parents = [a.id, b.id];
    for (const p of [a, b]) {
      p.children.push(c.id);
      p.kin.add(c.id);
      c.kin.add(p.id);
      for (const sib of p.children) if (sib !== c.id) { c.kin.add(sib); this.byId.get(sib)?.kin.add(c.id); }
      p.getRel(c.id, tick).trust = 0.85;
      p.getRel(c.id, tick).fam = 0.6;
      c.getRel(p.id, tick).trust = 0.85;
      c.getRel(p.id, tick).fam = 0.6;
    }
    // cultural transmission: outlook, strategy values and knowledge are learned from parents
    c.outlook = (a.outlook + b.outlook) / 2;
    for (const k of LEARNED_ACTS) c.q[k] = (a.q[k] + b.q[k]) / 4;
    c.wintersSeen = Math.min(1, (a.wintersSeen + b.wintersSeen) / 4);
    for (const p of [a, b]) {
      [...p.foodMem.entries()].sort((x, y) => y[1].amt - x[1].amt).slice(0, 6).forEach(([t, s]) => c.foodMem.set(t, { ...s }));
      for (const [t, s] of p.waterMem) c.waterMem.set(t, s);
    }
    // home
    const home = a.home >= 0 ? a.home : b.home;
    if (home >= 0) {
      const sh = this.shelters[home];
      c.home = home;
      sh.owners.push(c.id);
      const other = a.home >= 0 ? b : a;
      if (other.home < 0) { other.home = home; sh.owners.push(other.id); }
    }
    a.adjustTrust(b.id, 0.15, tick);
    b.adjustTrust(a.id, 0.15, tick);
    a.remember(tick, `Nasceu meu filho(a) ${c.name}, com ${b.name}`, 0.9);
    b.remember(tick, `Nasceu meu filho(a) ${c.name}, com ${a.name}`, 0.9);
    this.day.births++;
    this.addFx('birth', a, b);
    this.log('birth', `Nasceu ${c.name}, filho(a) de ${a.name} e ${b.name}`, [c.id, a.id, b.id], c.tile);
    this.milestone('birth', 'Primeiro nascimento: a sociedade começa a se renovar', [c.id]);
  }

  // ----------------------------------------------------------- perception --
  private see(a: Agent, r: number) {
    const w = this.world;
    const ax = a.tile % W, ay = (a.tile / W) | 0;
    const tick = this.tick;
    for (let dy = -r; dy <= r; dy++) {
      const y = ay + dy;
      if (y < 0 || y >= H) continue;
      for (let dx = -r; dx <= r; dx++) {
        const x = ax + dx;
        if (x < 0 || x >= W) continue;
        const i = y * W + x;
        a.seen[i] = 1;
        const f = w.food[i];
        if (f > 0.8) {
          if (!a.foodMem.has(i) && f > 1.5) this.discoveries.set(a.id, (this.discoveries.get(a.id) ?? 0) + 1);
          a.foodMem.set(i, { amt: f, t: tick });
        } else if (a.foodMem.has(i)) a.foodMem.delete(i);
        if (w.wood[i] > 1.5) a.woodMem.set(i, { amt: w.wood[i], t: tick });
        else if (a.woodMem.has(i)) a.woodMem.delete(i);
        if (w.isWater(i)) {
          if ((dx + dy) % 2 === 0 && w.nearWaterEdge(i)) a.waterMem.set(i, tick);
        } else if (a.waterMem.has(i)) a.waterMem.delete(i);
      }
    }
    trimMap(a.foodMem, 45, (s) => s.amt - (tick - s.t) / 2000);
    trimMap(a.woodMem, 20, (s) => s.amt - (tick - s.t) / 2000);
    if (a.waterMem.size > 10) {
      let far = -1, fd = -1;
      for (const t of a.waterMem.keys()) { const d = dist(a.tile, t); if (d > fd) { fd = d; far = t; } }
      a.waterMem.delete(far);
    }
  }

  fireNear(tile: number, r: number) {
    const w = this.world;
    if (w.burningCount === 0) return -1;
    const ax = tile % W, ay = (tile / W) | 0;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const x = ax + dx, y = ay + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        if (w.fire[y * W + x] > 0) return y * W + x;
      }
    return -1;
  }

  // coarse spatial hash, rebuilt lazily once per tick
  private grid: Agent[][] = [];
  private gridTick = -1;
  private static CELL = 6;
  private buildGrid() {
    const C = Simulation.CELL;
    const gw = Math.ceil(W / C), gh = Math.ceil(H / C);
    if (this.grid.length !== gw * gh) this.grid = Array.from({ length: gw * gh }, () => []);
    for (const g of this.grid) g.length = 0;
    for (const a of this.alive) this.grid[(((a.tile / W) | 0) / C | 0) * gw + ((a.tile % W) / C | 0)].push(a);
    this.gridTick = this.tick;
  }
  agentsNear(tile: number, r: number, exclude: number): Agent[] {
    if (this.gridTick !== this.tick) this.buildGrid();
    const C = Simulation.CELL;
    const gw = Math.ceil(W / C), gh = Math.ceil(H / C);
    const x = tile % W, y = (tile / W) | 0;
    const out: Agent[] = [];
    const x0 = Math.max(0, ((x - r) / C) | 0), x1 = Math.min(gw - 1, ((x + r) / C) | 0);
    const y0 = Math.max(0, ((y - r) / C) | 0), y1 = Math.min(gh - 1, ((y + r) / C) | 0);
    for (let gy = y0; gy <= y1; gy++)
      for (let gx = x0; gx <= x1; gx++)
        for (const b of this.grid[gy * gw + gx]) if (b.alive && b.id !== exclude && dist(tile, b.tile) <= r) out.push(b);
    out.sort((p, q) => p.id - q.id); // deterministic order
    return out;
  }

  isWarm(a: Agent) {
    for (const sh of this.shelters) {
      if (!sh.alive || sh.wood <= 0 || dist(a.tile, sh.tile) > 1) continue;
      if (sh.owners.includes(a.id)) return true;
      // hospitality: trusted visitors may warm themselves at a friend's fire
      if (sh.owners.some((o) => (this.byId.get(o)?.trustIn(a.id) ?? 0) > 0.5)) return true;
    }
    return false;
  }

  private burnFuel() {
    const rate = 0.011 * (this.harshWinter ? 1.5 : 1);
    for (const sh of this.shelters) if (sh.alive && sh.owners.length && sh.wood > 0) sh.wood = Math.max(0, sh.wood - rate);
  }

  private spreadDisease() {
    for (const a of this.alive) {
      if (a.sick <= 0) continue;
      a.fatigue = clamp(a.fatigue + 0.002);
      for (const b of this.alive) {
        if (b.sick > 0 || b.immune || dist(a.tile, b.tile) > 1) continue;
        const talking = a.intent?.act === Act.Socialize || b.intent?.act === Act.Socialize;
        if (this.rng.chance(talking ? 0.05 : 0.012)) this.infect(b);
      }
    }
  }

  infect(a: Agent) {
    if (a.sick > 0 || a.immune) return false;
    a.sick = 350 + this.rng.int(250);
    a.remember(this.tick, 'Fiquei doente', -0.5);
    return true;
  }

  // ---------------------------------------------------------- life/death --
  private die(a: Agent, cause: string) {
    a.alive = false;
    a.deathCause = cause;
    a.deathTick = this.tick;
    a.intent = null;
    this.alive = this.alive.filter((x) => x !== a);
    if (a.food > 0) this.world.food[a.tile] += a.food;
    if (a.home >= 0) {
      const sh = this.shelters[a.home];
      sh.owners = sh.owners.filter((o) => o !== a.id);
    }
    for (const b of this.alive) {
      const r = b.rel.get(a.id);
      if ((r && r.trust > 0.5) || b.kin.has(a.id)) {
        b.remember(this.tick, `${a.name} morreu (${cause})`, -0.8);
        b.loneliness = clamp(b.loneliness + 0.3);
      }
    }
    this.day.deaths++;
    this.addFxTiles('death', a.tile, a.tile);
    this.log('death', `${a.name} morreu de ${cause} aos ${a.age(this.tick).toFixed(1)} anos`, [a.id], a.tile);
  }

  private endOfDay() {
    const tick = this.tick;
    // learned values slowly regress: old lessons fade, enabling re-trial
    for (const a of this.alive) {
      for (const k of LEARNED_ACTS) a.q[k] *= 0.97;
      a.outlook += (0.1 - a.outlook) * 0.005;
      // relationships that are not maintained drift back toward indifference
      for (const r of a.rel.values()) {
        if (tick - r.last > TICKS_PER_DAY * 3) { r.trust *= 0.985; r.fam *= 0.99; }
      }
      a.outlookHistory.push(a.outlook);
      if (a.outlookHistory.length > 120) a.outlookHistory.shift();
    }
    // stored food spoils a little
    for (const sh of this.shelters) {
      if (!sh.alive) continue;
      sh.food *= 0.96;
      if (sh.owners.length === 0) {
        // abandoned: a homeless adult nearby who trusted the former owners may claim it
        const c = this.agentsNear(sh.tile, 8, -1).find((x) => x.home < 0 && x.isAdult(tick));
        if (c) {
          sh.owners.push(c.id);
          c.home = sh.id;
          this.log('household', `${c.name} ocupou um abrigo abandonado`, [c.id], sh.tile);
        }
      }
    }
    // a winter just ended → survivors gain experience
    if (this.season() === 0 && this.dayInSeason() === 0 && this.tick > TICKS_PER_DAY) {
      for (const a of this.alive) a.wintersSeen++;
      this.log('climate', `Fim do inverno. ${this.alive.length} indivíduos sobreviveram.`, []);
    }
    if (this.dayInSeason() === 0) {
      const s = this.season();
      if (s === 3) this.log('climate', 'Começa o inverno: as plantas param de crescer e o frio exige abrigo e lenha.', []);
    }
    this.recordDay();
    this.day = DAY_COUNTERS();
  }

  private recordDay() {
    const al = this.alive;
    const wealth = al.map((a) => a.wealth(a.home >= 0 ? this.shelters[a.home].food / Math.max(1, this.shelters[a.home].owners.length) : 0));
    let trustSum = 0, trustN = 0, outlook = 0, health = 0, spec = 0, specN = 0, qShare = 0, qSteal = 0;
    for (const a of al) {
      for (const [id, r] of a.rel) {
        if (r.fam < 0.15) continue;
        if (!this.byId.get(id)?.alive) continue;
        trustSum += r.trust; trustN++;
      }
      outlook += a.outlook;
      health += a.health;
      qShare += a.q.share; qSteal += a.q.steal;
      if (a.recentLabor.length >= 8) {
        const f = a.recentLabor.filter((x) => x === Act.Forage).length / a.recentLabor.length;
        spec += Math.abs(f - (1 - f)); specN++;
      }
    }
    const n = Math.max(1, al.length);
    const d = this.day;
    const coopDen = d.shares + d.trades + d.thefts;
    let stored = 0;
    for (const sh of this.shelters) if (sh.alive) stored += sh.food;
    const largest = this.groups.length ? this.groups[0].members.length : 0;
    this.history.push({
      day: this.dayNumber(),
      season: this.season(),
      pop: al.length,
      births: d.births,
      deaths: d.deaths,
      gini: gini(wealth),
      shares: d.shares,
      thefts: d.thefts,
      caught: d.caught,
      trades: d.trades,
      talks: d.talks,
      refusals: d.refusals,
      conflicts: d.conflicts,
      coop: coopDen ? (d.shares + d.trades) / coopDen : null,
      trust: trustN ? trustSum / trustN : 0,
      outlook: outlook / n,
      groups: this.groups.length,
      largestGroup: largest / n,
      households: this.shelters.filter((s) => s.alive && s.owners.length).length,
      health: health / n,
      worldFood: this.world.totalFood(),
      stored,
      specialization: specN ? spec / specN : 0,
      qShare: qShare / n,
      qSteal: qSteal / n,
      rainfall: this.world.rainfall,
    });
  }

  // ------------------------------------------------------------- logging --
  log(kind: EventKind, text: string, agents: number[], tile?: number) {
    this.events.push({ tick: this.tick, kind, text, agents, tile });
    if (this.events.length > 1500) this.events.splice(0, 300);
  }
  private milestone(key: string, text: string, agents: number[]) {
    if (this.milestones.has(key)) return;
    this.milestones.add(key);
    this.log('milestone', `★ ${text}`, agents);
  }
  private addFx(kind: Fx['kind'], a: Agent, b: Agent) {
    this.fx.push({ kind, a: a.tile, b: b.tile, tick: this.tick });
  }
  private addFxTiles(kind: Fx['kind'], a: number, b: number) {
    this.fx.push({ kind, a, b, tick: this.tick });
  }

  // -------------------------------------------------------- interventions --
  intervene(label: string) {
    this.interventions.push({ tick: this.tick, label });
    this.log('intervention', `Intervenção do observador: ${label}`, []);
  }

  setClimate(kind: 'drought' | 'deluge' | 'normal', days = 12) {
    if (kind === 'normal') {
      this.climate = null;
      this.intervene('clima normalizado');
      return;
    }
    const rain = kind === 'drought' ? 0.3 : 1.9;
    const label = kind === 'drought' ? 'Seca severa' : 'Estação de chuvas abundantes';
    this.climate = { rain, until: this.tick + days * TICKS_PER_DAY, label };
    this.intervene(`${label} por ${days} dias`);
  }

  setHarshWinter(on: boolean) {
    this.harshWinter = on;
    this.intervene(on ? 'invernos rigorosos ativados' : 'invernos normais');
  }

  paint(tool: 'plant' | 'clear' | 'water' | 'forest' | 'gift', center: number, radius: number) {
    const w = this.world;
    const cx = center % W, cy = (center / W) | 0;
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius + 0.5) continue;
        const x = cx + dx, y = cy + dy;
        if (!w.inb(x, y)) continue;
        const i = y * W + x;
        if (w.shelterAt[i] >= 0 && (tool === 'water' || tool === 'clear')) continue;
        if (this.alive.some((a) => a.tile === i) && tool === 'water') continue;
        switch (tool) {
          case 'plant':
            if (w.passable(i) && w.terrain[i] !== 4) {
              if (w.terrain[i] === 0 || w.terrain[i] === 1) w.terrain[i] = 2;
              w.foodCap[i] = Math.max(w.foodCap[i], 4.5);
              w.food[i] = Math.max(w.food[i], 2);
              w.fertility[i] = Math.min(1, w.fertility[i] + 0.2);
            }
            break;
          case 'gift':
            if (w.passable(i)) w.food[i] += 4;
            break;
          case 'clear':
            if (w.terrain[i] === 3 || w.terrain[i] === 2) w.terrain[i] = 2;
            w.foodCap[i] = 0; w.food[i] = 0; w.woodCap[i] = 0; w.wood[i] = 0;
            break;
          case 'water':
            w.terrain[i] = 0; w.depth[i] = 0.3; w.foodCap[i] = 0; w.food[i] = 0; w.woodCap[i] = 0; w.wood[i] = 0;
            break;
          case 'forest':
            if (w.passable(i)) {
              w.terrain[i] = 3; w.woodCap[i] = 8; w.wood[i] = 4;
            }
            break;
        }
      }
    w.version++;
  }

  ignite(tile: number) {
    let n = 0;
    const cx = tile % W, cy = (tile / W) | 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        if (this.world.inb(cx + dx, cy + dy) && this.world.ignite((cy + dy) * W + cx + dx)) n++;
    return n > 0;
  }

  spawnPreset(tile: number, preset: string): Agent | null {
    if (!this.world.passable(tile)) return null;
    const p = TRAIT_PRESETS[preset] ?? TRAIT_PRESETS.random;
    const traits = { ...randomTraits(this.rng), ...p.traits };
    const a = this.spawn(tile, traits, this.tick - 2 * TICKS_PER_YEAR);
    a.wintersSeen = 0;
    a.food = 3;
    return a;
  }

  remove(a: Agent) {
    if (!a.alive) return;
    this.die(a, 'exílio (removido pelo observador)');
  }

  // ------------------------------------------------------------ utilities --
  /** Does this agent currently need wood (to build a home or heat it)? */
  wantsWood(a: Agent) {
    if (!a.isAdult(this.tick)) return false;
    if (a.home < 0) return a.wood < SHELTER_COST;
    const sh = this.shelters[a.home];
    return sh.wood + a.wood < 9 && this.season() >= 1;
  }
  /** Food an agent can hand over right now: carried, plus its store if it is at home. */
  available(a: Agent) {
    const sh = a.home >= 0 ? this.shelters[a.home] : null;
    return a.food + (sh && dist(a.tile, sh.tile) <= 1 ? sh.food : 0);
  }
  private takeFood(a: Agent, n: number) {
    const fromInv = Math.min(a.food, n);
    a.food -= fromInv;
    let rest = n - fromInv;
    if (rest > 0 && a.home >= 0) {
      const sh = this.shelters[a.home];
      const s = Math.min(sh.food, rest);
      sh.food -= s;
      rest -= s;
    }
    return n - rest;
  }
  homeOf(a: Agent): Shelter | null {
    return a.home >= 0 ? this.shelters[a.home] : null;
  }
  explainAnticipation(a: Agent) {
    return anticipation(this, a);
  }
  actLabel(a: Agent) {
    return a.intent ? a.intent.label : ACT_LABEL[Act.Idle];
  }
}

const SERVES_URGENT = new Set<Act>([Act.Eat, Act.Drink, Act.Forage, Act.Withdraw, Act.Ask, Act.Steal, Act.Warm, Act.Flee, Act.Trade]);

function trimMap<V>(m: Map<number, V>, max: number, score: (v: V) => number) {
  if (m.size <= max + 8) return;
  const arr = [...m.entries()].sort((a, b) => score(a[1]) - score(b[1]));
  for (let i = 0; i < arr.length - max; i++) m.delete(arr[i][0]);
}
