import type { Simulation, Shelter } from '../sim/sim';
import type { Agent } from '../sim/agent';
import { W, H, Terrain, ACT_GLYPH, Act, TICKS_PER_DAY, NIGHT_START } from '../sim/types';
import { mutualTrust, GROUP_TRUST } from '../sim/social';

const TS = 16; // base pixels per tile in the terrain layer

export interface Camera {
  x: number; // world px (tile units * TS) at screen center
  y: number;
  zoom: number; // screen px per world px
}

export interface ViewState {
  selected: number | null;
  hovered: number | null;
  showNet: boolean;
  showGlyphs: boolean;
  showBubbles?: boolean;
  brush: { tile: number; radius: number } | null;
}

/** What the app needs from a world view; implemented by the 2D and 3D renderers. */
export interface WorldView {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  resize(): void;
  fit(): void;
  screenToTile(sx: number, sy: number): number;
  pickAgent(sim: Simulation, sx: number, sy: number, alpha: number): Agent | null;
  zoomAt(sx: number, sy: number, factor: number): void;
  panBy(dx: number, dy: number): void;
  orbit(dx: number, dy: number): void;
  centerOn(tile: number): void;
  follow(a: Agent, alpha: number): void;
  draw(sim: Simulation, alpha: number, view: ViewState, now: number): void;
  /** Optional: structure under the cursor (3D only). */
  pickShelter?(sim: Simulation, sx: number, sy: number): Shelter | null;
}

export function hash(i: number, k: number) {
  let h = (i * 2654435761 + k * 40503) | 0;
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h ^= h >>> 13;
  return ((h >>> 0) % 10000) / 10000;
}

function mix(a: number[], b: number[], t: number) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
const rgb = (c: number[]) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

/** Base colour of a terrain tile (shared by the 2D and 3D renderers). */
export function tileRGB(sim: Simulation, i: number, winter: boolean, autumn: boolean, thr: number): number[] {
  const w = sim.world;
  const t = w.terrain[i];
  let base: number[];
  if (t === Terrain.Water) {
    if (w.depth[i] > thr) {
      const d = Math.min(1, (w.depth[i] - thr) / 0.25);
      base = mix([86, 140, 168], [28, 64, 99], d);
      if (winter && d < 0.35) base = mix(base, [190, 214, 226], 0.5);
    } else base = mix([138, 118, 86], [120, 100, 72], hash(i, 1));
  } else if (t === Terrain.Sand) base = mix([214, 199, 150], [200, 184, 136], hash(i, 1));
  else if (t === Terrain.Rock) base = mix([122, 126, 132], [98, 102, 108], hash(i, 1));
  else {
    const f = w.fertility[i];
    base = mix([150, 168, 92], [84, 138, 70], f);
    if (autumn) base = mix(base, [176, 150, 80], 0.35);
    if (winter) base = mix(base, [222, 228, 232], 0.62);
    base = mix(base, [0, 0, 0], hash(i, 2) * 0.06);
  }
  if (w.rainfall < 0.6 && (t === Terrain.Grass || t === Terrain.Forest)) base = mix(base, [190, 170, 110], 0.35);
  return base;
}

export function temperamentColor(a: Agent) {
  // generous → teal; selfish & bold → orange-red. Lightness from sociability.
  const g = a.traits.generosity, b = a.traits.boldness;
  const hue = 18 + (168 - 18) * Math.max(0, Math.min(1, g * 1.1 - b * 0.25 + 0.1));
  const light = 52 + a.traits.sociability * 14;
  return `hsl(${hue.toFixed(0)}, 62%, ${light.toFixed(0)}%)`;
}
export function groupColor(hue: number, alpha = 1) {
  return `hsla(${hue}, 72%, 68%, ${alpha})`;
}

