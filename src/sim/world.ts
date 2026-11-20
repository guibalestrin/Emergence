import { RNG, makeNoise } from './rng';
import {
  W as _W,
  H as _H,
  N_TILES as _N_TILES,
  Terrain as _Terrain,
  SEASON_GROWTH,
} from './types';
const W = _W;
const H = _H;
const N_TILES = _N_TILES;
const Terrain = _Terrain;

/**
 * The physical environment: terrain, plants, trees, water and fire.
 * Everything is stored in flat typed arrays indexed by tile (y * W + x).
 */
export class World {
  terrain = new Uint8Array(N_TILES);
  depth = new Float32Array(N_TILES); // water depth (0..~0.35); drought exposes shallow beds
  fertility = new Float32Array(N_TILES);
  food = new Float32Array(N_TILES);
  foodCap = new Float32Array(N_TILES);
  wood = new Float32Array(N_TILES);
  woodCap = new Float32Array(N_TILES);
  fire = new Uint8Array(N_TILES); // >0 = burning, ticks left
  scorch = new Float32Array(N_TILES); // visual burn scar, fades
  shelterAt = new Int32Array(N_TILES).fill(-1);

  /** 1 = normal rain. Drought < 1, deluge > 1. */
  rainfall = 1;
  /** Slowly follows rainfall; low water table dries shallow water. */
  waterTable = 1;
  /** Incremented whenever tiles change, so renderers know to redraw. */
  version = 0;

