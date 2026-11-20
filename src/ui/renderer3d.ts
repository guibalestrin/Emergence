import * as THREE from 'three';
import type { Simulation } from '../sim/sim';
import type { Agent } from '../sim/agent';
import { W, H, N_TILES, Terrain, TICKS_PER_DAY, NIGHT_START } from '../sim/types';
import { mutualTrust, GROUP_TRUST } from '../sim/social';
import { tileRGB, temperamentColor, hash, type ViewState, type WorldView } from './renderer';

// One world unit = one tile. Tile (x, y) sits at (x - W/2 + .5, top, y - H/2 + .5).
const OX = -W / 2 + 0.5;
const OZ = -H / 2 + 0.5;
const WATER_Y = -0.06;
const FX_LIFE = 45;
const FX_RGB: Record<string, [number, number, number]> = {
  share: [0.37, 0.82, 0.65], trade: [0.91, 0.69, 0.29], talk: [0.47, 0.65, 1], steal: [0.89, 0.4, 0.36],
  caught: [1, 0.31, 0.27], refuse: [0.59, 0.59, 0.63], birth: [0.95, 0.65, 0.81], death: [0.78, 0.78, 0.78],
};

const tx = (tile: number) => (tile % W) + OX;
const tz = (tile: number) => ((tile / W) | 0) + OZ;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Returns null when WebGL is unavailable, so the app can stay in 2D. */
export function createRenderer3D(canvas: HTMLCanvasElement, label: HTMLElement): Renderer3D | null {
  try {
    return new Renderer3D(canvas, label);
  } catch (e) {
    console.warn('3D indisponível, usando 2D', e);
    return null;
  }
}

