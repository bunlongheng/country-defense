import type { Enemy, Projectile, Tower, TowerType, Vec2 } from "./types.ts";
import { GRID_COLS, GRID_ROWS, WAYPOINTS, BASE_CELL, pathCells } from "./map.ts";
import type { Scenery } from "./stages.ts";
import { TOWER_DEFS, towerStats, MAX_LEVEL } from "./towers.ts";
import type { Particle } from "./particles.ts";
import { getFlagImage } from "../flagImage.ts";
import { getSprite } from "./sprites.ts";
import { hexA } from "./math.ts";

// The 2D canvas renderer, kept out of the React component so it is a pure,
// reusable function of (ctx, cell, state). Browser-only (uses CanvasRenderingContext2D).

export interface DrawState {
  code: string;
  palette: string[]; // dominant flag colors of the defended country (theme)
  time: number; // seconds since start, drives spin/float animation
  enemies: Enemy[];
  towers: Tower[];
  projectiles: Projectile[];
  particles: Particle[];
  lives: number; // current base lives (drives base damage / fire)
  maxLives: number;
  gameTime: number; // accumulated in-wave time (drives status-effect expiry)
  selectedId: number | null;
  buildType: TowerType | null;
  cursor?: { x: number; y: number } | null;
  preview?: { cell: Vec2; type: TowerType } | null; // ghost + range for the honeycomb pick
  nuke?: { x: number; y: number; radius: number; armed: boolean; counting: boolean } | null; // reticle / portal
  nukeBlast?: { x: number; y: number; born: number } | null; // missile drop + mushroom cloud
  stageId?: number; // which stage's map + scenery to draw (1..10)
  scenery?: Scenery; // ground/road/decor theme for the current stage
  waypoints?: Vec2[]; // the current stage's path (defaults to stage 1)
  pathSet?: Set<string>; // path + no-build tiles (drives the build-pad layout)
  noBuild?: Set<string>; // extra blocked tiles (water / lava), drawn themed
  baseCell?: Vec2; // where the home base sits (end of the path)
  shield?: boolean; // base shield still up? (hides the health bar, shows the bubble)
}

// One global sun direction so every dome, marble and mountain is lit the same way.
const LIGHT = { x: -0.42, y: -0.55 };

const toPx = (v: Vec2, cell: number): Vec2 => ({
  x: (v.x + 0.5) * cell,
  y: (v.y + 0.5) * cell,
});

const PATH = pathCells();
const EMPTY_SET = new Set<string>();

// ---- tiny color helpers ---------------------------------------------------
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** Mix a hex color toward white (t>0) or black (t<0); t in -1..1. */
function shade(hex: string, t: number): string {
  const [r, g, b] = rgb(hex);
  const to = t >= 0 ? 255 : 0;
  const a = Math.abs(t);
  const m = (v: number) => Math.round(v + (to - v) * a);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}
// Deterministic 0..1 hash per tile so scenery is stable across frames/resizes.
function hash(c: number, r: number, salt = 0): number {
  const n = Math.sin(c * 127.1 + r * 311.7 + salt * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

// The scenery (terrain + mountains + trees + road + build plots) never changes
// except on resize or when the country theme resolves, so it is painted once to
// an offscreen canvas and blitted each frame.
let bgCanvas: HTMLCanvasElement | null = null;
let bgKey = "";

interface StageDraw {
  stageId: number;
  scenery: Scenery;
  waypoints: Vec2[];
  pathSet: Set<string>;
  noBuild: Set<string>;
}

// Forest is the fallback theme so the base map still renders if no stage is given.
const FOREST: Scenery = {
  ground: ["#1c2b16", "#0e1a0c"],
  road: ["rgba(41,30,20,0.9)", "#5a4326", "#6f5330"],
  accent: "#f9a8d4",
  fleck: "#3a2a18",
  decor: "forest",
};

function background(
  cell: number,
  code: string,
  palette: string[],
  st: StageDraw,
): HTMLCanvasElement {
  const key = `${cell}|${code}|${palette[0] ?? ""}|${st.stageId}`;
  if (bgCanvas && bgKey === key) return bgCanvas;
  const w = cell * GRID_COLS;
  const h = cell * GRID_ROWS;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const sc = st.scenery;
  const accent = sc.accent;
  const inPath = (c: number, r: number) => st.pathSet.has(`${c},${r}`);
  const inWater = (c: number, r: number) => st.noBuild.has(`${c},${r}`);

  // themed ground base
  const ground = ctx.createLinearGradient(0, 0, 0, h);
  ground.addColorStop(0, sc.ground[0]);
  ground.addColorStop(1, sc.ground[1]);
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, w, h);

  // soft mottling for texture (tinted to the ground)
  for (let i = 0; i < 90; i++) {
    const x = hash(i, 3, 1) * w;
    const y = hash(i, 7, 2) * h;
    ctx.fillStyle = hexA(hash(i, 1, 5) > 0.5 ? sc.ground[0] : sc.ground[1], 0.5);
    ctx.beginPath();
    ctx.arc(x, y, cell * (0.05 + hash(i, 9, 3) * 0.08), 0, Math.PI * 2);
    ctx.fill();
  }

  // no-build zones: water / lava the player can't build on (drawn as a tinted pool)
  const water = sc.decor === "volcano" ? "#7a1e08" : "#1e6fa8";
  const waterTop = sc.decor === "volcano" ? "#ff7a1a" : "#4fb0e0";
  for (let c = 0; c < GRID_COLS; c++) {
    for (let r = 0; r < GRID_ROWS; r++) {
      if (!inWater(c, r)) continue;
      const g = ctx.createLinearGradient(0, r * cell, 0, r * cell + cell);
      g.addColorStop(0, waterTop);
      g.addColorStop(1, water);
      ctx.fillStyle = g;
      ctx.fillRect(c * cell, r * cell, cell + 1, cell + 1);
      // ripple / glow lines
      ctx.strokeStyle = hexA(sc.decor === "volcano" ? "#ffd27a" : "#bfe6ff", 0.4);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(c * cell + cell * 0.2, r * cell + cell * (0.35 + hash(c, r, 21) * 0.3));
      ctx.lineTo(c * cell + cell * 0.8, r * cell + cell * (0.35 + hash(c, r, 22) * 0.3));
      ctx.stroke();
    }
  }

  // build plots: a faint rounded pad on every buildable tile (not path, not water)
  for (let c = 0; c < GRID_COLS; c++) {
    for (let r = 0; r < GRID_ROWS; r++) {
      if (inPath(c, r) || inWater(c, r)) continue;
      roundRect(ctx, c * cell + cell * 0.14, r * cell + cell * 0.14, cell * 0.72, cell * 0.72, cell * 0.14);
      ctx.fillStyle = "rgba(255,255,255,0.028)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // the road, themed per scenery (three stacked strokes: edge, mid, center)
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = sc.road[0];
  ctx.lineWidth = cell * 0.9;
  strokePath(ctx, cell, st.waypoints);
  ctx.strokeStyle = sc.road[1];
  ctx.lineWidth = cell * 0.7;
  strokePath(ctx, cell, st.waypoints);
  ctx.strokeStyle = sc.road[2];
  ctx.lineWidth = cell * 0.5;
  strokePath(ctx, cell, st.waypoints);
  // little specks along the track
  mudFlecks(ctx, cell, st.waypoints, sc.fleck);

  // stadium pitch: paint mow-stripes across the field so it reads as a soccer turf
  if (sc.decor === "stadium") {
    for (let c = 0; c < GRID_COLS; c += 2) {
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(c * cell, 0, cell, h);
    }
  }

  // signature props scattered on the terrain
  scenery(ctx, cell, accent, inPath, inWater, sc.decor);

  bgCanvas = canvas;
  bgKey = key;
  return canvas;
}


function mudFlecks(ctx: CanvasRenderingContext2D, cell: number, waypoints: Vec2[], color: string) {
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = toPx(waypoints[i], cell);
    const b = toPx(waypoints[i + 1], cell);
    const steps = 6;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t + (hash(i, s) - 0.5) * cell * 0.4;
      const y = a.y + (b.y - a.y) * t + (hash(i, s, 2) - 0.5) * cell * 0.4;
      ctx.beginPath();
      ctx.arc(x, y, cell * (0.05 + hash(i, s, 4) * 0.06), 0, Math.PI * 2);
      ctx.fillStyle = hexA(color, hash(i, s, 6) > 0.5 ? 0.6 : 0.35);
      ctx.fill();
    }
  }
}

function scenery(
  ctx: CanvasRenderingContext2D,
  cell: number,
  accent: string,
  inPath: (c: number, r: number) => boolean,
  inWater: (c: number, r: number) => boolean,
  decor: Scenery["decor"],
) {
  for (let c = 0; c < GRID_COLS; c++) {
    for (let r = 0; r < GRID_ROWS; r++) {
      if (inPath(c, r) || inWater(c, r)) continue;
      const roll = hash(c, r, 11);
      const edge = c === 0 || r === 0 || c === GRID_COLS - 1 || r === GRID_ROWS - 1;
      const chance = edge ? 0.7 : 0.32;
      if (roll > chance) continue;
      const cx = c * cell + cell * (0.2 + hash(c, r, 12) * 0.6);
      const cy = r * cell + cell * (0.2 + hash(c, r, 13) * 0.6);
      const kind = hash(c, r, 14);
      prop(ctx, cx, cy, cell, decor, accent, kind, hash(c, r, 15));
    }
  }
}

// One signature prop for the given scenery. Kept simple + colorful so each stage
// reads distinctly at a glance without a huge art budget.
function prop(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cell: number,
  decor: Scenery["decor"],
  accent: string,
  kind: number,
  v: number,
) {
  switch (decor) {
    case "desert":
      return kind < 0.6 ? cactus(ctx, x, y, cell) : rock(ctx, x, y, cell, "#b98a4f");
    case "beach":
      return kind < 0.55 ? palm(ctx, x, y, cell) : rock(ctx, x, y, cell, "#c9b381");
    case "savanna":
      return kind < 0.55 ? acacia(ctx, x, y, cell) : bush(ctx, x, y, cell, accent, "#7c8a3a");
    case "stadium":
      return kind < 0.5 ? banner(ctx, x, y, cell, accent) : bush(ctx, x, y, cell, accent, "#2f7a30");
    case "river":
      return kind < 0.45 ? tree(ctx, x, y, cell, v > 0.5) : reed(ctx, x, y, cell);
    case "ice":
      return kind < 0.5 ? snowPine(ctx, x, y, cell) : rock(ctx, x, y, cell, "#cfe0ee");
    case "canyon":
      return mesa(ctx, x, y, cell);
    case "tropical":
      return kind < 0.6 ? palm(ctx, x, y, cell) : bush(ctx, x, y, cell, accent, "#1f6f3a");
    case "volcano":
      return kind < 0.5 ? lavaRock(ctx, x, y, cell) : rock(ctx, x, y, cell, "#4a2418");
    default:
      if (kind < 0.5) return tree(ctx, x, y, cell, v > 0.5);
      if (kind < 0.72) return rock(ctx, x, y, cell, "#7b8087");
      if (kind < 0.88) return bush(ctx, x, y, cell, accent, "#2f6a2c");
      return mud(ctx, x, y, cell);
  }
}

function tree(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number, pine: boolean) {
  const s = cell * (0.16 + 0.05);
  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(x, y + s * 0.9, s * 0.9, s * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
  // trunk
  ctx.fillStyle = "#5b3d22";
  ctx.fillRect(x - s * 0.12, y, s * 0.24, s * 0.9);
  if (pine) {
    for (let i = 0; i < 3; i++) {
      const yy = y - s * (0.1 + i * 0.5);
      const ww = s * (1.05 - i * 0.28);
      ctx.beginPath();
      ctx.moveTo(x, yy - s * 0.7);
      ctx.lineTo(x - ww, yy);
      ctx.lineTo(x + ww, yy);
      ctx.closePath();
      ctx.fillStyle = i === 0 ? "#2e5a2b" : "#357a34";
      ctx.fill();
    }
  } else {
    const g = ctx.createRadialGradient(x - s * 0.3, y - s * 0.9, s * 0.1, x, y - s * 0.6, s);
    g.addColorStop(0, "#5fae4a");
    g.addColorStop(1, "#2f6a2c");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y - s * 0.6, s * 0.95, 0, Math.PI * 2);
    ctx.fill();
  }
}

function rock(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number, color = "#7b8087") {
  const s = cell * 0.2;
  const g = ctx.createLinearGradient(x - s, y - s, x + s, y + s);
  g.addColorStop(0, shade(color, 0.28));
  g.addColorStop(1, shade(color, -0.35));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x - s, y + s * 0.5);
  ctx.lineTo(x - s * 0.5, y - s * 0.6);
  ctx.lineTo(x + s * 0.4, y - s * 0.5);
  ctx.lineTo(x + s, y + s * 0.4);
  ctx.closePath();
  ctx.fill();
}