  idx(x: number, y: number) {
    return y * W + x;
  }
  inb(x: number, y: number) {
    return x >= 0 && y >= 0 && x < W && y < H;
  }
  dryThreshold() {
    return (1 - Math.min(1, this.waterTable)) * 0.2;
  }
  isWater(i: number) {
    return this.terrain[i] === Terrain.Water && this.depth[i] > this.dryThreshold();
  }
  /** A dried lake bed is walkable. */
  isDryBed(i: number) {
    return this.terrain[i] === Terrain.Water && !this.isWater(i);
  }
  passable(i: number) {
    const t = this.terrain[i];
    if (t === Terrain.Rock) return false;
    if (t === Terrain.Water) return !this.isWater(i);
    return true;
  }
  /** True if tile i is passable and touches drinkable water. */
  nearWater(i: number) {
    const x = i % W, y = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (this.inb(nx, ny) && this.isWater(this.idx(nx, ny))) return true;
      }
    return false;
  }

  /** Water tile that has walkable land next to it (a drinking spot). */
  nearWaterEdge(i: number) {
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of NEIGH4) {
      const nx = x + dx, ny = y + dy;
      if (this.inb(nx, ny) && this.passable(this.idx(nx, ny))) return true;
    }
    return false;
  }

  generate(rng: RNG, abundance: number) {
    const seed = rng.int(1e9);
    const elev = makeNoise(seed);
    const moist = makeNoise(seed + 101);
    const bush = makeNoise(seed + 202);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = this.idx(x, y);
        // gentle island-ish falloff at the borders keeps lakes inside the map
        const nx = x / W - 0.5, ny = y / H - 0.5;
        const edge = Math.max(Math.abs(nx), Math.abs(ny)) * 2;
        let e = elev(x / 22, y / 22, 5) + (edge > 0.85 ? (edge - 0.85) * 0.6 : 0);
        const m = moist(x / 18, y / 18, 4);
        this.fertility[i] = Math.min(1, Math.max(0, m * 1.3 - 0.15));
        if (e < 0.34) {
          this.terrain[i] = Terrain.Water;
          this.depth[i] = 0.34 - e + 0.02;
        } else if (e < 0.37) this.terrain[i] = Terrain.Sand;
        else if (e > 0.74) this.terrain[i] = Terrain.Rock;
        else if (m > 0.56) this.terrain[i] = Terrain.Forest;
        else this.terrain[i] = Terrain.Grass;

        const t = this.terrain[i];
        if (t === Terrain.Forest) {
          this.woodCap[i] = rng.range(5, 10);
          this.wood[i] = this.woodCap[i];
          if (rng.chance(0.07 * abundance)) this.foodCap[i] = rng.range(1, 2.5);
        } else if (t === Terrain.Grass) {
          // berry bushes cluster in fertile patches
          const p = (bush(x / 6, y / 6, 2) - 0.45) * 0.55 * this.fertility[i] * abundance;
          if (rng.next() < p) this.foodCap[i] = rng.range(3, 6);
        }
      }
    // Guarantee drinkable water: some seeds produce dry maps. Carve lakes until
    // there is enough water for the world to be livable.
    let water = 0;
    for (let i = 0; i < N_TILES; i++) if (this.terrain[i] === Terrain.Water) water++;
    for (let k = 0; k < 6 && water < 260; k++) {
      const cx = 10 + rng.int(W - 20), cy = 8 + rng.int(H - 16), r = 4 + rng.int(3);
      for (let y = cy - r; y <= cy + r; y++)
        for (let x = cx - r; x <= cx + r; x++) {
          const d = Math.hypot(x - cx, y - cy);
          if (d > r || !this.inb(x, y)) continue;
          const i = this.idx(x, y);
          if (this.terrain[i] !== Terrain.Water) water++;
          this.terrain[i] = Terrain.Water;
          this.depth[i] = Math.max(this.depth[i], 0.05 + (1 - d / r) * 0.3);
          this.foodCap[i] = 0; this.woodCap[i] = 0; this.wood[i] = 0;
        }
    }

    // Normalise total plant capacity so different seeds give comparable
    // ecologies (otherwise one map can simply be a desert). Extra bushes are
    // placed preferentially on fertile land next to existing patches.
    const target = 760 * abundance;
    let total = 0;
    for (let i = 0; i < N_TILES; i++) total += this.foodCap[i];
    for (let k = 0; k < 200000 && total < target; k++) {
      const i = rng.int(N_TILES);
      if (this.terrain[i] !== Terrain.Grass || this.foodCap[i] > 0) continue;
      const x = i % W, y = (i / W) | 0;
      if (rng.next() > this.fertility[i] * (0.3 + bush(x / 6, y / 6, 2))) continue;
      this.foodCap[i] = rng.range(3, 6);
      total += this.foodCap[i];
    }
    for (let k = 0; k < 200000 && total > target * 1.1; k++) {
      const i = rng.int(N_TILES);
      if (this.terrain[i] !== Terrain.Grass || this.foodCap[i] <= 0) continue;
      total -= this.foodCap[i];
      this.foodCap[i] = 0;
    }
    for (let i = 0; i < N_TILES; i++) this.food[i] = this.foodCap[i] * rng.range(0.5, 1);
    this.version++;
  }

  /** Plant growth, water table, fire. Called once per tick. */
  step(rng: RNG, season: number, tick: number) {
    const growth = SEASON_GROWTH[season] * Math.min(1.6, this.rainfall);
    // water table follows rain slowly (several days)
    const target = Math.min(1.2, this.rainfall);
    const prevThr = this.dryThreshold();
    this.waterTable += (target - this.waterTable) * 0.0012;
    if (Math.abs(prevThr - this.dryThreshold()) > 1e-4) this.version++;

    // drought also stresses plants: low water table shrinks capacity effect
    const stress = Math.min(1, 0.25 + this.waterTable);
    if (tick % 5 === 0) {
      const g = 0.0125 * growth * stress; // 5 ticks worth
      for (let i = 0; i < N_TILES; i++) {
        const cap = this.foodCap[i];
        if (cap > 0 && this.food[i] < cap && this.fire[i] === 0) {
          this.food[i] = Math.min(cap, this.food[i] + cap * g * (0.5 + this.fertility[i]));
        }
        const wc = this.woodCap[i];
        if (wc > 0 && this.wood[i] < wc) this.wood[i] = Math.min(wc, this.wood[i] + 0.004 * wc * growth);
        if (this.scorch[i] > 0) this.scorch[i] = Math.max(0, this.scorch[i] - 0.004);
      }
      if (tick % 20 === 0) this.version++;
    }
    this.fireStep(rng);
  }

  burningCount = 0;
  private fireStep(rng: RNG) {
    if (this.burningCount === 0) return;
    let count = 0;
    const spread = 0.05 / Math.max(0.4, this.rainfall);
    const newly: number[] = [];
    for (let i = 0; i < N_TILES; i++) {
      if (this.fire[i] === 0) continue;
      this.fire[i]--;
      count++;
      this.food[i] = 0;
      this.wood[i] *= 0.9;
      this.scorch[i] = 1;
      if (this.fire[i] === 0) {
        // burned forest becomes open grass; ash makes soil fertile later
        if (this.terrain[i] === Terrain.Forest) {
          this.terrain[i] = Terrain.Grass;
          this.woodCap[i] = 0;
          this.wood[i] = 0;
        }
        this.fertility[i] = Math.min(1, this.fertility[i] + 0.15);
        this.version++;
        continue;
      }
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of NEIGH4) {
        const nx = x + dx, ny = y + dy;
        if (!this.inb(nx, ny)) continue;
        const j = this.idx(nx, ny);
        if (this.fire[j] > 0) continue;
        const t = this.terrain[j];
        const fuel = t === Terrain.Forest ? 1 : t === Terrain.Grass ? 0.35 : 0;
        if (fuel > 0 && rng.chance(spread * fuel)) newly.push(j);
      }
    }
    for (const j of newly) this.ignite(j);
    this.burningCount = count + newly.length;
  }

  ignite(i: number) {
    const t = this.terrain[i];
    if (t !== Terrain.Forest && t !== Terrain.Grass) return false;
    if (this.fire[i] > 0) return false;
    this.fire[i] = t === Terrain.Forest ? 22 : 10;
    this.burningCount++;
    this.version++;
    return true;
  }

  totalFood() {
    let s = 0;
    for (let i = 0; i < N_TILES; i++) s += this.food[i];
    return s;
  }
}