export class Renderer3D implements WorldView {
  width = 0;
  height = 0;
  private gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 0.5, 600);
  private target = new THREE.Vector3(0, 0, 0);
  private dist = 80;
  private yaw = 0.0;
  private pitch = 0.95; // radians above the horizon
  private tween: { from: [number, number, number, number, number, number]; to: [number, number, number, number, number, number]; t0: number; dur: number } | null = null;
  private orbiting = false;
  private lastNow = 0;

  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private fog: THREE.Fog;

  private tiles: THREE.InstancedMesh;
  private water: THREE.Mesh;
  private trunks: THREE.InstancedMesh;
  private crowns: THREE.InstancedMesh;
  private bushes: THREE.InstancedMesh;
  private berries: THREE.InstancedMesh;
  private flames: THREE.InstancedMesh;
  private houses: THREE.InstancedMesh;
  private roofs: THREE.InstancedMesh;
  private bodies: THREE.InstancedMesh;
  private rings: THREE.InstancedMesh;
  private lines: THREE.LineSegments;
  private linePos: Float32Array;
  private lineCol: Float32Array;
  private selRing: THREE.Mesh;
  private beam: THREE.Mesh;
  private brushRing: THREE.Mesh;
  private glows: THREE.Sprite[] = [];
  private glowTex = glowTexture();
  private weather: THREE.Points;
  private weatherPos: Float32Array;

  private top = new Float32Array(N_TILES);
  private drawnVersion = -1;
  private drawnSeason = -1;
  private lastTerrain = 0;

  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  private ray = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.08);

  constructor(public canvas: HTMLCanvasElement, private label: HTMLElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;

    const sc = this.scene;
    sc.background = new THREE.Color('#0d0c0a');
    this.fog = new THREE.Fog('#0d0c0a', 120, 260);
    sc.fog = this.fog;

    this.hemi = new THREE.HemisphereLight('#dfe8ff', '#3a2e22', 0.9);
    sc.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff1dc', 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sh = this.sun.shadow.camera;
    sh.left = -W * 0.62; sh.right = W * 0.62; sh.top = H * 0.75; sh.bottom = -H * 0.75; sh.near = 1; sh.far = 260;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    sc.add(this.sun, this.sun.target);

    // pedestal under the diorama
    const base = new THREE.Mesh(new THREE.BoxGeometry(W + 1.2, 1.4, H + 1.2), new THREE.MeshStandardMaterial({ color: '#1b1712', roughness: 1 }));
    base.position.y = -1.72;
    base.receiveShadow = true;
    sc.add(base);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshStandardMaterial({ color: '#0d0c0a', roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.45;
    floor.receiveShadow = true;
    sc.add(floor);

    // terrain: one column per tile, top face at `top[i]`
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, -0.5, 0);
    this.tiles = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 }), N_TILES);
    this.tiles.receiveShadow = true;
    this.tiles.castShadow = true;
    this.tiles.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N_TILES * 3), 3);
    sc.add(this.tiles);

    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshStandardMaterial({ color: '#2f6f8f', roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.78 }),
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = WATER_Y;
    this.water.receiveShadow = true;
    sc.add(this.water);

    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number, cast = true) => {
      const im = new THREE.InstancedMesh(geo, mat, n);
      im.castShadow = cast;
      im.receiveShadow = true;
      im.count = 0;
      im.frustumCulled = false; // instances move every frame; a cached bounding sphere would hide them
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      sc.add(im);
      return im;
    };
    const trunk = new THREE.CylinderGeometry(0.05, 0.07, 0.3, 5);
    trunk.translate(0, 0.15, 0);
    const crown = new THREE.ConeGeometry(0.26, 0.75, 6);
    crown.translate(0, 0.62, 0);
    this.trunks = mk(trunk, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 }), 16000);
    this.crowns = mk(crown, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, flatShading: true }), 16000);
    const bush = new THREE.IcosahedronGeometry(0.22, 0);
    bush.translate(0, 0.16, 0);
    this.bushes = mk(bush, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true }), N_TILES);
    this.berries = mk(new THREE.IcosahedronGeometry(0.06, 0), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4, emissive: '#3a0610' }), 12000, false);
    const flame = new THREE.ConeGeometry(0.28, 0.9, 5);
    flame.translate(0, 0.45, 0);
    this.flames = mk(flame, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.88, blending: THREE.AdditiveBlending, depthWrite: false }), N_TILES, false);

    const body = new THREE.BoxGeometry(0.66, 0.46, 0.66);
    body.translate(0, 0.23, 0);
    const roof = new THREE.ConeGeometry(0.6, 0.42, 4);
    roof.rotateY(Math.PI / 4);
    roof.translate(0, 0.67, 0);
    this.houses = mk(body, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 }), 512);
    this.roofs = mk(roof, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true }), 512);

    const pawn = new THREE.CapsuleGeometry(0.24, 0.42, 4, 12);
    pawn.translate(0, 0.45, 0);
    this.bodies = mk(pawn, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4, metalness: 0.05, emissive: '#1a1712' }), 512);
    const torus = new THREE.TorusGeometry(0.4, 0.055, 6, 28);
    torus.rotateX(Math.PI / 2);
    torus.translate(0, 0.03, 0);
    this.rings = mk(torus, new THREE.MeshBasicMaterial({ color: '#ffffff' }), 512, false);

    const LCAP = 24000;
    this.linePos = new Float32Array(LCAP * 3);
    this.lineCol = new Float32Array(LCAP * 3);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3).setUsage(THREE.DynamicDrawUsage));
    lg.setAttribute('color', new THREE.BufferAttribute(this.lineCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 5;
    sc.add(this.lines);

    const ring = new THREE.RingGeometry(0.52, 0.64, 40);
    ring.rotateX(-Math.PI / 2);
    this.selRing = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: '#f0b54d', transparent: true, depthWrite: false }));
    this.selRing.visible = false;
    sc.add(this.selRing);
    const beamGeo = new THREE.CylinderGeometry(0.05, 0.22, 6, 16, 1, true);
    beamGeo.translate(0, 3, 0);
    this.beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: '#f0b54d', transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.beam.visible = false;
    sc.add(this.beam);
    this.brushRing = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#f0b54d', transparent: true, opacity: 0.85, depthWrite: false }));
    this.brushRing.visible = false;
    sc.add(this.brushRing);

    // weather particles (rain / snow), recycled in a box above the map
    const WN = 2600;
    this.weatherPos = new Float32Array(WN * 3);
    for (let i = 0; i < WN; i++) {
      this.weatherPos[i * 3] = (Math.random() - 0.5) * W;
      this.weatherPos[i * 3 + 1] = Math.random() * 30;
      this.weatherPos[i * 3 + 2] = (Math.random() - 0.5) * H;
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.BufferAttribute(this.weatherPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.weather = new THREE.Points(wg, new THREE.PointsMaterial({ color: '#cfe0ff', size: 0.12, transparent: true, opacity: 0.7, depthWrite: false }));
    this.weather.visible = false;
    this.weather.frustumCulled = false;
    sc.add(this.weather);
  }

  // ------------------------------------------------------------ camera --
  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.width = r.width;
    this.height = r.height;
    if (!r.width || !r.height) return;
    this.gl.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.gl.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
  }

  private fitDist() {
    const aspect = this.width / Math.max(1, this.height);
    const vh = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    return Math.max((H * 1.12) / vh, (W * 1.16) / (vh * aspect));
  }

  fit() {
    this.tween = null;
    this.target.set(0, 0, 2);
    this.dist = this.fitDist();
    this.yaw = 0;
    this.pitch = 0.9;
  }

  /** Slow, low orbit used behind the intro screen. */
  setCinematic(on: boolean) {
    if (on) {
      this.orbiting = true;
      this.tween = null;
      this.target.set(0, 0, 0);
      this.dist = this.fitDist() * 0.72;
      this.pitch = 0.5;
    } else if (this.orbiting) {
      this.orbiting = false;
      const yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));
      this.yaw = yaw;
      this.tween = {
        from: [this.target.x, this.target.z, this.dist, yaw, this.pitch, 0],
        to: [0, 2, -1, 0, 0.9, 0], // -1: resolve the fit distance live (the stage is resizing)
        t0: performance.now(),
        dur: 1900,
      };
    }
  }

  private unitsPerPx() {
    return (2 * this.dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / Math.max(1, this.height);
  }

  panBy(dx: number, dy: number) {
    this.tween = null;
    const k = this.unitsPerPx();
    const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw);
    // screen right = (cos, -sin) on the ground; screen down = towards the camera
    this.target.x -= (dx * cos + dy * sin / Math.sin(this.pitch)) * k;
    this.target.z -= (-dx * sin + dy * cos / Math.sin(this.pitch)) * k;
    this.clampTarget();
  }

  orbit(dx: number, dy: number) {
    this.tween = null;
    this.yaw -= dx * 0.006;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.004, 0.32, 1.45);
  }

  zoomAt(sx: number, sy: number, factor: number) {
    this.tween = null;
    const p = this.groundAt(sx, sy);
    const nd = THREE.MathUtils.clamp(this.dist / factor, 6, this.fitDist() * 1.6);
    const k = 1 - nd / this.dist;
    if (p) {
      this.target.x += (p.x - this.target.x) * k;
      this.target.z += (p.z - this.target.z) * k;
    }
    this.dist = nd;
    this.clampTarget();
  }

  private clampTarget() {
    this.target.x = THREE.MathUtils.clamp(this.target.x, -W / 2, W / 2);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -H / 2, H / 2);
  }

  centerOn(tile: number) {
    this.tween = {
      from: [this.target.x, this.target.z, this.dist, this.yaw, this.pitch, 0],
      to: [tx(tile), tz(tile), Math.min(this.dist, 30), this.yaw, Math.max(this.pitch, 0.8), 0],
      t0: performance.now(),
      dur: 900,
    };
  }

  follow(a: Agent, alpha: number) {
    if (this.tween) return;
    const p = this.agentXZ(a, alpha);
    this.target.x += (p.x - this.target.x) * 0.12;
    this.target.z += (p.z - this.target.z) * 0.12;
  }

  private updateCamera(now: number) {
    const dt = Math.min(0.1, (now - (this.lastNow || now)) / 1000);
    this.lastNow = now;
    if (this.orbiting) this.yaw += dt * 0.06;
    if (this.tween) {
      const tw = this.tween;
      const k = easeInOut(Math.min(1, (now - tw.t0) / tw.dur));
      const L = (i: number) => tw.from[i] + ((i === 2 && tw.to[i] < 0 ? this.fitDist() : tw.to[i]) - tw.from[i]) * k;
      this.target.x = L(0); this.target.z = L(1); this.dist = L(2); this.yaw = L(3); this.pitch = L(4);
      if (k >= 1) this.tween = null;
    }
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z + Math.cos(this.yaw) * cp * this.dist,
    );
    this.camera.lookAt(this.target);
  }

  // ----------------------------------------------------------- picking --
  private groundAt(sx: number, sy: number) {
    if (!this.width) return null;
    this.ray.setFromCamera(new THREE.Vector2((sx / this.width) * 2 - 1, -(sy / this.height) * 2 + 1), this.camera);
    return this.ray.ray.intersectPlane(this.ground, new THREE.Vector3());
  }

  screenToTile(sx: number, sy: number) {
    const p = this.groundAt(sx, sy);
    if (!p) return -1;
    const x = Math.floor(p.x - OX + 0.5), y = Math.floor(p.z - OZ + 0.5);
    if (x < 0 || y < 0 || x >= W || y >= H) return -1;
    return y * W + x;
  }

  private agentXZ(a: Agent, alpha: number) {
    const x0 = tx(a.prevTile), z0 = tz(a.prevTile), x1 = tx(a.tile), z1 = tz(a.tile);
    return { x: x0 + (x1 - x0) * alpha, z: z0 + (z1 - z0) * alpha, y: Math.max(0, this.top[a.prevTile] + (this.top[a.tile] - this.top[a.prevTile]) * alpha) };
  }

  private project(x: number, y: number, z: number) {
    this.v.set(x, y, z).project(this.camera);
    return { x: (this.v.x * 0.5 + 0.5) * this.width, y: (-this.v.y * 0.5 + 0.5) * this.height, behind: this.v.z > 1 };
  }

  pickAgent(sim: Simulation, sx: number, sy: number, alpha: number): Agent | null {
    let best: Agent | null = null;
    const r = Math.max(14, Math.min(40, 260 / this.dist * 3));
    let bd = r * r;
    for (const a of sim.alive) {
      const p = this.agentXZ(a, alpha);
      const s = this.project(p.x, p.y + 0.45, p.z);
      if (s.behind) continue;
      const d = (s.x - sx) ** 2 + (s.y - sy) ** 2;
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  // ----------------------------------------------------------- terrain --
  private rebuildTerrain(sim: Simulation) {
    const w = sim.world;
    const season = sim.season();
    const winter = season === 3, autumn = season === 2;
    const thr = w.dryThreshold();
    const colors = this.tiles.instanceColor!;
    let nt = 0, nb = 0, nr = 0;
    for (let i = 0; i < N_TILES; i++) {
      const t = w.terrain[i];
      let top: number;
      if (t === Terrain.Water) top = w.depth[i] > thr ? -0.14 - Math.min(1, (w.depth[i] - thr) / 0.25) * 0.4 : -0.03;
      else if (t === Terrain.Sand) top = 0.04;
      else if (t === Terrain.Rock) top = 0.35 + hash(i, 7) * 0.7;
      else top = 0.09 + hash(i, 8) * 0.04;
      this.top[i] = top;
      const x = tx(i), z = tz(i);
      this.m.compose(this.v.set(x, top, z), this.q.identity(), this.s.set(1, top + 1, 1));
      this.tiles.setMatrixAt(i, this.m);
      const rgb = tileRGB(sim, i, winter, autumn, thr);
      let k = 1;
      if (w.scorch[i] > 0) k = 1 - w.scorch[i] * 0.7;
      if (t === Terrain.Rock && winter) { rgb[0] = rgb[0] * 0.5 + 115; rgb[1] = rgb[1] * 0.5 + 118; rgb[2] = rgb[2] * 0.5 + 122; }
      this.c.setRGB((rgb[0] / 255) * k, (rgb[1] / 255) * k, (rgb[2] / 255) * k, THREE.SRGBColorSpace);
      colors.setXYZ(i, this.c.r, this.c.g, this.c.b);

      if (t === Terrain.Forest) {
        const n = 1 + Math.round((w.wood[i] / Math.max(1, w.woodCap[i])) * 3);
        for (let k2 = 0; k2 < n && nt < 16000; k2++) {
          const px = x - 0.32 + hash(i, 10 + k2) * 0.64, pz = z - 0.32 + hash(i, 20 + k2) * 0.64;
          const sc = 0.75 + hash(i, 40 + k2) * 0.55;
          this.m.compose(this.v.set(px, top, pz), this.q.setFromAxisAngle(this.v2(0, 1, 0), hash(i, 60 + k2) * 6), this.s.set(sc, sc, sc));
          this.trunks.setMatrixAt(nt, this.m);
          this.crowns.setMatrixAt(nt, this.m);
          this.c.set(winter ? '#5d7a69' : autumn && hash(i, 30 + k2) > 0.6 ? '#a8702c' : hash(i, 31 + k2) > 0.5 ? '#2f6438' : '#275530');
          if (w.scorch[i] > 0) this.c.multiplyScalar(1 - w.scorch[i] * 0.7);
          this.crowns.setColorAt(nt, this.c);
          this.trunks.setColorAt(nt, this.c.set('#5a3f2a'));
          nt++;
        }
      }
      if (w.foodCap[i] > 0) {
        this.m.compose(this.v.set(x, top, z), this.q.identity(), this.s.set(1, 0.8 + hash(i, 9) * 0.4, 1));
        this.bushes.setMatrixAt(nb, this.m);
        this.bushes.setColorAt(nb, this.c.set(winter ? '#6b806b' : '#3d7a44'));
        nb++;
      }
      if (w.foodCap[i] > 0 || w.food[i] > 0.4) {
        const n = Math.min(7, Math.round(w.food[i]));
        for (let k2 = 0; k2 < n && nr < 12000; k2++) {
          const a = (k2 / 7) * Math.PI * 2 + hash(i, 50) * 6;
          this.m.compose(this.v.set(x + Math.cos(a) * 0.19, top + 0.2 + hash(i, 70 + k2) * 0.12, z + Math.sin(a) * 0.19), this.q.identity(), this.s.set(1, 1, 1));
          this.berries.setMatrixAt(nr, this.m);
          this.berries.setColorAt(nr, this.c.set('#e0405f'));
          nr++;
        }
      }
    }
    this.tiles.instanceMatrix.needsUpdate = true;
    colors.needsUpdate = true;
    for (const [im, n] of [[this.trunks, nt], [this.crowns, nt], [this.bushes, nb], [this.berries, nr]] as const) {
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    const wm = this.water.material as THREE.MeshStandardMaterial;
    wm.color.set(winter ? '#8fb4c6' : '#2f6f8f');
    wm.roughness = winter ? 0.5 : 0.12;
  }
  private axis = new THREE.Vector3();
  private v2(x: number, y: number, z: number) {
    return this.axis.set(x, y, z);
  }

  // ------------------------------------------------------------- frame --
  draw(sim: Simulation, alpha: number, view: ViewState, now: number) {
    const w = sim.world;
    const season = sim.season();
    if ((w.version !== this.drawnVersion && now - this.lastTerrain > 250) || season !== this.drawnSeason) {
      this.rebuildTerrain(sim);
      this.drawnVersion = w.version;
      this.drawnSeason = season;
      this.lastTerrain = now;
    }
    this.updateCamera(now);
    this.updateLight(sim, now);
    this.drawFire(sim, now);
    this.drawShelters(sim);
    this.drawAgents(sim, alpha, now);
    this.drawLines(sim, alpha, view);
    this.drawSelection(sim, alpha, view, now);
    this.drawWeather(sim, now);

    if (view.brush) {
      const b = view.brush;
      this.brushRing.visible = true;
      this.brushRing.position.set(tx(b.tile), Math.max(0.12, this.top[b.tile] + 0.03), tz(b.tile));
      this.brushRing.scale.setScalar(b.radius + 0.5);
    } else this.brushRing.visible = false;

    this.gl.render(this.scene, this.camera);
  }

  private darkness(sim: Simulation) {
    const tod = sim.tick % TICKS_PER_DAY;
    if (tod >= NIGHT_START) return Math.min(1, (tod - NIGHT_START) / 8);
    if (tod < 6) return 1 - tod / 6;
    return 0;
  }

  private updateLight(sim: Simulation, now: number) {
    const night = this.darkness(sim);
    const tod = (sim.tick % TICKS_PER_DAY) / NIGHT_START; // 0..1 across daylight
    const winter = sim.season() === 3;
    const drought = !!sim.climate && sim.climate.rain < 1;
    // sun arcs east → west; at night a cold moon takes over
    const ang = Math.PI * Math.min(1, Math.max(0, tod));
    this.sun.position.set(Math.cos(ang) * 70, 30 + Math.sin(ang) * 60, 35);
    if (night > 0.5) this.sun.position.set(-40, 70, -30);
    const dayCol = this.c.set(drought ? '#ffd9a8' : winter ? '#e8f0ff' : '#fff1dc');
    const low = 1 - Math.sin(ang);
    dayCol.lerp(new THREE.Color('#ff9a52'), low * 0.45);
    this.sun.color.copy(dayCol).lerp(new THREE.Color('#7f9bd6'), night);
    this.sun.intensity = 2.3 * (1 - night) + 0.9 * night;
    this.hemi.intensity = 0.95 * (1 - night) + 0.55 * night;
    this.hemi.color.set(winter ? '#e6eeff' : '#dfe8ff').lerp(new THREE.Color('#5d6f9e'), night);
    const bg = this.c.set(drought ? '#16110b' : '#0d0c0a').lerp(new THREE.Color('#070912'), night);
    (this.scene.background as THREE.Color).copy(bg);
    this.fog.color.copy(bg);
    const wm = this.water.material as THREE.MeshStandardMaterial;
    wm.opacity = 0.74 + Math.sin(now / 900) * 0.04;

    // warm windows at night
    const lit = night > 0.1 ? sim.shelters.filter((s) => s.alive && s.wood > 0 && s.owners.length) : [];
    while (this.glows.length < lit.length) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: '#ffae55', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      sp.scale.set(3.2, 3.2, 1);
      this.scene.add(sp);
      this.glows.push(sp);
    }
    this.glows.forEach((g, i) => {
      const s = lit[i];
      g.visible = !!s;
      if (!s) return;
      g.position.set(tx(s.tile), this.top[s.tile] + 0.5, tz(s.tile));
      g.material.opacity = night * (0.75 + Math.sin(now / 160 + i) * 0.08);
    });
  }

  private drawFire(sim: Simulation, now: number) {
    const w = sim.world;
    let n = 0;
    if (w.burningCount > 0) {
      for (let i = 0; i < N_TILES; i++) {
        if (w.fire[i] === 0) continue;
        const f = 0.65 + 0.35 * Math.sin(now / 80 + i * 1.7);
        this.m.compose(this.v.set(tx(i), this.top[i], tz(i)), this.q.setFromAxisAngle(this.v2(0, 1, 0), now / 400 + i), this.s.set(0.8 + f * 0.4, 0.6 + f * 0.9, 0.8 + f * 0.4));
        this.flames.setMatrixAt(n, this.m);
        this.flames.setColorAt(n, this.c.setRGB(1, 0.35 + f * 0.35, 0.08));
        n++;
      }
    }
    this.flames.count = n;
    this.flames.instanceMatrix.needsUpdate = true;
    if (this.flames.instanceColor) this.flames.instanceColor.needsUpdate = true;
  }

  private drawShelters(sim: Simulation) {
    let n = 0;
    for (const sh of sim.shelters) {
      if (!sh.alive || n >= 512) continue;
      const owner = sh.owners.length ? sim.byId.get(sh.owners[0]) : undefined;
      const g = owner && owner.group >= 0 ? sim.groups.find((x) => x.id === owner.group) : undefined;
      this.m.compose(this.v.set(tx(sh.tile), this.top[sh.tile], tz(sh.tile)), this.q.identity(), this.s.set(1, 1, 1));
      this.houses.setMatrixAt(n, this.m);
      this.roofs.setMatrixAt(n, this.m);
      this.houses.setColorAt(n, sh.owners.length ? this.c.set('#d8c39a') : this.c.set('#7d756a'));
      this.roofs.setColorAt(n, g ? this.c.setHSL(g.hue / 360, 0.45, 0.45, THREE.SRGBColorSpace) : this.c.set('#6b4a2e'));
      n++;
    }
    for (const im of [this.houses, this.roofs]) {
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  private drawAgents(sim: Simulation, alpha: number, now: number) {
    const groupHue = new Map(sim.groups.map((g) => [g.id, g.hue]));
    let n = 0, nr = 0;
    for (const a of sim.alive) {
      if (n >= 512) break;
      const p = this.agentXZ(a, alpha);
      const moving = a.prevTile !== a.tile;
      const bob = moving ? Math.abs(Math.sin(now / 110 + a.id)) * 0.07 : 0;
      const sc = a.isAdult(sim.tick) ? 1 : 0.68;
      const dx = tx(a.tile) - tx(a.prevTile), dz = tz(a.tile) - tz(a.prevTile);
      const lean = moving ? 0.12 : 0;
      this.q.setFromEuler(new THREE.Euler(dz * lean, 0, -dx * lean));
      this.m.compose(this.v.set(p.x, p.y + bob, p.z), this.q, this.s.set(sc, sc, sc));
      this.bodies.setMatrixAt(n, this.m);
      this.c.set(temperamentColor(a));
      if (a.sick > 0) this.c.lerp(new THREE.Color('#9be05a'), 0.45);
      if (a.health < 0.4) this.c.multiplyScalar(0.55 + a.health);
      this.bodies.setColorAt(n, this.c);
      n++;
      const hue = groupHue.get(a.group);
      if (hue !== undefined) {
        this.m.compose(this.v.set(p.x, p.y, p.z), this.q.identity(), this.s.set(sc, 1, sc));
        this.rings.setMatrixAt(nr, this.m);
        this.rings.setColorAt(nr, this.c.setHSL(hue / 360, 0.72, 0.62, THREE.SRGBColorSpace));
        nr++;
      }
    }
    this.bodies.count = n;
    this.rings.count = nr;
    for (const im of [this.bodies, this.rings]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  private nl = 0;
  private seg(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, g: number, b: number) {
    if (this.nl + 2 > this.linePos.length / 3) return;
    const P = this.linePos, C = this.lineCol;
    let o = this.nl * 3;
    P[o] = ax; P[o + 1] = ay; P[o + 2] = az; C[o] = r; C[o + 1] = g; C[o + 2] = b;
    o += 3;
    P[o] = bx; P[o + 1] = by; P[o + 2] = bz; C[o] = r; C[o + 1] = g; C[o + 2] = b;
    this.nl += 2;
  }
  private arc(ax: number, ay: number, az: number, bx: number, by: number, bz: number, h: number, r: number, g: number, b: number) {
    const N = 10;
    let px = ax, py = ay, pz = az;
    for (let k = 1; k <= N; k++) {
      const t = k / N;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = ay + (by - ay) * t + Math.sin(Math.PI * t) * h;
      this.seg(px, py, pz, x, y, z, r, g, b);
      px = x; py = y; pz = z;
    }
  }

  private drawLines(sim: Simulation, alpha: number, view: ViewState) {
    this.nl = 0;
    const al = sim.alive;
    if (view.showNet) {
      for (let i = 0; i < al.length; i++)
        for (let j = i + 1; j < al.length; j++) {
          const m = mutualTrust(al[i], al[j]);
          if (m < GROUP_TRUST * 0.75) continue;
          const a = this.agentXZ(al[i], alpha), b = this.agentXZ(al[j], alpha);
          const g = al[i].group >= 0 && al[i].group === al[j].group ? sim.groups.find((x) => x.id === al[i].group) : undefined;
          if (g) this.c.setHSL(g.hue / 360, 0.72, 0.62, THREE.SRGBColorSpace);
          else this.c.setRGB(0.85, 0.87, 0.9);
          const k = 0.2 + m * 0.5;
          this.arc(a.x, a.y + 0.5, a.z, b.x, b.y + 0.5, b.z, 0.6, this.c.r * k, this.c.g * k, this.c.b * k);
        }
    }
    for (const f of sim.fx) {
      const age = sim.tick - f.tick;
      if (age > FX_LIFE) continue;
      const k = 1 - age / FX_LIFE;
      const col = FX_RGB[f.kind];
      const ax = tx(f.a), az = tz(f.a), bx = tx(f.b), bz = tz(f.b);
      const ay = Math.max(0, this.top[f.a]) + 0.5, by = Math.max(0, this.top[f.b]) + 0.5;
      if (f.kind === 'birth' || f.kind === 'death') {
        const r = 0.4 + (1 - k) * 1.6;
        const N = 24;
        for (let s = 0; s < N; s++) {
          const t0 = (s / N) * Math.PI * 2, t1 = ((s + 1) / N) * Math.PI * 2;
          this.seg(ax + Math.cos(t0) * r, ay - 0.3, az + Math.sin(t0) * r, ax + Math.cos(t1) * r, ay - 0.3, az + Math.sin(t1) * r, col[0] * k, col[1] * k, col[2] * k);
        }
        continue;
      }
      this.arc(ax, ay, az, bx, by, bz, 1.1 + (1 - k) * 0.5, col[0] * k, col[1] * k, col[2] * k);
    }
    const sel = view.selected !== null ? sim.byId.get(view.selected) : undefined;
    if (sel && sel.alive) {
      const p = this.agentXZ(sel, alpha);
      for (const [id, r] of sel.rel) {
        if (r.fam <= 0.08 || Math.abs(r.trust) <= 0.2) continue;
        const b = sim.byId.get(id);
        if (!b?.alive) continue;
        const q = this.agentXZ(b, alpha);
        const k = 0.3 + Math.abs(r.trust) * 0.7;
        if (r.trust > 0) this.arc(p.x, p.y + 0.6, p.z, q.x, q.y + 0.6, q.z, 1.4, 0.37 * k, 0.82 * k, 0.65 * k);
        else this.arc(p.x, p.y + 0.6, p.z, q.x, q.y + 0.6, q.z, 1.4, 0.89 * k, 0.4 * k, 0.36 * k);
      }
      const it = sel.intent;
      if (it && it.path.length) {
        let px = p.x, pz = p.z, py = p.y + 0.06;
        for (let s = 0; s < it.path.length; s++) {
          const t = it.path[s];
          const x = tx(t), z = tz(t), y = Math.max(0, this.top[t]) + 0.06;
          if (s % 2 === 0) this.seg(px, py, pz, x, y, z, 0.94, 0.7, 0.3);
          px = x; py = y; pz = z;
        }
      }
    }
    const g = this.lines.geometry;
    g.setDrawRange(0, this.nl);
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  private drawSelection(sim: Simulation, alpha: number, view: ViewState, now: number) {
    const sel = view.selected !== null ? sim.byId.get(view.selected) : undefined;
    const show = !!sel && sel.alive;
    this.selRing.visible = this.beam.visible = show;
    if (!show) {
      this.label.style.display = 'none';
      return;
    }
    const p = this.agentXZ(sel!, alpha);
    const pulse = 1 + 0.12 * Math.sin(now / 200);
    this.selRing.position.set(p.x, p.y + 0.03, p.z);
    this.selRing.scale.setScalar(pulse);
    this.beam.position.set(p.x, p.y, p.z);
    (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.05 * Math.sin(now / 300);
    const s = this.project(p.x, p.y + 1.25, p.z);
    if (s.behind) {
      this.label.style.display = 'none';
      return;
    }
    this.label.style.display = 'block';
    this.label.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -100%)`;
    const txt = `${sel!.name} · ${sim.actLabel(sel!)}`;
    if (this.label.textContent !== txt) this.label.textContent = txt;
  }

  private drawWeather(sim: Simulation, now: number) {
    const raining = !!sim.climate && sim.climate.rain > 1;
    const snowing = sim.season() === 3;
    this.weather.visible = raining || snowing;
    if (!this.weather.visible) return;
    const mat = this.weather.material as THREE.PointsMaterial;
    mat.color.set(raining ? '#a9c6ff' : '#f4f7ff');
    mat.size = raining ? 0.09 : 0.16;
    const P = this.weatherPos;
    const vy = raining ? 0.55 : 0.06;
    for (let i = 0; i < P.length; i += 3) {
      P[i + 1] -= vy;
      if (snowing && !raining) P[i] += Math.sin(now / 900 + i) * 0.015;
      if (P[i + 1] < 0) {
        P[i] = (Math.random() - 0.5) * W;
        P[i + 1] = 22 + Math.random() * 8;
        P[i + 2] = (Math.random() - 0.5) * H;
      }
    }
    (this.weather.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
