import { RNG } from './rng';
import { Act, Candidate, LEARNED_ACTS, LearnedAct, Traits, clamp, TICKS_PER_YEAR } from './types';

export interface Relation {
  trust: number; // -1 (enemy) .. 1 (complete trust)
  fam: number; // familiarity 0..1 — how well they know each other
  last: number; // tick of last interaction
  given: number; // food received from them (lifetime)
  taken: number; // food they stole from me (known)
  gaveTo: number; // food I gave them (lifetime)
}

export interface Memory {
  tick: number;
  text: string;
  valence: number; // -1 .. 1 (emotional weight)
}

export interface Intent {
  act: Act;
  tile: number; // destination tile
  path: number[];
  work: number; // ticks of work left once at destination
  agent?: number; // target agent id
  shelter?: number; // target shelter id
  adjacent?: boolean; // only need to be next to target
  started: number;
  label: string;
}

/** Remembered resource location: last seen amount and when. */
export interface Spot {
  amt: number;
  t: number;
}

export class Agent {
  id: number;
  name: string;
  tile: number;
  prevTile: number;
  born: number;
  traits: Traits;
  alive = true;
  deathCause = '';
  deathTick = -1;

  // needs: 0 = satisfied, 1 = critical
  hunger = 0.2;
  thirst = 0.2;
  fatigue = 0.2;
  cold = 0;
  loneliness = 0.3;
  health = 1;
  sick = 0; // ticks of illness left
  immune = false;

  food = 2;
  wood = 0;
  home = -1; // shelter id
  group = -1; // measured (emergent) group id, -1 = none

  skills = { forage: 0.1, wood: 0.1, build: 0 };
  /** Learned expected value of each strategic action (bandit estimate). */
  q: Record<LearnedAct, number>;
  /** Generalized trust in strangers — shaped by lifetime experience. */
  outlook: number;
  outlookHistory: number[] = [];
  wintersSeen = 0;

  rel = new Map<number, Relation>();
  kin = new Set<number>();
  parents: number[] = [];
  children: number[] = [];
  foodMem = new Map<number, Spot>();
  woodMem = new Map<number, Spot>();
  waterMem = new Map<number, number>(); // tile -> tick seen
  seen: Uint8Array;
  journal: Memory[] = [];
  recentLabor: Act[] = [];

  intent: Intent | null = null;
  lastChoice: Candidate[] = [];
  lastChoiceTick = 0;
  lastBirth = -1e9;

  stats = { harvested: 0, given: 0, received: 0, stolen: 0, caught: 0, victim: 0, trades: 0, talks: 0 };

  constructor(id: number, name: string, tile: number, born: number, traits: Traits, nTiles: number) {
    this.id = id;
    this.name = name;
    this.tile = tile;
    this.prevTile = tile;
    this.born = born;
    this.traits = traits;
    this.seen = new Uint8Array(nTiles);
    this.outlook = clamp(0.15 + (traits.generosity - 0.5) * 0.6, -1, 1);
    this.q = {} as Record<LearnedAct, number>;
    for (const a of LEARNED_ACTS) this.q[a] = 0;
  }

  age(tick: number) {
    return (tick - this.born) / TICKS_PER_YEAR;
  }
  isAdult(tick: number) {
    return this.age(tick) >= 1.5;
  }

  getRel(id: number, tick: number): Relation {
    let r = this.rel.get(id);
    if (!r) {
      r = { trust: this.outlook * 0.6, fam: 0, last: tick, given: 0, taken: 0, gaveTo: 0 };
      if (this.kin.has(id)) r.trust = 0.8;
      this.rel.set(id, r);
    }
    return r;
  }
  trustIn(id: number): number {
    const r = this.rel.get(id);
    if (r) return r.trust;
    return this.kin.has(id) ? 0.8 : this.outlook * 0.6;
  }
  adjustTrust(id: number, delta: number, tick: number) {
    const r = this.getRel(id, tick);
    // bounded update: harder to move near the extremes
    r.trust = clamp(r.trust + delta * (delta > 0 ? 1 - r.trust * 0.7 : 1 + r.trust * 0.7), -1, 1);
    r.last = tick;
    r.fam = clamp(r.fam + 0.04);
  }

  remember(tick: number, text: string, valence: number) {
    this.journal.push({ tick, text, valence });
    if (this.journal.length > 40) this.journal.shift();
  }

  wealth(storeFood: number) {
    return this.food + this.wood * 0.4 + storeFood;
  }
}

const SYL_A = ['ka', 'lo', 'mi', 'ra', 'tu', 'se', 'no', 'vi', 'ya', 'zo', 'ar', 'el', 'iu', 'ba', 'de', 'fe', 'ki', 'ma', 'ni', 'pe', 'qu', 'sa', 'ti', 'ul', 'xe'];
const SYL_B = ['n', 'r', 'l', 's', 'm', '', '', '', 'th', 'k'];

export function makeName(rng: RNG): string {
  const n = 2 + (rng.chance(0.3) ? 1 : 0);
  let s = '';
  for (let i = 0; i < n; i++) s += rng.pick(SYL_A);
  s += rng.pick(SYL_B);
  return s[0].toUpperCase() + s.slice(1);
}

export function randomTraits(rng: RNG): Traits {
  const t = () => clamp(0.5 + rng.gauss() * 0.2, 0.02, 0.98);
  return { generosity: t(), boldness: t(), curiosity: t(), sociability: t(), diligence: t() };
}

export const TRAIT_PRESETS: Record<string, { label: string; traits: Partial<Traits> }> = {
  random: { label: 'Aleatório', traits: {} },
  altruist: { label: 'Altruísta', traits: { generosity: 0.95, boldness: 0.15, sociability: 0.8 } },
  rogue: { label: 'Oportunista', traits: { generosity: 0.05, boldness: 0.95, diligence: 0.2 } },
  explorer: { label: 'Explorador', traits: { curiosity: 0.95, sociability: 0.4, boldness: 0.6 } },
  worker: { label: 'Trabalhador', traits: { diligence: 0.95, generosity: 0.5, curiosity: 0.3 } },
  hermit: { label: 'Eremita', traits: { sociability: 0.05, generosity: 0.3, curiosity: 0.6 } },
};

export function inheritTraits(rng: RNG, a: Traits, b: Traits): Traits {
  const mix = (x: number, y: number) => clamp((x + y) / 2 + rng.gauss() * 0.1, 0.02, 0.98);
  return {
    generosity: mix(a.generosity, b.generosity),
    boldness: mix(a.boldness, b.boldness),
    curiosity: mix(a.curiosity, b.curiosity),
    sociability: mix(a.sociability, b.sociability),
    diligence: mix(a.diligence, b.diligence),
  };
}
