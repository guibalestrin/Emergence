// Shared constants and types for the simulation core.
// The core has no DOM dependency: it runs in the browser, in a Web Worker
// (experiment lab) and in Node (headless experiments / tests).

export const W = 84;
export const H = 56;
export const N_TILES = W * H;

export const TICKS_PER_DAY = 100;
export const NIGHT_START = 72; // tick-of-day when night begins
export const DAYS_PER_SEASON = 8;
export const DAYS_PER_YEAR = DAYS_PER_SEASON * 4;
export const TICKS_PER_YEAR = TICKS_PER_DAY * DAYS_PER_YEAR;

export const SHELTER_COST = 14; // wood
export const CARRY_FOOD = 8;
export const CARRY_WOOD = 14;
export const STORE_CAP = 40;

export enum Terrain {
  Water = 0,
  Sand = 1,
  Grass = 2,
  Forest = 3,
  Rock = 4,
}

export const SEASONS = ['Primavera', 'Verão', 'Outono', 'Inverno'] as const;
/** Plant regrowth multiplier per season. Winter is the yearly crisis. */
export const SEASON_GROWTH = [1.35, 1.0, 0.6, 0.07];

export enum Act {
  Idle = 'idle',
  Eat = 'eat',
  Drink = 'drink',
  Rest = 'rest',
  Warm = 'warm',
  Forage = 'forage',
  Explore = 'explore',
  Chop = 'chop',
  Build = 'build',
  Deposit = 'deposit',
  Withdraw = 'withdraw',
  Socialize = 'socialize',
  Share = 'share',
  Ask = 'ask',
  Steal = 'steal',
  Trade = 'trade',
  Court = 'court',
  Flee = 'flee',
}

export const ACT_LABEL: Record<Act, string> = {
  [Act.Idle]: 'Vagando',
  [Act.Eat]: 'Comendo',
  [Act.Drink]: 'Bebendo água',
  [Act.Rest]: 'Descansando',
  [Act.Warm]: 'Aquecendo-se no abrigo',
  [Act.Forage]: 'Coletando alimento',
  [Act.Explore]: 'Explorando',
  [Act.Chop]: 'Cortando lenha',
  [Act.Build]: 'Construindo abrigo',
  [Act.Deposit]: 'Guardando no abrigo',
  [Act.Withdraw]: 'Pegando do estoque',
  [Act.Socialize]: 'Conversando',
  [Act.Share]: 'Doando comida',
  [Act.Ask]: 'Pedindo comida',
  [Act.Steal]: 'Roubando',
  [Act.Trade]: 'Negociando',
  [Act.Court]: 'Cortejando',
  [Act.Flee]: 'Fugindo do fogo',
};

export const ACT_GLYPH: Record<Act, string> = {
  [Act.Idle]: '·',
  [Act.Eat]: '🍖',
  [Act.Drink]: '💧',
  [Act.Rest]: '💤',
  [Act.Warm]: '🔥',
  [Act.Forage]: '🍓',
  [Act.Explore]: '🧭',
  [Act.Chop]: '🪓',
  [Act.Build]: '🔨',
  [Act.Deposit]: '📦',
  [Act.Withdraw]: '📦',
  [Act.Socialize]: '💬',
  [Act.Share]: '🎁',
  [Act.Ask]: '🙏',
  [Act.Steal]: '🫳',
  [Act.Trade]: '🔄',
  [Act.Court]: '❤️',
  [Act.Flee]: '⚠️',
};

/** Strategic actions whose value each agent learns from experience. */
export const LEARNED_ACTS = [
  Act.Forage,
  Act.Explore,
  Act.Chop,
  Act.Socialize,
  Act.Share,
  Act.Ask,
  Act.Steal,
  Act.Trade,
  Act.Deposit,
] as const;
export type LearnedAct = (typeof LEARNED_ACTS)[number];

export interface Traits {
  generosity: number; // tendency to give / help
  boldness: number; // risk-taking, willingness to transgress
  curiosity: number; // exploration and learning rate
  sociability: number; // need for company
  diligence: number; // work ethic, planning / storing for later
}

export const TRAIT_LABEL: Record<keyof Traits, string> = {
  generosity: 'Generosidade',
  boldness: 'Ousadia',
  curiosity: 'Curiosidade',
  sociability: 'Sociabilidade',
  diligence: 'Diligência',
};

export interface SimFlags {
  learning: boolean; // agents update action values from outcomes
  gossip: boolean; // agents pass reputation information when talking
  knowledgeSharing: boolean; // agents tell each other where food is
  reproduction: boolean;
}

export interface SimConfig {
  seed: number;
  agents: number;
  abundance: number; // multiplies density/capacity of food plants
  flags: SimFlags;
}

export const DEFAULT_FLAGS: SimFlags = {
  learning: true,
  gossip: true,
  knowledgeSharing: true,
  reproduction: true,
};

export function defaultConfig(seed = 1): SimConfig {
  return { seed, agents: 34, abundance: 1, flags: { ...DEFAULT_FLAGS } };
}

export type EventKind =
  | 'birth'
  | 'death'
  | 'theft'
  | 'share'
  | 'trade'
  | 'build'
  | 'household'
  | 'group'
  | 'climate'
  | 'intervention'
  | 'milestone'
  | 'fire'
  | 'disease';

export interface SimEvent {
  tick: number;
  kind: EventKind;
  text: string;
  agents: number[];
  tile?: number;
}

export interface Factor {
  label: string;
  value: number;
}

export interface Candidate {
  act: Act;
  score: number;
  base: number;
  learned: number; // multiplier from learned value
  factors: Factor[];
  label: string;
}

/** Short-lived visual effects emitted by the simulation (renderer only). */
export interface Fx {
  kind: 'share' | 'steal' | 'talk' | 'trade' | 'caught' | 'birth' | 'death' | 'refuse';
  a: number; // tile idx
  b: number; // tile idx
  tick: number;
}

export function clamp(v: number, lo = 0, hi = 1) {
  return v < lo ? lo : v > hi ? hi : v;
}