export const NEIGH4: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
export const NEIGH8: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
];

/** Breadth-first pathfinder with reusable buffers. */
export class PathFinder {
  private prev = new Int32Array(N_TILES);
  private stamp = new Uint32Array(N_TILES);
  private cur = 1;
  private queue = new Int32Array(N_TILES);
  constructor(private world: World) {}

  /**
   * Shortest path from `from` to a tile satisfying `goal`. Returns the list of
   * tiles to walk (excluding `from`), or null. `maxDist` limits search radius.
   */
  search(from: number, goal: (i: number) => boolean, maxNodes = N_TILES): number[] | null {
    const w = this.world;
    this.cur++;
    if (this.cur === 0xffffffff) {
      this.stamp.fill(0);
      this.cur = 1;
    }
    let head = 0, tail = 0;
    this.queue[tail++] = from;
    this.stamp[from] = this.cur;
    this.prev[from] = -1;
    while (head < tail && head < maxNodes) {
      const i = this.queue[head++];
      if (goal(i)) {
        const path: number[] = [];
        let c = i;
        while (c !== from) {
          path.push(c);
          c = this.prev[c];
        }
        path.reverse();
        return path;
      }
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of NEIGH8) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (this.stamp[j] === this.cur) continue;
        if (!w.passable(j)) continue;
        // no diagonal corner cutting
        if (dx !== 0 && dy !== 0 && (!w.passable(y * W + nx) || !w.passable(ny * W + x))) continue;
        this.stamp[j] = this.cur;
        this.prev[j] = i;
        this.queue[tail++] = j;
      }
    }
    return null;
  }

  to(from: number, target: number, adjacentOk = false): number[] | null {
    if (from === target) return [];
    const tx = target % W, ty = (target / W) | 0;
    return this.search(from, (i) => {
      if (i === target) return true;
      if (!adjacentOk) return false;
      const x = i % W, y = (i / W) | 0;
      return Math.abs(x - tx) <= 1 && Math.abs(y - ty) <= 1;
    });
  }
}

export function dist(a: number, b: number) {
  const ax = a % W, ay = (a / W) | 0, bx = b % W, by = (b / W) | 0;
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}