function bush(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cell: number,
  accent: string,
  leaf = "#2f6a2c",
) {
  const s = cell * 0.16;
  ctx.fillStyle = leaf;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.arc(x + i * s * 0.7, y, s * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
  // a couple of themed flowers
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(x - s * 0.4, y - s * 0.3, s * 0.16, 0, Math.PI * 2);
  ctx.arc(x + s * 0.5, y, s * 0.16, 0, Math.PI * 2);
  ctx.fill();
}

// ---- per-scenery signature props -----------------------------------------
function cactus(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number) {
  const s = cell * 0.22;
  ctx.strokeStyle = "#2f7a3a";
  ctx.lineWidth = s * 0.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.7);
  ctx.lineTo(x, y - s);
  ctx.moveTo(x, y);
  ctx.lineTo(x - s * 0.6, y);
  ctx.lineTo(x - s * 0.6, y - s * 0.5);
  ctx.moveTo(x, y - s * 0.3);
  ctx.lineTo(x + s * 0.6, y - s * 0.3);
  ctx.lineTo(x + s * 0.6, y - s * 0.8);
  ctx.stroke();
}

function palm(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number) {
  const s = cell * 0.22;
  ctx.strokeStyle = "#8a5a2b";
  ctx.lineWidth = s * 0.28;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.8);
  ctx.quadraticCurveTo(x + s * 0.2, y - s * 0.2, x - s * 0.1, y - s);
  ctx.stroke();
  ctx.strokeStyle = "#2f9a46";
  ctx.lineWidth = s * 0.16;
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + (k - 2) * 0.6;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.1, y - s);
    ctx.quadraticCurveTo(x - s * 0.1 + Math.cos(a) * s * 0.7, y - s + Math.sin(a) * s * 0.7, x - s * 0.1 + Math.cos(a) * s * 1.2, y - s * 0.75 + Math.sin(a) * s * 1.2);
    ctx.stroke();
  }
}

function acacia(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number) {
  const s = cell * 0.2;
  ctx.strokeStyle = "#6b4a2a";
  ctx.lineWidth = s * 0.22;
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.8);
  ctx.lineTo(x, y - s * 0.3);
  ctx.stroke();
  ctx.fillStyle = "#5c7a34";
  ctx.beginPath();
  ctx.ellipse(x, y - s * 0.5, s * 1.1, s * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
}

function reed(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number) {
  const s = cell * 0.2;
  ctx.strokeStyle = "#4e8a3a";
  ctx.lineWidth = s * 0.14;
  ctx.lineCap = "round";
  for (let k = -1; k <= 1; k++) {
    ctx.beginPath();
    ctx.moveTo(x + k * s * 0.35, y + s * 0.6);
    ctx.quadraticCurveTo(x + k * s * 0.35 + k * s * 0.2, y - s * 0.2, x + k * s * 0.5, y - s * 0.8);
    ctx.stroke();
  }
}

function snowPine(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number) {
  const s = cell * 0.21;
  ctx.fillStyle = "#5b3d22";
  ctx.fillRect(x - s * 0.1, y, s * 0.2, s * 0.7);
  for (let i = 0; i < 3; i++) {
    const yy = y - s * (0.1 + i * 0.5);
    const ww = s * (1.05 - i * 0.28);
    ctx.beginPath();
    ctx.moveTo(x, yy - s * 0.7);
    ctx.lineTo(x - ww, yy);
    ctx.lineTo(x + ww, yy);
    ctx.closePath();
    ctx.fillStyle = i === 0 ? "#2e5a3b" : "#357a4a";
    ctx.fill();
    // snow cap
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.moveTo(x, yy - s * 0.7);
    ctx.lineTo(x - ww * 0.5, yy - s * 0.35);
    ctx.lineTo(x + ww * 0.5, yy - s * 0.35);
    ctx.closePath();
    ctx.fill();
  }
}

function mesa(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number) {
  const s = cell * 0.24;
  const layers = ["#c47a4a", "#a85a34", "#8a4526"];
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = layers[i];
    const wy = y + s * 0.6 - i * s * 0.5;
    const ww = s * (1 - i * 0.18);
    ctx.fillRect(x - ww, wy - s * 0.5, ww * 2, s * 0.55);
  }
}

function lavaRock(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number) {
  const s = cell * 0.2;
  rock(ctx, x, y, cell, "#3a1f15");
  // glowing cracks
  ctx.strokeStyle = "rgba(255,120,20,0.9)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.4, y - s * 0.3);
  ctx.lineTo(x, y);
  ctx.lineTo(x + s * 0.3, y + s * 0.3);
  ctx.stroke();
}

function banner(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number, accent: string) {
  const s = cell * 0.22;
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = Math.max(1.2, s * 0.12);
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.7);
  ctx.lineTo(x, y - s);
  ctx.stroke();
  ctx.fillStyle = accent === "#ffffff" ? "#ef4444" : accent;
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.lineTo(x + s * 0.9, y - s * 0.7);
  ctx.lineTo(x, y - s * 0.4);
  ctx.closePath();
  ctx.fill();
}