export class Renderer implements WorldView {
  ctx: CanvasRenderingContext2D;
  cam: Camera = { x: (W * TS) / 2, y: (H * TS) / 2, zoom: 1 };
  private terrain: HTMLCanvasElement;
  private tctx: CanvasRenderingContext2D;
  private drawnVersion = -1;
  private drawnSeason = -1;
  private lastTerrainDraw = 0;
  private dpr = 1;
  width = 0;
  height = 0;

  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.terrain = document.createElement('canvas');
    this.terrain.width = W * TS;
    this.terrain.height = H * TS;
    this.tctx = this.terrain.getContext('2d')!;
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = r.width;
    this.height = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
  }

  fit() {
    // whole world visible, centred
    const z = Math.min(this.width / (W * TS), this.height / (H * TS));
    this.cam = { x: (W * TS) / 2, y: (H * TS) / 2, zoom: z };
  }

  minZoom() {
    return Math.min(this.width / (W * TS), this.height / (H * TS)) * 0.6;
  }

  screenToWorld(sx: number, sy: number) {
    return {
      x: (sx - this.width / 2) / this.cam.zoom + this.cam.x,
      y: (sy - this.height / 2) / this.cam.zoom + this.cam.y,
    };
  }
  screenToTile(sx: number, sy: number) {
    const p = this.screenToWorld(sx, sy);
    const tx = Math.floor(p.x / TS), ty = Math.floor(p.y / TS);
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return -1;
    return ty * W + tx;
  }
  zoomAt(sx: number, sy: number, factor: number) {
    const before = this.screenToWorld(sx, sy);
    this.cam.zoom = Math.max(this.minZoom(), Math.min(6, this.cam.zoom * factor));
    const after = this.screenToWorld(sx, sy);
    this.cam.x += before.x - after.x;
    this.cam.y += before.y - after.y;
  }
  panBy(dx: number, dy: number) {
    this.cam.x -= dx / this.cam.zoom;
    this.cam.y -= dy / this.cam.zoom;
  }
  orbit(dx: number, dy: number) {
    this.panBy(dx, dy); // no rotation in the flat view
  }
  follow(a: Agent, alpha: number) {
    const p = this.agentPos(a, alpha);
    this.cam.x += (p.x - this.cam.x) * 0.15;
    this.cam.y += (p.y - this.cam.y) * 0.15;
  }
  centerOn(tile: number) {
    this.cam.x = ((tile % W) + 0.5) * TS;
    this.cam.y = (((tile / W) | 0) + 0.5) * TS;
  }

  /** Agent's interpolated position in world px. */
  agentPos(a: Agent, alpha: number) {
    const x0 = a.prevTile % W, y0 = (a.prevTile / W) | 0;
    const x1 = a.tile % W, y1 = (a.tile / W) | 0;
    return { x: (x0 + (x1 - x0) * alpha + 0.5) * TS, y: (y0 + (y1 - y0) * alpha + 0.5) * TS };
  }

  pickAgent(sim: Simulation, sx: number, sy: number, alpha: number): Agent | null {
    const p = this.screenToWorld(sx, sy);
    let best: Agent | null = null;
    let bd = (TS * 0.9) ** 2;
    for (const a of sim.alive) {
      const q = this.agentPos(a, alpha);
      const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  // ------------------------------------------------------------- terrain --
  private drawTerrain(sim: Simulation) {
    const w = sim.world;
    const g = this.tctx;
    const winter = sim.season() === 3;
    const autumn = sim.season() === 2;
    const thr = w.dryThreshold();
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const px = x * TS, py = y * TS;
        const t = w.terrain[i];
        const base = tileRGB(sim, i, winter, autumn, thr);
        g.fillStyle = rgb(base);
        g.fillRect(px, py, TS, TS);

        if (t === Terrain.Water && w.depth[i] <= thr) {
          // cracked mud
          g.strokeStyle = 'rgba(70,55,35,0.5)';
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(px + hash(i, 3) * TS, py);
          g.lineTo(px + TS * 0.5, py + TS * 0.5);
          g.lineTo(px + TS, py + hash(i, 4) * TS);
          g.stroke();
        }
        if (t === Terrain.Rock) {
          g.fillStyle = 'rgba(255,255,255,0.12)';
          g.beginPath();
          g.moveTo(px + 3, py + TS - 3);
          g.lineTo(px + TS * 0.5, py + 3 + hash(i, 5) * 4);
          g.lineTo(px + TS - 3, py + TS - 3);
          g.fill();
        }
        if (t === Terrain.Forest) {
          const n = 1 + Math.round((w.wood[i] / Math.max(1, w.woodCap[i])) * 3);
          for (let k = 0; k < n; k++) {
            const cx = px + 3 + hash(i, 10 + k) * (TS - 6), cy = py + 3 + hash(i, 20 + k) * (TS - 6);
            g.fillStyle = winter ? '#4a6656' : autumn && hash(i, 30 + k) > 0.6 ? '#9a6b2f' : '#2f5e36';
            g.beginPath();
            g.arc(cx, cy, 3.6 + hash(i, 40 + k) * 1.6, 0, Math.PI * 2);
            g.fill();
            if (winter) {
              g.fillStyle = 'rgba(240,244,248,0.7)';
              g.beginPath();
              g.arc(cx - 1, cy - 1.5, 1.8, 0, Math.PI * 2);
              g.fill();
            }
          }
        }
        if (w.foodCap[i] > 0 || w.food[i] > 0.4) {
          if (w.foodCap[i] > 0) {
            g.fillStyle = winter ? 'rgba(90,110,90,0.7)' : 'rgba(46,96,52,0.85)';
            g.beginPath();
            g.arc(px + TS / 2, py + TS / 2, 5, 0, Math.PI * 2);
            g.fill();
          }
          const berries = Math.min(7, Math.round(w.food[i]));
          for (let k = 0; k < berries; k++) {
            const a = (k / 7) * Math.PI * 2 + hash(i, 50) * 6;
            g.fillStyle = '#e0546f';
            g.beginPath();
            g.arc(px + TS / 2 + Math.cos(a) * 3.4, py + TS / 2 + Math.sin(a) * 3.4, 1.6, 0, Math.PI * 2);
            g.fill();
          }
        }
        if (w.scorch[i] > 0) {
          g.fillStyle = `rgba(24,16,10,${(w.scorch[i] * 0.65).toFixed(2)})`;
          g.fillRect(px, py, TS, TS);
        }
      }
  }

  // --------------------------------------------------------------- frame --
  draw(sim: Simulation, alpha: number, view: ViewState, now: number) {
    const season = sim.season();
    if ((sim.world.version !== this.drawnVersion && now - this.lastTerrainDraw > 250) || season !== this.drawnSeason) {
      this.drawTerrain(sim);
      this.drawnVersion = sim.world.version;
      this.drawnSeason = season;
      this.lastTerrainDraw = now;
    }
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = '#0a0d11';
    c.fillRect(0, 0, this.width, this.height);
    const z = this.cam.zoom;
    c.setTransform(this.dpr * z, 0, 0, this.dpr * z, this.dpr * (this.width / 2 - this.cam.x * z), this.dpr * (this.height / 2 - this.cam.y * z));
    c.imageSmoothingEnabled = z < 1;
    c.drawImage(this.terrain, 0, 0);

    // fire
    const w = sim.world;
    if (w.burningCount > 0) {
      for (let i = 0; i < w.fire.length; i++) {
        if (w.fire[i] === 0) continue;
        const px = (i % W) * TS, py = ((i / W) | 0) * TS;
        const f = 0.6 + 0.4 * Math.sin(now / 90 + i);
        c.fillStyle = `rgba(255,${(120 + 60 * f) | 0},40,${0.55 + 0.3 * f})`;
        c.fillRect(px, py, TS, TS);
        c.fillStyle = 'rgba(255,230,120,0.6)';
        c.beginPath();
        c.arc(px + TS / 2, py + TS / 2 + 2, 3 + f * 3, 0, Math.PI * 2);
        c.fill();
      }
    }

    const night = this.darkness(sim);
    this.drawShelters(sim, night);
    if (view.showNet) this.drawNetwork(sim, alpha);
    this.drawFx(sim, alpha);

    const sel = view.selected !== null ? sim.byId.get(view.selected) : undefined;
    if (sel && sel.alive) this.drawSelection(sim, sel, alpha, now);
    this.drawAgents(sim, alpha, view, z);

    // night & season tint (screen space)
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (night > 0) {
      c.fillStyle = `rgba(8,12,34,${night.toFixed(3)})`;
      c.fillRect(0, 0, this.width, this.height);
    }
    // shelter fires glow through the night
    if (night > 0.1) {
      c.setTransform(this.dpr * z, 0, 0, this.dpr * z, this.dpr * (this.width / 2 - this.cam.x * z), this.dpr * (this.height / 2 - this.cam.y * z));
      c.globalCompositeOperation = 'lighter';
      for (const sh of sim.shelters) {
        if (!sh.alive || sh.wood <= 0 || !sh.owners.length) continue;
        const px = ((sh.tile % W) + 0.5) * TS, py = (((sh.tile / W) | 0) + 0.5) * TS;
        const g = c.createRadialGradient(px, py, 0, px, py, TS * 1.8);
        g.addColorStop(0, `rgba(255,170,70,${(night * 0.7).toFixed(2)})`);
        g.addColorStop(1, 'rgba(255,170,70,0)');
        c.fillStyle = g;
        c.fillRect(px - TS * 2, py - TS * 2, TS * 4, TS * 4);
      }
      c.globalCompositeOperation = 'source-over';
    }

    if (view.brush) {
      c.setTransform(this.dpr * z, 0, 0, this.dpr * z, this.dpr * (this.width / 2 - this.cam.x * z), this.dpr * (this.height / 2 - this.cam.y * z));
      const bx = ((view.brush.tile % W) + 0.5) * TS, by = (((view.brush.tile / W) | 0) + 0.5) * TS;
      c.strokeStyle = 'rgba(232,176,74,0.9)';
      c.lineWidth = 1.5 / z;
      c.setLineDash([4 / z, 3 / z]);
      c.beginPath();
      c.arc(bx, by, (view.brush.radius + 0.5) * TS, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
    }
  }

  private darkness(sim: Simulation) {
    const tod = sim.tick % TICKS_PER_DAY;
    let d = 0;
    if (tod >= NIGHT_START) d = Math.min(1, (tod - NIGHT_START) / 8);
    else if (tod < 6) d = 1 - tod / 6;
    return d * 0.42;
  }

  private drawShelters(sim: Simulation, night: number) {
    const c = this.ctx;
    void night;
    for (const sh of sim.shelters) {
      if (!sh.alive) continue;
      const px = (sh.tile % W) * TS, py = ((sh.tile / W) | 0) * TS;
      let color = '#cdb68a';
      const owner = sh.owners.length ? sim.byId.get(sh.owners[0]) : undefined;
      if (owner && owner.group >= 0) {
        const g = sim.groups.find((x) => x.id === owner.group);
        if (g) color = `hsl(${g.hue},45%,62%)`;
      }
      if (!sh.owners.length) color = '#7d756a';
      c.fillStyle = 'rgba(0,0,0,0.3)';
      c.fillRect(px + 2, py + 9, TS - 2, 6);
      c.fillStyle = color;
      c.fillRect(px + 3, py + 7, TS - 6, TS - 9);
      c.fillStyle = '#6b4a2e';
      c.beginPath();
      c.moveTo(px + 1, py + 8);
      c.lineTo(px + TS / 2, py + 1);
      c.lineTo(px + TS - 1, py + 8);
      c.closePath();
      c.fill();
      c.fillStyle = '#3a2a1c';
      c.fillRect(px + TS / 2 - 1.5, py + TS - 6, 3, 4);
      // stock bar (food = red, wood = brown)
      const f = Math.min(1, sh.food / 30), wd = Math.min(1, sh.wood / 12);
      if (f > 0) { c.fillStyle = '#e0546f'; c.fillRect(px + 1, py + TS - 1.5, (TS - 2) * f, 1.5); }
      if (wd > 0) { c.fillStyle = '#b7834f'; c.fillRect(px + 1, py + TS, (TS - 2) * wd, 1.5); }
    }
  }

  private drawNetwork(sim: Simulation, alpha: number) {
    const c = this.ctx;
    const al = sim.alive;
    c.lineWidth = 1.2;
    for (let i = 0; i < al.length; i++)
      for (let j = i + 1; j < al.length; j++) {
        const m = mutualTrust(al[i], al[j]);
        if (m < GROUP_TRUST * 0.75) continue;
        const a = this.agentPos(al[i], alpha), b = this.agentPos(al[j], alpha);
        const g = al[i].group >= 0 && al[i].group === al[j].group ? sim.groups.find((x) => x.id === al[i].group) : undefined;
        c.strokeStyle = g ? groupColor(g.hue, 0.25 + m * 0.5) : `rgba(220,226,236,${(0.12 + m * 0.3).toFixed(2)})`;
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
        c.stroke();
      }
  }

  private drawFx(sim: Simulation, _alpha: number) {
    const c = this.ctx;
    const LIFE = 45;
    for (const f of sim.fx) {
      const age = sim.tick - f.tick;
      if (age > LIFE) continue;
      const k = 1 - age / LIFE;
      const ax = ((f.a % W) + 0.5) * TS, ay = (((f.a / W) | 0) + 0.5) * TS;
      const bx = ((f.b % W) + 0.5) * TS, by = (((f.b / W) | 0) + 0.5) * TS;
      const col = {
        share: '95,208,165', trade: '232,176,74', talk: '121,167,255', steal: '226,102,92',
        caught: '255,80,70', refuse: '150,150,160', birth: '243,166,207', death: '200,200,200',
      }[f.kind];
      if (f.kind === 'birth' || f.kind === 'death') {
        c.strokeStyle = `rgba(${col},${k.toFixed(2)})`;
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(ax, ay, TS * (0.4 + (1 - k) * 1.4), 0, Math.PI * 2);
        c.stroke();
        continue;
      }
      c.strokeStyle = `rgba(${col},${(k * 0.9).toFixed(2)})`;
      c.lineWidth = f.kind === 'caught' ? 2.5 : 1.8;
      if (f.kind === 'talk' || f.kind === 'refuse') c.setLineDash([3, 3]);
      const mx = (ax + bx) / 2, my = (ay + by) / 2 - TS * 0.8;
      c.beginPath();
      c.moveTo(ax, ay);
      c.quadraticCurveTo(mx, my, bx, by);
      c.stroke();
      c.setLineDash([]);
      if (f.kind === 'caught' || f.kind === 'steal') {
        c.fillStyle = `rgba(${col},${k.toFixed(2)})`;
        c.font = 'bold 10px system-ui';
        c.textAlign = 'center';
        c.fillText(f.kind === 'caught' ? '!' : '?', mx, my + 4);
      }
    }
  }

  private drawSelection(sim: Simulation, a: Agent, alpha: number, now: number) {
    const c = this.ctx;
    const p = this.agentPos(a, alpha);
    // relationships
    const rels = [...a.rel.entries()].filter(([id, r]) => r.fam > 0.08 && Math.abs(r.trust) > 0.2 && sim.byId.get(id)?.alive);
    for (const [id, r] of rels) {
      const b = sim.byId.get(id)!;
      const q = this.agentPos(b, alpha);
      c.strokeStyle = r.trust > 0 ? `rgba(95,208,165,${(0.2 + r.trust * 0.6).toFixed(2)})` : `rgba(226,102,92,${(0.2 - r.trust * 0.6).toFixed(2)})`;
      c.lineWidth = 0.8 + Math.abs(r.trust) * 1.8;
      c.beginPath();
      c.moveTo(p.x, p.y);
      c.lineTo(q.x, q.y);
      c.stroke();
    }
    // intended path
    const it = a.intent;
    if (it && it.path.length) {
      c.strokeStyle = 'rgba(232,176,74,0.7)';
      c.lineWidth = 1.2;
      c.setLineDash([2, 3]);
      c.beginPath();
      c.moveTo(p.x, p.y);
      for (const t of it.path) c.lineTo(((t % W) + 0.5) * TS, (((t / W) | 0) + 0.5) * TS);
      c.stroke();
      c.setLineDash([]);
    }
    const pulse = 1 + 0.15 * Math.sin(now / 200);
    c.strokeStyle = '#e8b04a';
    c.lineWidth = 1.6;
    c.beginPath();
    c.arc(p.x, p.y, TS * 0.75 * pulse, 0, Math.PI * 2);
    c.stroke();
  }

  private drawAgents(sim: Simulation, alpha: number, view: ViewState, z: number) {
    const c = this.ctx;
    const groupHue = new Map(sim.groups.map((g) => [g.id, g.hue]));
    const showGlyph = view.showGlyphs && z >= 1.15;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const a of sim.alive) {
      const p = this.agentPos(a, alpha);
      const child = !a.isAdult(sim.tick);
      const r = child ? 4 : 5.6;
      c.fillStyle = 'rgba(0,0,0,0.35)';
      c.beginPath();
      c.ellipse(p.x, p.y + r * 0.9, r * 0.9, r * 0.45, 0, 0, Math.PI * 2);
      c.fill();
      const hue = groupHue.get(a.group);
      if (hue !== undefined) {
        c.strokeStyle = groupColor(hue);
        c.lineWidth = 2;
        c.beginPath();
        c.arc(p.x, p.y, r + 1.8, 0, Math.PI * 2);
        c.stroke();
      }
      c.fillStyle = temperamentColor(a);
      c.beginPath();
      c.arc(p.x, p.y, r, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = 'rgba(10,12,16,0.75)';
      c.lineWidth = 0.8;
      c.stroke();
      if (a.sick > 0) {
        c.fillStyle = '#9be05a';
        c.beginPath();
        c.arc(p.x + r * 0.7, p.y - r * 0.7, 1.8, 0, Math.PI * 2);
        c.fill();
      }
      if (a.health < 0.4) {
        c.fillStyle = 'rgba(226,102,92,0.9)';
        c.fillRect(p.x - r, p.y + r + 2, 2 * r * a.health, 1.5);
      }
      if (a.food >= 1) {
        c.fillStyle = '#e0546f';
        c.beginPath();
        c.arc(p.x - r * 0.8, p.y + r * 0.6, 1.4, 0, Math.PI * 2);
        c.fill();
      }
      const act = a.intent?.act ?? Act.Idle;
      if ((showGlyph || view.hovered === a.id || view.selected === a.id) && act !== Act.Idle) {
        c.font = '8px system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"';
        c.fillText(ACT_GLYPH[act], p.x, p.y - r - 6);
      }
    }
  }
}