function mud(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number) {
  ctx.fillStyle = "rgba(60,44,26,0.7)";
  ctx.beginPath();
  ctx.ellipse(x, y, cell * 0.22, cell * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(90,68,40,0.5)";
  ctx.beginPath();
  ctx.ellipse(x + cell * 0.04, y - cell * 0.02, cell * 0.1, cell * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ---- ambient, animated stage props ---------------------------------------
// A light "alive" layer per stage theme: snow, flapping birds, rising embers, a
// plodding camel, water glints. All positions are derived from `time`, so nothing
// needs persistent state - it just animates over the arena.
type Ctx2D = CanvasRenderingContext2D;
function frnd(i: number, k: number): number {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}
function ambSnow(ctx: Ctx2D, w: number, h: number, cell: number, time: number) {
  for (let i = 0; i < 80; i++) {
    const sp = cell * (0.5 + frnd(i, 1) * 0.7);
    const x = (frnd(i, 2) * w + Math.sin(time * 0.7 + i) * cell * 0.4 + w) % w;
    const y = (frnd(i, 3) * h + time * sp) % (h + 10);
    ctx.fillStyle = `rgba(255,255,255,${0.5 + frnd(i, 5) * 0.4})`;
    ctx.beginPath();
    ctx.arc(x, y, cell * (0.03 + frnd(i, 4) * 0.035), 0, Math.PI * 2);
    ctx.fill();
  }
}
function ambBirds(ctx: Ctx2D, w: number, h: number, cell: number, time: number, count: number) {
  ctx.strokeStyle = "rgba(35,35,48,0.55)";
  ctx.lineWidth = Math.max(1.4, cell * 0.045);
  ctx.lineCap = "round";
  for (let k = 0; k < count; k++) {
    const sp = cell * (0.7 + frnd(k, 6) * 0.6);
    const dir = k % 2 === 0 ? 1 : -1;
    const span = w + cell * 6;
    let x = ((time * sp + frnd(k, 7) * span) % span) - cell * 3;
    if (dir < 0) x = w - x;
    const y = h * (0.1 + frnd(k, 8) * 0.32);
    const ws = cell * 0.34;
    const up = Math.sin(time * 9 + k * 2) * ws * 0.45;
    ctx.beginPath();
    ctx.moveTo(x - ws, y + up);
    ctx.quadraticCurveTo(x - ws * 0.2, y - up * 0.4, x, y);
    ctx.quadraticCurveTo(x + ws * 0.2, y - up * 0.4, x + ws, y + up);
    ctx.stroke();
  }
}
function ambEmbers(ctx: Ctx2D, w: number, h: number, cell: number, time: number) {
  for (let i = 0; i < 48; i++) {
    const life = (frnd(i, 9) + time * (0.18 + frnd(i, 10) * 0.15)) % 1;
    const x = (frnd(i, 11) * w + Math.sin(time * 1.3 + i) * cell * 0.5 + w) % w;
    const y = h - life * h * 0.95;
    const g = Math.round(190 - life * 160);
    ctx.fillStyle = `rgba(255,${g},40,${(1 - life) * 0.85})`;
    ctx.beginPath();
    ctx.arc(x, y, cell * 0.05 * (1 - life * 0.6) + 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
}
function ambCamel(ctx: Ctx2D, w: number, h: number, cell: number, time: number) {
  const span = w + cell * 8;
  const s = cell * 0.9;
  ctx.save();
  ctx.translate(((time * cell * 0.6) % span) - cell * 4, h * 0.8);
  ctx.fillStyle = "rgba(120,82,45,0.85)";
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.35, s * 0.5, s * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-s * 0.12, -s * 0.58, s * 0.17, Math.PI, 0);
  ctx.arc(s * 0.2, -s * 0.58, s * 0.15, Math.PI, 0);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(s * 0.42, -s * 0.45);
  ctx.lineTo(s * 0.62, -s * 0.9);
  ctx.lineTo(s * 0.78, -s * 0.85);
  ctx.lineTo(s * 0.6, -s * 0.4);
  ctx.fill();
  ctx.strokeStyle = "rgba(120,82,45,0.85)";
  ctx.lineWidth = Math.max(2, s * 0.08);
  for (let l = 0; l < 4; l++) {
    const lx = -s * 0.32 + l * s * 0.22;
    ctx.beginPath();
    ctx.moveTo(lx, -s * 0.15);
    ctx.lineTo(lx + Math.sin(time * 6 + l * 1.6) * s * 0.1, s * 0.12);
    ctx.stroke();
  }
  ctx.restore();
}
function ambSparkle(ctx: Ctx2D, w: number, h: number, cell: number, time: number) {
  for (let i = 0; i < 40; i++) {
    const tw = 0.5 + 0.5 * Math.sin(time * 3 + i * 1.7);
    ctx.fillStyle = `rgba(255,255,255,${tw * 0.5})`;
    ctx.fillRect(frnd(i, 12) * w, h * (0.82 + frnd(i, 13) * 0.16), cell * 0.14, 1.5);
  }
}
function drawAmbient(ctx: Ctx2D, w: number, h: number, cell: number, decor: Scenery["decor"], time: number) {
  switch (decor) {
    case "ice":
      ambSnow(ctx, w, h, cell, time);
      break;
    case "volcano":
      ambEmbers(ctx, w, h, cell, time);
      ambBirds(ctx, w, h, cell, time, 1);
      break;
    case "beach":
      ambSparkle(ctx, w, h, cell, time);
      ambBirds(ctx, w, h, cell, time, 3);
      break;
    case "river":
    case "tropical":
      ambSparkle(ctx, w, h, cell, time);
      ambBirds(ctx, w, h, cell, time, 2);
      break;
    case "forest":
    case "stadium":
      ambBirds(ctx, w, h, cell, time, 2);
      break;
    case "savanna":
      ambBirds(ctx, w, h, cell, time, 2);
      ambCamel(ctx, w, h, cell, time);
      break;
    case "desert":
    case "canyon":
      ambCamel(ctx, w, h, cell, time);
      ambBirds(ctx, w, h, cell, time, 1);
      break;
  }
}

export function draw(ctx: CanvasRenderingContext2D, cell: number, s: DrawState) {
  const w = cell * GRID_COLS;
  const h = cell * GRID_ROWS;
  ctx.clearRect(0, 0, w, h);
  const st: StageDraw = {
    stageId: s.stageId ?? 1,
    scenery: s.scenery ?? FOREST,
    waypoints: s.waypoints ?? WAYPOINTS,
    pathSet: s.pathSet ?? PATH,
    noBuild: s.noBuild ?? EMPTY_SET,
  };
  ctx.drawImage(background(cell, s.code, s.palette, st), 0, 0);

  // keyboard build cursor (only shown during keyboard play)
  if (s.cursor) {
    const x = s.cursor.x * cell;
    const y = s.cursor.y * cell;
    ctx.strokeStyle = "rgba(132,204,22,0.95)";
    ctx.lineWidth = 2.5;
    roundRect(ctx, x + 3, y + 3, cell - 6, cell - 6, cell * 0.12);
    ctx.stroke();
  }

  // towers (the roamer draws at its live drifting position, not a fixed cell)
  for (const t of s.towers) {
    const p = toPx(t.pos ?? t.cell, cell);
    if (t.id === s.selectedId) {
      const stats = towerStats(t.type, t.level);
      const def = TOWER_DEFS[t.type];
      ctx.beginPath();
      ctx.arc(p.x, p.y, stats.range * cell, 0, Math.PI * 2);
      ctx.fillStyle = hexA(def.color, 0.08);
      ctx.fill();
      ctx.strokeStyle = hexA(def.color, 0.5);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    drawTower(ctx, p, cell, t, s.code, s.time);
  }

  // build preview: highlight the tapped tile, its reach, and a ghost turret
  if (s.preview) {
    const p = toPx(s.preview.cell, cell);
    const def = TOWER_DEFS[s.preview.type];
    const stats = towerStats(s.preview.type, 1);
    ctx.beginPath();
    ctx.arc(p.x, p.y, stats.range * cell, 0, Math.PI * 2);
    ctx.fillStyle = hexA(def.color, 0.1);
    ctx.fill();
    ctx.setLineDash([7, 6]);
    ctx.strokeStyle = hexA(def.color, 0.8);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
    roundRect(ctx, s.preview.cell.x * cell + 3, s.preview.cell.y * cell + 3, cell - 6, cell - 6, cell * 0.12);
    ctx.strokeStyle = hexA(def.color, 0.9);
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.globalAlpha = 0.6;
    drawTower(
      ctx,
      p,
      cell,
      { id: -1, type: s.preview.type, cell: s.preview.cell, level: 1, cooldown: 0 },
      s.code,
      s.time,
    );
    ctx.globalAlpha = 1;
  }

  // projectiles - each weapon has its own look so a volley never reads as "all lasers"
  for (const pr of s.projectiles) {
    const a = toPx(pr.from, cell);
    const b = toPx(pr.to, cell);
    ctx.globalAlpha = Math.min(1, pr.ttl * 6);
    ctx.lineCap = "round";
    drawShot(ctx, cell, pr, a, b);
    ctx.globalAlpha = 1;
  }

  // home base: a spinning flag sphere floating above a cool themed pedestal.
  // As it loses lives it reddens, then smokes, then catches fire.
  drawBase(ctx, toPx(s.baseCell ?? BASE_CELL, cell), cell, s.palette, s.time, 1 - s.lives / s.maxLives, s.shield ?? false);

  // enemies
  for (const e of s.enemies) {
    if (e.dist < 0) continue; // still queued off-screen
    const p = toPx(e.pos, cell);
    const r = cell * 0.34;
    // green slime sheen while the slow is active (lingers ~5s for slime)
    if (e.slowMul < 1 && s.gameTime < (e.slowUntil ?? 0)) {
      ctx.fillStyle = "rgba(132,204,22,0.28)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, cell * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
    drawMarble(ctx, p, r, e.code);

    // frost: encase the enemy in ice while frozen (1s)
    if (s.gameTime < (e.frozenUntil ?? 0)) drawFreeze(ctx, p.x, p.y, r);
    // tesla: crackling electric arc over the enemy right after a hit
    if (s.gameTime < (e.shockUntil ?? 0)) drawShock(ctx, p.x, p.y, r, e.id, s.time);

    // health bar: small, faint, and only when the enemy is actually hurt
    if (e.hp < e.maxHp) {
      const bw = cell * 0.5;
      const frac = Math.max(0, e.hp / e.maxHp);
      const y = p.y - cell * 0.5;
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(p.x - bw / 2, y, bw, 2.5);
      ctx.fillStyle = frac > 0.5 ? "#34d399" : frac > 0.25 ? "#fbbf24" : "#f87171";
      ctx.fillRect(p.x - bw / 2, y, bw * frac, 2.5);
      ctx.globalAlpha = 1;
    }
  }

  // smoke + sparks on top of everything
  drawParticles(ctx, cell, s.particles);

  // ambient, animated stage props (snow / birds / embers / camel / water glints)
  drawAmbient(ctx, w, h, cell, st.scenery.decor, s.time);

  // nuke targeting reticle: a red blast-radius ring + crosshair over the target
  if (s.nuke) drawNukeReticle(ctx, cell, s.nuke, s.time);
  // nuke strike: a warhead dropping in, then a mushroom cloud
  if (s.nukeBlast) drawNukeBlast(ctx, cell, s.nukeBlast, s.time);
}

// The nuke's own assets: a warhead "bullet" streaks down from the sky onto the
// target (age 0-0.35s), then a full mushroom cloud blooms and fades (0.35-1.7s):
// a white-hot core, an expanding shockwave ring, a rising stem and a billowing cap.
function drawNukeBlast(
  ctx: CanvasRenderingContext2D,
  cell: number,
  bl: { x: number; y: number; born: number },
  time: number,
) {
  const cx = (bl.x + 0.5) * cell;
  const gy = (bl.y + 0.5) * cell; // ground zero
  const age = time - bl.born;

  // ---- incoming warhead (the "bullet"), riding the beam down from the sky ----
  if (age < 0.35) {
    const t = age / 0.35;
    const y = -cell + t * (gy + cell); // falls from above the top edge to ground zero
    const L = cell * 0.5;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    // fiery exhaust trail above the warhead
    const tg = ctx.createLinearGradient(cx, y - L * 2.4, cx, y);
    tg.addColorStop(0, "rgba(255,180,40,0)");
    tg.addColorStop(1, "rgba(255,220,120,0.9)");
    ctx.strokeStyle = tg;
    ctx.lineWidth = cell * 0.16;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx, y - L * 2.4);
    ctx.lineTo(cx, y - L * 0.7);
    ctx.stroke();
    ctx.restore();
    // warhead body: dark casing, red nose, tail fins
    ctx.fillStyle = "#e2e8f0";
    ctx.beginPath();
    ctx.moveTo(cx, y); // nose
    ctx.lineTo(cx - L * 0.28, y - L * 0.55);
    ctx.lineTo(cx - L * 0.28, y - L * 1.3);
    ctx.lineTo(cx + L * 0.28, y - L * 1.3);
    ctx.lineTo(cx + L * 0.28, y - L * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ef4444"; // red nose cone
    ctx.beginPath();
    ctx.moveTo(cx, y);
    ctx.lineTo(cx - L * 0.28, y - L * 0.55);
    ctx.lineTo(cx + L * 0.28, y - L * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#334155"; // tail fins
    ctx.beginPath();
    ctx.moveTo(cx - L * 0.28, y - L * 1.05);
    ctx.lineTo(cx - L * 0.5, y - L * 1.35);
    ctx.lineTo(cx - L * 0.28, y - L * 1.35);
    ctx.moveTo(cx + L * 0.28, y - L * 1.05);
    ctx.lineTo(cx + L * 0.5, y - L * 1.35);
    ctx.lineTo(cx + L * 0.28, y - L * 1.35);
    ctx.fill();
    return;
  }

  // ---- mushroom cloud ----
  const a = Math.min(1, (age - 0.35) / 1.35); // 0..1 over the cloud's life
  const fade = a < 0.75 ? 1 : 1 - (a - 0.75) / 0.25; // hold, then fade out
  const R = cell * 2.6; // blast reach
  ctx.save();

  // expanding shockwave ring on the ground
  const ringR = R * (0.3 + a * 1.05);
  ctx.strokeStyle = `rgba(255,210,120,${0.5 * fade * (1 - a)})`;
  ctx.lineWidth = cell * 0.14 * (1 - a * 0.5);
  ctx.beginPath();
  ctx.ellipse(cx, gy, ringR, ringR * 0.4, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalCompositeOperation = "lighter";
  // white-hot ground flash early on
  if (a < 0.4) {
    const fl = ctx.createRadialGradient(cx, gy, 1, cx, gy, R * 0.9);
    fl.addColorStop(0, `rgba(255,255,240,${(1 - a / 0.4) * 0.9})`);
    fl.addColorStop(1, "rgba(255,180,60,0)");
    ctx.fillStyle = fl;
    ctx.beginPath();
    ctx.arc(cx, gy, R * 0.9, 0, Math.PI * 2);
    ctx.fill();
  }

  const rise = a * R * 1.3; // how high the cloud has climbed
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = fade;

  // rising stem
  const stemW = R * (0.24 + a * 0.1);
  const stemH = rise;
  const sg = ctx.createLinearGradient(cx, gy, cx, gy - stemH);
  sg.addColorStop(0, "rgba(120,90,70,0.9)");
  sg.addColorStop(1, "rgba(160,120,90,0.75)");
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.moveTo(cx - stemW * 0.5, gy);
  ctx.quadraticCurveTo(cx - stemW * 0.35, gy - stemH * 0.6, cx - stemW * 0.4, gy - stemH);
  ctx.lineTo(cx + stemW * 0.4, gy - stemH);
  ctx.quadraticCurveTo(cx + stemW * 0.35, gy - stemH * 0.6, cx + stemW * 0.5, gy);
  ctx.closePath();
  ctx.fill();

  // billowing cap: overlapping puffs, warm underglow
  const capY = gy - stemH;
  const capR = R * (0.5 + a * 0.7);
  const puffs = [
    [0, 0, 1],
    [-0.7, 0.15, 0.7],
    [0.7, 0.15, 0.7],
    [-0.35, -0.3, 0.6],
    [0.35, -0.3, 0.6],
  ];
  for (const [ox, oy, s2] of puffs) {
    const px = cx + ox * capR;
    const py = capY + oy * capR;
    const pr = capR * s2;
    const g = ctx.createRadialGradient(px, py + pr * 0.3, pr * 0.2, px, py, pr);
    g.addColorStop(0, "rgba(255,170,70,0.85)");
    g.addColorStop(0.5, "rgba(150,110,90,0.9)");
    g.addColorStop(1, "rgba(90,70,60,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// The nuke's target marker. While AIMING it's a menacing red reticle. Once the
// target is LOCKED and the countdown runs (`counting`), it becomes a fast-
// spinning, glowing summoning portal firing a huge vertical beam to the sky -
// the beacon the warhead rides down.
function drawNukeReticle(
  ctx: CanvasRenderingContext2D,
  cell: number,
  n: { x: number; y: number; radius: number; armed: boolean; counting: boolean },
  time: number,
) {
  const cx = (n.x + 0.5) * cell;
  const cy = (n.y + 0.5) * cell;
  const R = n.radius * cell;
  const pulse = 0.5 + 0.5 * Math.sin(time * 6);

  if (n.counting) {
    const p = 0.65 + 0.35 * Math.abs(Math.sin(time * 9)); // fast throb
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    // HUGE vertical beam from ground zero straight up to the sky
    const bw = cell * (0.4 + 0.3 * p);
    const beam = ctx.createLinearGradient(cx - bw, 0, cx + bw, 0);
    beam.addColorStop(0, "rgba(255,70,30,0)");
    beam.addColorStop(0.5, `rgba(255,130,60,${0.55 * p})`);
    beam.addColorStop(1, "rgba(255,70,30,0)");
    ctx.fillStyle = beam;
    ctx.fillRect(cx - bw, 0, bw * 2, cy);
    const cw = bw * 0.34; // white-hot core
    const core = ctx.createLinearGradient(cx - cw, 0, cx + cw, 0);
    core.addColorStop(0, "rgba(255,255,255,0)");
    core.addColorStop(0.5, `rgba(255,255,245,${0.85 * p})`);
    core.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = core;
    ctx.fillRect(cx - cw, 0, cw * 2, cy);
    // glowing disc at the base of the beam
    const disc = ctx.createRadialGradient(cx, cy, 1, cx, cy, R);
    disc.addColorStop(0, `rgba(255,170,70,${0.5 * p})`);
    disc.addColorStop(1, "rgba(255,90,20,0)");
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // fast-spinning summoning rings
    ctx.save();
    ctx.translate(cx, cy);
    for (let k = 0; k < 3; k++) {
      ctx.rotate(time * (7 - k * 1.5) + k);
      ctx.strokeStyle = `rgba(255,${110 + k * 45},60,${0.75 * p})`;
      ctx.lineWidth = cell * 0.09;
      ctx.setLineDash([cell * 0.55, cell * 0.3]);
      ctx.beginPath();
      ctx.arc(0, 0, R * (0.4 + k * 0.28), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
    return;
  }

  // ---- aiming reticle ----
  const g = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R);
  g.addColorStop(0, `rgba(239,68,68,${0.12 + pulse * 0.12})`);
  g.addColorStop(1, "rgba(239,68,68,0.02)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(n.armed ? time * 1.2 : -time * 2);
  ctx.setLineDash([14, 10]);
  ctx.strokeStyle = `rgba(248,113,113,${0.7 + pulse * 0.3})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 2;
  const ch = cell * 0.5;
  ctx.beginPath();
  ctx.moveTo(cx - ch, cy);
  ctx.lineTo(cx + ch, cy);
  ctx.moveTo(cx, cy - ch);
  ctx.lineTo(cx, cy + ch);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, cell * 0.22, 0, Math.PI * 2);
  ctx.stroke();
}

// Realistic fire: a warm glow + several swaying tongues, each filled with a
// vertical heat gradient (white-hot base -> yellow -> orange -> smoky red tip)
// and organic wobbling edges. `level` 2 is a bigger, wider blaze.
function drawFire(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  level: number,
  time: number,
  phase: number,
) {
  const big = level === 2;
  const baseH = r * (big ? 1.8 : 1.15);
  const baseW = r * (big ? 0.42 : 0.32);
  const tongues = big ? 3 : 2;

  // flickering warm glow
  const flickG = 0.85 + 0.15 * Math.sin(time * 10 + phase);
  const glow = ctx.createRadialGradient(cx, cy, 1, cx, cy, baseH * flickG);
  glow.addColorStop(0, `rgba(255,160,50,${big ? 0.5 : 0.32})`);
  glow.addColorStop(0.5, "rgba(255,90,10,0.18)");
  glow.addColorStop(1, "rgba(255,60,0,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy - baseH * 0.3, baseH * flickG, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalCompositeOperation = "lighter"; // flames add up where they overlap
  for (let k = 0; k < tongues; k++) {
    const mid = (tongues - 1) / 2;
    const fx = cx + (k - mid) * baseW * 1.15;
    const t = time * 12 + k * 2.3 + phase;
    const flick = 0.72 + 0.28 * Math.sin(t);
    const h = baseH * flick * (k === Math.round(mid) ? 1 : 0.78);
    const w = baseW * (0.85 + 0.25 * Math.sin(t * 0.8 + 1));
    // heat gradient up the flame
    const g = ctx.createLinearGradient(0, cy + h * 0.1, 0, cy - h);
    g.addColorStop(0, "rgba(255,245,220,0.95)"); // white-hot base
    g.addColorStop(0.22, "#fde047"); // yellow
    g.addColorStop(0.55, "#f97316"); // orange
    g.addColorStop(0.85, "#dc2626"); // red
    g.addColorStop(1, "rgba(120,20,10,0)"); // smoky, fading tip
    ctx.fillStyle = g;
    flameShape(ctx, fx, cy, w, h, t);
  }
  ctx.globalCompositeOperation = "source-over";
}

// One organic flame tongue with wobbling sides, swaying on `t`.
function flameShape(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  w: number,
  h: number,
  t: number,
) {
  const sway = Math.sin(t * 0.9) * w * 0.5; // the tip leans as it flickers
  const bulge = 0.55 + 0.15 * Math.sin(t * 1.3);
  const tipX = x + sway;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.55, baseY);
  ctx.bezierCurveTo(x - w * bulge, baseY - h * 0.45, tipX - w * 0.35, baseY - h * 0.75, tipX, baseY - h);
  ctx.bezierCurveTo(tipX + w * 0.35, baseY - h * 0.75, x + w * bulge, baseY - h * 0.45, x + w * 0.55, baseY);
  ctx.quadraticCurveTo(x, baseY + h * 0.14, x - w * 0.55, baseY);
  ctx.closePath();
  ctx.fill();
}

function drawParticles(ctx: CanvasRenderingContext2D, cell: number, list: Particle[]) {
  for (const p of list) {
    const x = (p.x + 0.5) * cell;
    const y = (p.y + 0.5) * cell;
    const t = p.life / p.ttl;
    if (p.kind === "smoke") {
      ctx.globalAlpha = (1 - t) * 0.5;
      const g = ctx.createRadialGradient(x, y, 1, x, y, p.size * cell);
      g.addColorStop(0, "rgba(90,90,95,0.9)");
      g.addColorStop(1, "rgba(60,60,65,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, p.size * cell, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, p.size * cell), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

// A glossy, tanky turret: shadow, country-colored armor base, a domed turret lit
// from the global sun, a barrel, a bright specular streak, and level pips.
export function drawTower(
  ctx: CanvasRenderingContext2D,
  p: Vec2,
  cell: number,
  t: Tower,
  code: string,
  time: number,
) {
  const def = TOWER_DEFS[t.type];
  // level 1 is small; each upgrade makes the tower visibly bigger and beefier
  // lvl1 .25, lvl2 .30, lvl3 .35, lvl4 .40, lvl5 .45 - a clear step every upgrade
  const R = cell * (0.2 + t.level * 0.05);
  // the plate is coloured by the UNIT itself (not the country flag), so a green
  // tower gets a green base, orange gets orange, the black tank gets black - and
  // the glossy radial body gives every colour the same black-gloss-on-black sheen
  const c1 = def.color;

  // ground shadow
  ctx.fillStyle = "rgba(0,0,0,0.38)";
  ctx.beginPath();
  ctx.ellipse(p.x, p.y + R * 0.72, R * 0.82, R * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();

  // only a fully maxed (level 5) tower earns the prestige glow in the nation's
  // colour (like the base) - a pulsing halo that marks it as end-game hardware
  if (t.level >= MAX_LEVEL) {
    const pulse = 0.5 + 0.18 * Math.sin(time * 3 + t.id);
    const aura = ctx.createRadialGradient(p.x, p.y, R * 0.6, p.x, p.y, R * 1.9);
    aura.addColorStop(0, hexA(c1, pulse));
    aura.addColorStop(1, hexA(c1, 0));
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(p.x, p.y, R * 1.9, 0, Math.PI * 2);
    ctx.fill();
  }

  // caterpillar tracks flanking the hull so the turret reads as a little tank -
  // two dark tread strips that poke out front and back, with rungs across them
  const trkW = R * 0.5;
  const trkH = R * 2.4;
  for (const side of [-1, 1] as const) {
    const tx = p.x + side * R * 0.92;
    const tg = ctx.createLinearGradient(tx - trkW / 2, 0, tx + trkW / 2, 0);
    tg.addColorStop(0, "#111318");
    tg.addColorStop(0.5, "#39414d");
    tg.addColorStop(1, "#111318");
    roundRect(ctx, tx - trkW / 2, p.y - trkH / 2, trkW, trkH, trkW * 0.42);
    ctx.fillStyle = tg;
    ctx.fill();
    ctx.lineWidth = Math.max(1, R * 0.05);
    ctx.strokeStyle = "#08090c";
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.5)"; // tread rungs
    ctx.lineWidth = Math.max(1, R * 0.07);
    for (let i = 1; i < 6; i++) {
      const yy = p.y - trkH / 2 + (trkH / 6) * i;
      ctx.beginPath();
      ctx.moveTo(tx - trkW * 0.42, yy);
      ctx.lineTo(tx + trkW * 0.42, yy);
      ctx.stroke();
    }
  }

  // armor MOUNTING PLATE: a rounded-square hull (not just a flat disc) in the
  // nation's colour, with a beveled rim, an inset panel and four corner bolts, so
  // the turret reads as mounted hardware
  const plate = R * 1.02; // half-size of the plate
  const rad = R * 0.42; // corner rounding
  const body = ctx.createRadialGradient(
    p.x + LIGHT.x * R, p.y + LIGHT.y * R, R * 0.1, p.x, p.y, R * 1.3,
  );
  body.addColorStop(0, shade(c1, 0.5));
  body.addColorStop(0.68, c1);
  body.addColorStop(1, shade(c1, -0.55));
  roundRect(ctx, p.x - plate, p.y - plate, plate * 2, plate * 2, rad);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = R * 0.1; // dark beveled rim
  ctx.strokeStyle = shade(c1, -0.55);
  ctx.stroke();
  roundRect(ctx, p.x - plate * 0.8, p.y - plate * 0.8, plate * 1.6, plate * 1.6, rad * 0.7);
  ctx.lineWidth = 1.5; // inset panel highlight
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.stroke();
  // four corner bolts
  const bolt = R * 0.13;
  const bp = plate * 0.72;
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const bx = p.x + sx * bp;
    const by = p.y + sy * bp;
    ctx.fillStyle = shade(c1, -0.5);
    ctx.beginPath();
    ctx.arc(bx, by, bolt, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shade(c1, 0.35); // little lit top on each bolt
    ctx.beginPath();
    ctx.arc(bx - bolt * 0.28, by - bolt * 0.28, bolt * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }

  // barrel: rotates to track the target; shots leave its muzzle
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(t.aim ?? -Math.PI / 5);
  const bg = ctx.createLinearGradient(0, -R * 0.17, 0, R * 0.17);
  bg.addColorStop(0, shade(def.color, 0.35));
  bg.addColorStop(0.5, shade(def.color, -0.1));
  bg.addColorStop(1, shade(def.color, -0.55));
  ctx.fillStyle = bg;
  roundRect(ctx, R * 0.1, -R * 0.15, R * 1.2, R * 0.3, R * 0.1);
  ctx.fill();
  ctx.fillStyle = shade(def.color, -0.35); // muzzle collar
  roundRect(ctx, R * 1.12, -R * 0.19, R * 0.2, R * 0.38, R * 0.05);
  ctx.fill();
  ctx.restore();

  // domed turret, lit from the sun. The Bomb Thrower gets a glossy BLACK dome
  // (like a black marble) - no bomb icon; its identity is the black gloss.
  const domeColor = t.type === "bomber" ? "#1b1e26" : def.color;
  const domeR = R * 0.66;
  const dome = ctx.createRadialGradient(
    p.x + LIGHT.x * domeR,
    p.y + LIGHT.y * domeR,
    domeR * 0.1,
    p.x,
    p.y,
    domeR,
  );
  dome.addColorStop(0, shade(domeColor, 0.55));
  dome.addColorStop(0.55, domeColor);
  dome.addColorStop(1, shade(domeColor, -0.5));
  ctx.beginPath();
  ctx.arc(p.x, p.y, domeR, 0, Math.PI * 2);
  ctx.fillStyle = dome;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = shade(domeColor, -0.4);
  ctx.stroke();

  // glossy specular streak (sun glint)
  ctx.save();
  ctx.beginPath();
  ctx.arc(p.x, p.y, domeR, 0, Math.PI * 2);
  ctx.clip();
  const glossY = p.y + LIGHT.y * domeR * 0.7;
  const glossX = p.x + LIGHT.x * domeR * 0.7;
  const gloss = ctx.createRadialGradient(glossX, glossY, 1, glossX, glossY, domeR * 0.9);
  gloss.addColorStop(0, "rgba(255,255,255,0.85)");
  gloss.addColorStop(0.4, "rgba(255,255,255,0.15)");
  gloss.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gloss;
  ctx.beginPath();
  ctx.ellipse(glossX, glossY, domeR * 0.55, domeR * 0.36, -Math.PI / 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // emblem so kids can tell the towers apart - the two that used emoji now get
  // real drawn vector icons; the rest are clean unicode symbols
  if (t.type === "bomber") {
    // no emblem - the glossy black dome is the look (a tiny cyan glint keeps it
    // from reading as a dead black circle)
    ctx.fillStyle = "rgba(120,180,255,0.35)";
    ctx.beginPath();
    ctx.arc(p.x + LIGHT.x * R * 0.3, p.y + LIGHT.y * R * 0.3, R * 0.08, 0, Math.PI * 2);
    ctx.fill();
  } else if (t.type === "slime") {
    drawSlimeEmblem(ctx, p.x, p.y, cell * 0.34);
  } else if (t.type === "sniper") {
    drawSniperEmblem(ctx, p.x, p.y, R * 1.0);
  } else if (t.type === "frost") {
    drawSnowflake(ctx, p.x, p.y, R * 1.0);
  } else if (t.type === "roamer") {
    drawSnowflake(ctx, p.x, p.y, R * 1.05, "#2563eb"); // blue flake reads on the white rover
  } else if (t.type === "tesla") {
    drawBolt(ctx, p.x, p.y, R * 1.05);
  } else if (t.type === "rapid") {
    drawStar(ctx, p.x, p.y, R * 1.0);
  } else if (t.type === "laser") {
    drawTargetDot(ctx, p.x, p.y, R * 0.95);
  } else {
    drawDot(ctx, p.x, p.y, R * 0.7); // cannon
  }

  // The tower earns a waving national flag from level 3 up, growing each level:
  // small at lvl3, medium at lvl4, biggest at lvl5. (Level is read off the star
  // pips in the upgrade panel, so no need to stamp it on the tower itself.)
  if (t.level >= 3) {
    const flagScale = t.level === 3 ? 0.72 : t.level === 4 ? 1 : 1.3;
    towerFlag(ctx, code, p.x - R * 0.1, p.y - R * 0.35, R, time, t.id, flagScale);
  }
}

// A clean glossy goo-ball icon, centered on the dome (no more lopsided teardrop).
function drawSlimeEmblem(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  const r = s * 0.5;
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.12, cx, cy, r);
  g.addColorStop(0, "#d9f99d");
  g.addColorStop(0.55, "#65a30d");
  g.addColorStop(1, "#1a2e05");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.05); // dark rim so it reads on the lime dome
  ctx.strokeStyle = "rgba(20,40,5,0.7)";
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.75)"; // glossy glint
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.3, cy - r * 0.32, r * 0.22, r * 0.14, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(217,249,157,0.85)"; // tiny bubbles
  ctx.beginPath();
  ctx.arc(cx + r * 0.34, cy + r * 0.22, r * 0.12, 0, Math.PI * 2);
  ctx.fill();
}

// A crisp crosshair/scope icon, drawn exactly on the dome centre (the "⌖" glyph
// rendered off-centre in the font, which is why the sniper looked misaligned).
function drawSniperEmblem(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  const r = s * 0.42;
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = Math.max(1.2, s * 0.07);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - r * 1.35, cy);
  ctx.lineTo(cx + r * 1.35, cy);
  ctx.moveTo(cx, cy - r * 1.35);
  ctx.lineTo(cx, cy + r * 1.35);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.16, 0, Math.PI * 2);
  ctx.fill();
}

// White vector emblems, drawn dead-centre on the dome (no emoji, no border), so
// every tower reads by a clean white glyph on its colour-coded glossy dome.
const WHITE = "rgba(255,255,255,0.95)";

function drawSnowflake(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  color: string = WHITE,
) {
  const r = s * 0.5;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.2, s * 0.08);
  ctx.lineCap = "round";
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + dx * r, cy + dy * r);
    ctx.stroke();
    // two little branches per spoke
    const px = -dy;
    const py = dx;
    for (const at of [0.5, 0.78]) {
      const bx = cx + dx * r * at;
      const by = cy + dy * r * at;
      const bl = r * 0.24;
      ctx.beginPath();
      ctx.moveTo(bx - px * bl - dx * bl * 0.6, by - py * bl - dy * bl * 0.6);
      ctx.lineTo(bx, by);
      ctx.lineTo(bx + px * bl - dx * bl * 0.6, by + py * bl - dy * bl * 0.6);
      ctx.stroke();
    }
  }
}

function drawBolt(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  const w = s * 0.5;
  const h = s * 0.62;
  ctx.fillStyle = WHITE;
  ctx.beginPath();
  ctx.moveTo(cx + w * 0.18, cy - h * 0.5);
  ctx.lineTo(cx - w * 0.5, cy + h * 0.1);
  ctx.lineTo(cx - w * 0.06, cy + h * 0.1);
  ctx.lineTo(cx - w * 0.22, cy + h * 0.5);
  ctx.lineTo(cx + w * 0.5, cy - h * 0.12);
  ctx.lineTo(cx + w * 0.04, cy - h * 0.12);
  ctx.closePath();
  ctx.fill();
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  const R2 = s * 0.5;
  const r2 = s * 0.19;
  ctx.fillStyle = WHITE;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const rad = i % 2 === 0 ? R2 : r2;
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function drawTargetDot(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  const r = s * 0.42;
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = Math.max(1.2, s * 0.1);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = WHITE;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.34, 0, Math.PI * 2);
  ctx.fill();
}

function drawDot(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.fillStyle = WHITE;
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.42, 0, Math.PI * 2);
  ctx.fill();
}

// A realistic waving flag on a pole. The flag is sliced into VERTICAL columns
// and each column is shifted VERTICALLY along a travelling sine (amplitude grows
// toward the free end), so the top AND bottom edges ripple like cloth. Each
// column is then lit by the wave slope - crests catch light, troughs fall into
// shadow - which sells the 3D fold.
function towerFlag(
  ctx: CanvasRenderingContext2D,
  code: string,
  baseX: number,
  baseY: number,
  R: number,
  time: number,
  phase: number,
  scale = 1,
) {
  const poleTop = baseY - R * (1.2 + 0.4 * scale);
  // pole
  ctx.strokeStyle = "#d1d5db";
  ctx.lineWidth = Math.max(1.4, R * 0.05);
  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  ctx.lineTo(baseX, poleTop);
  ctx.stroke();
  ctx.fillStyle = "#fbbf24"; // gold finial
  ctx.beginPath();
  ctx.arc(baseX, poleTop, R * 0.055, 0, Math.PI * 2);
  ctx.fill();

  const img = getFlagImage(code);
  const w = R * 0.84 * scale; // grows with level: small (l3) -> biggest (l5)
  const h = R * 0.62 * scale;
  const fx = baseX + ctx.lineWidth * 0.5;
  const fy = poleTop + R * 0.02;
  if (!img) {
    ctx.fillStyle = "#94a3b8";
    ctx.fillRect(fx, fy, w, h);
    return;
  }
  // Draw the FULL flag into each vertical column via a clip, shifting the column
  // vertically for the ripple. Drawing the whole image (not a source sub-rect)
  // avoids the SVG sub-rectangle sampling bug that only showed the canton.
  const cols = 14;
  const dw = w / cols;
  const amp = h * 0.24;
  for (let i = 0; i < cols; i++) {
    const t2 = i / (cols - 1); // 0 at the pole, 1 at the free end
    const ph = time * 6 - i * 0.7 + phase;
    const yo = Math.sin(ph) * amp * t2; // vertical ripple, biggest at the free end
    const dx = fx + i * dw;
    ctx.save();
    ctx.beginPath();
    ctx.rect(dx, fy - amp * 1.6, dw + 1, h + amp * 3.2);
    ctx.clip();
    ctx.drawImage(img, fx, fy + yo, w, h); // whole flag, shifted, clipped to the column
    const sh = Math.cos(ph) * 0.18 * (0.4 + t2); // subtle fold light
    ctx.fillStyle = sh >= 0 ? `rgba(255,255,255,${sh})` : `rgba(0,0,0,${-sh})`;
    ctx.fillRect(dx, fy + yo, dw + 1, h);
    ctx.restore();
  }
}

// Ice casing for a frozen enemy: a pale blue wash plus a few white crystals.
function drawFreeze(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "rgba(191,219,254,0.5)";
  ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 1.5;
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(a) * r, cy - Math.sin(a) * r);
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(219,234,254,0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

// A jagged electric arc crackling over a shocked enemy (tesla).
// A real-looking electrocution: a crackling electric-blue aura plus several
// forked lightning arcs snaking ACROSS the sphere, drawn as a glowing blue
// underlay with a white-hot core, flickering fast.
function drawShock(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, seed: number, time: number) {
  // pulsing electric aura
  const pulse = 0.35 + 0.25 * Math.sin(time * 34 + seed * 5);
  const aura = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 1.55);
  aura.addColorStop(0, "rgba(191,219,254,0)");
  aura.addColorStop(0.6, `rgba(96,165,250,${pulse})`);
  aura.addColorStop(1, "rgba(59,130,246,0)");
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.55, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.shadowColor = "#7dd3fc";
  ctx.shadowBlur = 8;
  const arcs = 3;
  for (let b = 0; b < arcs; b++) {
    // an arc from one point on the rim, across, to another point
    const a0 = seed * 1.7 + b * 2.4 + Math.sin(time * 9 + b) * 0.5;
    const a1 = a0 + 2.1 + Math.sin(time * 11 + seed + b) * 0.9;
    const x0 = cx + Math.cos(a0) * r * 1.05;
    const y0 = cy + Math.sin(a0) * r * 1.05;
    const x1 = cx + Math.cos(a1) * r * 1.05;
    const y1 = cy + Math.sin(a1) * r * 1.05;
    // glow underlay (blue, thick) then hot core (white, thin)
    lightning(ctx, x0, y0, x1, y1, r * 0.55, seed * 3 + b, time, "rgba(96,165,250,0.9)", 2.6);
    lightning(ctx, x0, y0, x1, y1, r * 0.55, seed * 3 + b, time, "#ffffff", 1.2);
  }
  ctx.restore();
}

// A jagged lightning path between two points (midpoint displacement) with one
// forked branch, drawn in `color` at `width`.
function lightning(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number, x1: number, y1: number,
  amp: number, seed: number, time: number, color: string, width: number,
) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len; // perpendicular
  const segs = 7;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  const pts: [number, number][] = [[x0, y0]];
  for (let i = 1; i < segs; i++) {
    const t = i / segs;
    const taper = 1 - Math.abs(t - 0.5) * 2; // 0 at ends, 1 in the middle
    const off = Math.sin(seed * 3.1 + i * 2.7 + time * 45) * amp * taper;
    const px = x0 + dx * t + nx * off;
    const py = y0 + dy * t + ny * off;
    pts.push([px, py]);
    ctx.lineTo(px, py);
  }
  ctx.lineTo(x1, y1);
  ctx.stroke();
  // a short fork off the middle
  const [mx, my] = pts[Math.floor(segs / 2)];
  const fa = Math.atan2(dy, dx) + (Math.sin(seed * 9 + time * 20) > 0 ? 1 : -1) * 1.1;
  ctx.beginPath();
  ctx.moveTo(mx, my);
  ctx.lineTo(mx + Math.cos(fa) * amp * 0.8, my + Math.sin(fa) * amp * 0.8);
  ctx.stroke();
}

// Per-weapon projectile styles so a battle looks varied, not "all lasers".
function drawShot(
  ctx: CanvasRenderingContext2D,
  cell: number,
  pr: Projectile,
  a: Vec2,
  b: Vec2,
) {
  const color = TOWER_DEFS[pr.type].color;
  // shots grow with the firing tower's level (pr.scale): a lvl5 volley reads as
  // visibly heavier ordnance than a lvl1 one. Line widths scale a touch gentler.
  const s = cell * pr.scale;
  const lw = cell * (1 + (pr.scale - 1) * 0.7);
  switch (pr.type) {
    case "laser": {
      // fat glowing beam
      ctx.strokeStyle = "rgba(34,211,238,0.35)";
      ctx.lineWidth = lw * 0.16;
      line(ctx, a, b);
      ctx.strokeStyle = "#a5f3fc";
      ctx.lineWidth = lw * 0.06;
      line(ctx, a, b);
      break;
    }
    case "rapid": {
      // SMOKE: a puff drifts from the barrel to the target and chokes whoever it hits
      const prog = Math.min(1, Math.max(0, 1 - pr.ttl / 0.18));
      const px = a.x + (b.x - a.x) * prog;
      const py = a.y + (b.y - a.y) * prog;
      const puffR = s * (0.12 + prog * 0.18);
      const g = ctx.createRadialGradient(px, py, 1, px, py, puffR);
      g.addColorStop(0, "rgba(214,214,222,0.8)");
      g.addColorStop(1, "rgba(120,120,132,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, puffR, 0, Math.PI * 2);
      ctx.fill();
      const mp = Math.max(0, 1 - prog * 2); // little muzzle puff
      if (mp > 0) {
        ctx.fillStyle = `rgba(205,205,212,${mp * 0.5})`;
        ctx.beginPath();
        ctx.arc(a.x, a.y, s * 0.15, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "sniper": {
      // thin precise tracer + muzzle spark + hit flash
      ctx.strokeStyle = "rgba(167,139,250,0.9)";
      ctx.lineWidth = 1.5 * pr.scale;
      line(ctx, a, b);
      spark(ctx, a, s * 0.12, "#c4b5fd");
      spark(ctx, b, s * 0.14, "#ffffff");
      break;
    }
    case "cannon": {
      // a blazing FIREBALL that visibly flies OUT of the barrel: a muzzle flash at
      // the tank, then a molten fireball with a fiery trail streaking to the target
      const prog = Math.min(1, Math.max(0, 1 - pr.ttl / 0.18));
      const px = a.x + (b.x - a.x) * prog;
      const py = a.y + (b.y - a.y) * prog;
      const headR = s * 0.28;
      ctx.save();
      ctx.globalCompositeOperation = "lighter"; // fire adds up where it overlaps
      ctx.lineCap = "round";
      // MUZZLE FLASH: fire erupting from the barrel, brightest as the shot leaves
      const mf = Math.max(0, 1 - prog * 2.2);
      if (mf > 0) {
        const mg = ctx.createRadialGradient(a.x, a.y, 1, a.x, a.y, s * 0.55 * mf + 1);
        mg.addColorStop(0, `rgba(255,240,190,${mf})`);
        mg.addColorStop(0.5, `rgba(255,140,40,${mf * 0.7})`);
        mg.addColorStop(1, "rgba(255,80,0,0)");
        ctx.fillStyle = mg;
        ctx.beginPath();
        ctx.arc(a.x, a.y, s * 0.55 * mf + 1, 0, Math.PI * 2);
        ctx.fill();
      }
      // fiery trail from the muzzle to the flying fireball
      const tg = ctx.createLinearGradient(a.x, a.y, px, py);
      tg.addColorStop(0, "rgba(249,115,22,0)");
      tg.addColorStop(1, "rgba(255,215,120,0.9)");
      ctx.strokeStyle = tg;
      ctx.lineWidth = headR;
      line(ctx, a, { x: px, y: py });
      // orange glow halo around the fireball
      const glow = ctx.createRadialGradient(px, py, 1, px, py, headR * 2.3);
      glow.addColorStop(0, "rgba(255,150,40,0.75)");
      glow.addColorStop(1, "rgba(255,80,0,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(px, py, headR * 2.3, 0, Math.PI * 2);
      ctx.fill();
      // molten core: white-hot -> yellow -> orange -> red
      const core = ctx.createRadialGradient(px - headR * 0.25, py - headR * 0.25, 1, px, py, headR);
      core.addColorStop(0, "rgba(255,255,245,1)");
      core.addColorStop(0.35, "#fde047");
      core.addColorStop(0.7, "#f97316");
      core.addColorStop(1, "#dc2626");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(px, py, headR, 0, Math.PI * 2);
      ctx.fill();
      // IMPACT BURST on the enemy: a bright orange-red blast + flung embers so you
      // clearly see the fireball land
      if (prog > 0.76) {
        const ip = (prog - 0.76) / 0.24;
        const ir = s * (0.22 + ip * 0.5);
        const ig = ctx.createRadialGradient(b.x, b.y, 1, b.x, b.y, ir);
        ig.addColorStop(0, `rgba(255,240,190,${(1 - ip) * 0.95})`);
        ig.addColorStop(0.4, `rgba(255,110,30,${(1 - ip) * 0.85})`);
        ig.addColorStop(1, "rgba(220,40,10,0)");
        ctx.fillStyle = ig;
        ctx.beginPath();
        ctx.arc(b.x, b.y, ir, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255,170,60,${(1 - ip) * 0.9})`;
        for (let k = 0; k < 6; k++) {
          const ea = (k / 6) * Math.PI * 2 + pr.jitter * 4;
          const er = ip * s * 0.55;
          ctx.beginPath();
          ctx.arc(b.x + Math.cos(ea) * er, b.y + Math.sin(ea) * er, s * 0.05, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
      break;
    }
    case "roamer": // the Frost Rover fires the same frosty spray as the Water tower
    case "frost": {
      // WATER: a spurt of SEPARATE droplets flies from the barrel (not a beam),
      // then a splash of droplets bursts on the target
      const prog = Math.min(1, Math.max(0, 1 - pr.ttl / 0.18));
      // a string of 4 droplets trailing the lead one, each smaller, gently offset
      for (let k = 0; k < 4; k++) {
        const t2 = prog - k * 0.12;
        if (t2 < 0) continue;
        const dx = a.x + (b.x - a.x) * t2;
        const dy = a.y + (b.y - a.y) * t2 + Math.sin(k * 2 + pr.jitter * 6) * s * 0.06;
        const dr = s * (0.11 - k * 0.018);
        const g = ctx.createRadialGradient(dx - dr * 0.3, dy - dr * 0.3, 1, dx, dy, dr);
        g.addColorStop(0, "#e0f2fe");
        g.addColorStop(1, "#2563eb");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(dx, dy, dr, 0, Math.PI * 2);
        ctx.fill();
      }
      // splash on impact: a ring plus a few droplets flying off the target
      if (prog > 0.7) {
        const sp = (prog - 0.7) / 0.3;
        ctx.strokeStyle = `rgba(147,197,253,${(1 - sp) * 0.9})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(b.x, b.y, s * 0.1 + sp * s * 0.4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = `rgba(147,197,253,${(1 - sp) * 0.9})`;
        for (let k = 0; k < 5; k++) {
          const ang = (k / 5) * Math.PI * 2;
          const rr = sp * s * 0.4;
          ctx.beginPath();
          ctx.arc(b.x + Math.cos(ang) * rr, b.y + Math.sin(ang) * rr, s * 0.04, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case "tesla": {
      // jagged lightning bolt
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 * pr.scale;
      const mx = (a.x + b.x) / 2 + pr.jitter * cell;
      const my = (a.y + b.y) / 2 - pr.jitter * cell;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(mx, my);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      break;
    }
    case "bomber": {
      // a black bomb lobbed in an arc with a lit, sparking fuse (Ziggs-style)
      const prog = Math.min(1, Math.max(0, 1 - pr.ttl / 0.6)); // 0.6 = BOMB_LOB
      const x = a.x + (b.x - a.x) * prog;
      const y = a.y + (b.y - a.y) * prog - Math.sin(prog * Math.PI) * cell * 1.1;
      const br = cell * 0.17 * pr.scale;
      // bomb body (near-black sphere with a soft highlight)
      const bg = ctx.createRadialGradient(x - br * 0.35, y - br * 0.35, 1, x, y, br);
      bg.addColorStop(0, "#3b3f4a");
      bg.addColorStop(1, "#07080b");
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(x, y, br, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.beginPath();
      ctx.arc(x - br * 0.34, y - br * 0.34, br * 0.26, 0, Math.PI * 2);
      ctx.fill();
      // fuse stub
      const fx = x + br * 0.55, fy = y - br * 1.55;
      ctx.strokeStyle = "#6b7280";
      ctx.lineWidth = Math.max(1, br * 0.2);
      ctx.beginPath();
      ctx.moveTo(x, y - br);
      ctx.lineTo(fx, fy);
      ctx.stroke();
      // sparking flame at the fuse tip
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const sp = br * (0.55 + Math.abs(pr.jitter) * 1.2);
      const sg = ctx.createRadialGradient(fx, fy, 1, fx, fy, sp);
      sg.addColorStop(0, "rgba(255,255,220,1)");
      sg.addColorStop(0.5, "rgba(255,170,40,0.9)");
      sg.addColorStop(1, "rgba(255,120,0,0)");
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(fx, fy, sp, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      break;
    }
    case "slime": {
      // if the generated toxic-orb sprite has loaded, fly IT from the barrel to
      // the target; otherwise fall back to the drawn gooey glob
      const sprite = getSprite("/towers/fx/slime_shot.png");
      const prog = Math.min(1, Math.max(0, 1 - pr.ttl / 0.18));
      const px = a.x + (b.x - a.x) * prog;
      const py = a.y + (b.y - a.y) * prog;
      if (sprite) {
        // match the cannon fireball's size (s*0.28 radius) so shots read consistently;
        // s already carries pr.scale, so it grows +15%/level like every other shot
        const sz = s * 0.3;
        ctx.strokeStyle = "rgba(132,204,22,0.35)"; // faint goo trail
        ctx.lineWidth = lw * 0.1;
        line(ctx, a, { x: px, y: py });
        ctx.drawImage(sprite, px - sz, py - sz, sz * 2, sz * 2);
        break;
      }
      ctx.strokeStyle = "rgba(132,204,22,0.5)";
      ctx.lineWidth = lw * 0.14;
      line(ctx, a, b);
      const g = ctx.createRadialGradient(b.x - s * 0.05, b.y - s * 0.05, 1, b.x, b.y, s * 0.2);
      g.addColorStop(0, "#bef264");
      g.addColorStop(1, "#4d7c0f");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, s * 0.18, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
}

function line(ctx: CanvasRenderingContext2D, a: Vec2, b: Vec2) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}
function spark(ctx: CanvasRenderingContext2D, p: Vec2, r: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
}

function strokePath(ctx: CanvasRenderingContext2D, cell: number, waypoints: Vec2[]) {
  ctx.beginPath();
  waypoints.forEach((wp, i) => {
    const p = toPx(wp, cell);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// glossy flag marble (enemies): clipped flag + spherical shading + specular
// glint, lit from the global sun. No white border - a soft dark rim just gives
// it definition against the terrain.
function drawMarble(ctx: CanvasRenderingContext2D, p: Vec2, r: number, code: string) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.clip();
  paintFlag(ctx, getFlagImage(code), p.x, p.y, r, 0);
  sphereShade(ctx, p.x, p.y, r);
  ctx.restore();

  // no rim border - just the glossy specular glint
  specular(ctx, p.x, p.y, r);
}

// Draws the flag (optionally scrolled horizontally by `spin` px for a globe-like
// rotation), tiled so the wrap seam is never visible. Caller sets the clip.
function paintFlag(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | undefined,
  cx: number,
  cy: number,
  r: number,
  spin: number,
) {
  if (!img) {
    ctx.fillStyle = "#475569";
    ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    return;
  }
  const nw = img.naturalWidth || 640;
  const nh = img.naturalHeight || 480;
  const scale = Math.max((2 * r) / nw, (2 * r) / nh);
  const iw = nw * scale;
  const ih = nh * scale;
  const ox = spin ? ((spin % iw) + iw) % iw : 0;
  for (let k = -1; k <= 1; k++) {
    ctx.drawImage(img, cx - iw / 2 - ox + k * iw, cy - ih / 2, iw, ih);
  }
}

function sphereShade(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const g = ctx.createRadialGradient(cx + LIGHT.x * r, cy + LIGHT.y * r, r * 0.1, cx, cy, r);
  g.addColorStop(0, "rgba(255,255,255,0.22)");
  g.addColorStop(0.55, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.6)");
  ctx.fillStyle = g;
  ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
}

// Shattered look for a dead base sphere: jagged branching cracks + char marks.
// Deterministic (sin-based jitter) so it does not shimmer frame to frame.
function specular(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  ctx.ellipse(cx + LIGHT.x * r * 0.75, cy + LIGHT.y * r * 0.75, r * 0.26, r * 0.17, -Math.PI / 5, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fill();
}

// Home base: a slowly spinning flag sphere that bobs above a cool, elongated
// themed pedestal with a glowing hover pad. No white border anywhere.
function drawBase(
  ctx: CanvasRenderingContext2D,
  center: Vec2,
  cell: number,
  palette: string[],
  time: number,
  hurt: number, // fraction of lives lost, 0 (pristine) .. 1 (dead)
  shield: boolean, // shield up -> hide the health bar (the bubble shows instead)
) {
  const accent = palette[0] ?? "#38bdf8";
  const r = cell * 0.4;
  const bob = Math.sin(time * 1.6) * cell * 0.07;
  const cx = center.x;
  const cy = center.y - cell * 0.12 - bob; // sphere floats in the upper part of the tile
  const padY = center.y + cell * 0.62; // pedestal base sits low / just below the tile

  // --- futuristic hover pad ---
  const padRx = cell * 0.52;
  const padRy = cell * 0.19;
  // ground energy glow
  const glow = ctx.createRadialGradient(cx, padY, 1, cx, padY, cell * 0.95);
  glow.addColorStop(0, hexA(accent, 0.5));
  glow.addColorStop(1, hexA(accent, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.ellipse(cx, padY, cell * 0.85, cell * 0.36, 0, 0, Math.PI * 2);
  ctx.fill();

  // pulsing concentric energy rings expanding across the pad
  for (let k = 0; k < 2; k++) {
    const tk = (time * 0.55 + k * 0.5) % 1;
    ctx.globalAlpha = (1 - tk) * 0.5;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, padY, padRx * (0.4 + tk * 0.9), padRy * (0.4 + tk * 0.9), 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // dark tech platform disc
  const pg = ctx.createLinearGradient(0, padY - padRy, 0, padY + padRy);
  pg.addColorStop(0, "#333c4a");
  pg.addColorStop(1, "#0b0e14");
  ctx.fillStyle = pg;
  ctx.beginPath();
  ctx.ellipse(cx, padY, padRx, padRy, 0, 0, Math.PI * 2);
  ctx.fill();

  // glowing neon rim
  ctx.save();
  ctx.shadowColor = accent;
  ctx.shadowBlur = 10;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.ellipse(cx, padY, padRx * 0.9, padRy * 0.9, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // tech notches around the rim
  ctx.strokeStyle = hexA(accent, 0.7);
  ctx.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(cx + c * padRx * 0.9, padY + s * padRy * 0.9);
    ctx.lineTo(cx + c * padRx * 1.02, padY + s * padRy * 1.02);
    ctx.stroke();
  }

  // holographic lift beam with rising scanlines
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - padRx * 0.55, padY);
  ctx.lineTo(cx - r * 0.6, cy);
  ctx.lineTo(cx + r * 0.6, cy);
  ctx.lineTo(cx + padRx * 0.55, padY);
  ctx.closePath();
  ctx.clip();
  const beam = ctx.createLinearGradient(0, padY, 0, cy - r);
  beam.addColorStop(0, hexA(accent, 0.4));
  beam.addColorStop(1, hexA(accent, 0));
  ctx.fillStyle = beam;
  ctx.fillRect(cx - padRx, cy - r, padRx * 2, padY - (cy - r));
  ctx.strokeStyle = hexA(accent, 0.3);
  ctx.lineWidth = 1;
  const scan = (time * 22) % 7;
  for (let y = cy - r; y < padY; y += 7) {
    ctx.beginPath();
    ctx.moveTo(cx - padRx, y + scan);
    ctx.lineTo(cx + padRx, y + scan);
    ctx.stroke();
  }
  ctx.restore();

  // bright energy core on the pad
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.ellipse(cx, padY, padRx * 0.16, padRy * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();

  // --- glow behind the real 3D marble (rendered as a WebGL overlay in React) ---
  // themed normally, glows red once the base is hurt (brighter as it nears death)
  const red = Math.min(1, hurt * 1.3);
  const haloColor = red > 0 ? "#ef4444" : accent;
  const haloR = r * (1.5 + red * 0.5);
  const pulse = 0.45 + (red > 0 ? 0.25 * Math.sin(time * 6) : 0);
  const halo = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, haloR);
  halo.addColorStop(0, hexA(haloColor, pulse + red * 0.3));
  halo.addColorStop(1, hexA(haloColor, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
  ctx.fill();

  // the spinning glossy flag marble itself is a real 3D WebGL sphere rendered as
  // a React overlay pinned over this tile (same marble as the country select), so
  // nothing is drawn here for it - only the pad, halo, fire and health bar are 2D

  // as it dies the base catches fire, and on death it burns hardest
  if (hurt > 0.5) drawFire(ctx, cx, cy - r * 0.6, r * 1.1, hurt > 0.75 ? 2 : 1, time, 0);

  // health bar above the base (ticks down as invaders leak) - hidden once the
  // base is destroyed, and hidden while the shield is up (the bubble stands in
  // for it, and no health has been spent yet)
  const frac = Math.max(0, 1 - hurt);
  if (frac > 0.001 && !shield) {
    const bw = r * 2.1;
    const bh = Math.max(4, cell * 0.07);
    const by = cy - r - cell * 0.24;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(cx - bw / 2, by, bw, bh);
    ctx.fillStyle = frac > 0.5 ? "#34d399" : frac > 0.25 ? "#fbbf24" : "#f87171";
    ctx.fillRect(cx - bw / 2, by, bw * frac, bh);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.strokeRect(cx - bw / 2, by, bw, bh);
  }
}
