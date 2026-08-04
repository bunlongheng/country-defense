import type { Enemy, Projectile, Tower, TowerType, Vec2 } from "./types.ts";
import { GRID_COLS, GRID_ROWS, WAYPOINTS, BASE_CELL, pathCells } from "./map.ts";
import { TOWER_DEFS, towerStats } from "./towers.ts";
import type { Particle } from "./particles.ts";
import { getFlagImage } from "../flagImage.ts";
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
}

// One global sun direction so every dome, marble and mountain is lit the same way.
const LIGHT = { x: -0.42, y: -0.55 };

const toPx = (v: Vec2, cell: number): Vec2 => ({
  x: (v.x + 0.5) * cell,
  y: (v.y + 0.5) * cell,
});

const PATH = pathCells();
const onPath = (c: number, r: number) => PATH.has(`${c},${r}`);

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

function background(cell: number, code: string, palette: string[]): HTMLCanvasElement {
  const key = `${cell}|${code}|${palette[0] ?? ""}`;
  if (bgCanvas && bgKey === key) return bgCanvas;
  const w = cell * GRID_COLS;
  const h = cell * GRID_ROWS;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const accent = palette[0] ?? "#3f6212";

  // grassy terrain base, faintly tinted toward the nation's color
  const ground = ctx.createLinearGradient(0, 0, 0, h);
  ground.addColorStop(0, "#1c2b16");
  ground.addColorStop(1, "#0e1a0c");
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = hexA(accent, 0.06);
  ctx.fillRect(0, 0, w, h);

  // layered mountain range across the far (top) edge
  mountains(ctx, w, cell, accent);

  // soft grass mottling for texture
  for (let i = 0; i < 90; i++) {
    const x = hash(i, 3, 1) * w;
    const y = hash(i, 7, 2) * h;
    ctx.fillStyle = hexA(hash(i, 1, 5) > 0.5 ? "#2f4a1e" : "#16240f", 0.5);
    ctx.beginPath();
    ctx.arc(x, y, cell * (0.05 + hash(i, 9, 3) * 0.08), 0, Math.PI * 2);
    ctx.fill();
  }

  // build plots: a faint rounded pad on every buildable (non-path) tile so the
  // player sees exactly where towers go. No grid at all over the road.
  for (let c = 0; c < GRID_COLS; c++) {
    for (let r = 0; r < GRID_ROWS; r++) {
      if (onPath(c, r)) continue;
      roundRect(ctx, c * cell + cell * 0.14, r * cell + cell * 0.14, cell * 0.72, cell * 0.72, cell * 0.14);
      ctx.fillStyle = "rgba(255,255,255,0.028)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // the road, rendered as a muddy dirt track (base blocks tower building)
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(41,30,20,0.9)";
  ctx.lineWidth = cell * 0.9;
  strokePath(ctx, cell);
  ctx.strokeStyle = "#5a4326";
  ctx.lineWidth = cell * 0.7;
  strokePath(ctx, cell);
  ctx.strokeStyle = "#6f5330";
  ctx.lineWidth = cell * 0.5;
  strokePath(ctx, cell);
  // mud puddles / ruts along the track
  mudFlecks(ctx, cell);

  // nature scattered on the terrain (drawn under towers/enemies each frame)
  scenery(ctx, cell, accent);

  bgCanvas = canvas;
  bgKey = key;
  return canvas;
}

function mountains(ctx: CanvasRenderingContext2D, w: number, cell: number, accent: string) {
  const bands = [
    { base: cell * 1.9, amp: cell * 1.1, col: "#243447" },
    { base: cell * 1.5, amp: cell * 0.9, col: "#2c3f52" },
    { base: cell * 1.1, amp: cell * 0.7, col: shade(accent, -0.55) },
  ];
  for (const b of bands) {
    ctx.beginPath();
    ctx.moveTo(0, b.base);
    const peaks = 7;
    for (let i = 0; i <= peaks; i++) {
      const x = (i / peaks) * w;
      const y = b.base - Math.abs(Math.sin(i * 1.7 + b.amp)) * b.amp - hash(i, 2) * b.amp * 0.5;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, 0);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fillStyle = b.col;
    ctx.fill();
    // snow caps on the nearest range
    if (b === bands[2]) {
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      for (let i = 1; i < peaks; i++) {
        const x = (i / peaks) * w;
        const y = b.base - Math.abs(Math.sin(i * 1.7 + b.amp)) * b.amp - hash(i, 2) * b.amp * 0.5;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - cell * 0.18, y + cell * 0.22);
        ctx.lineTo(x + cell * 0.18, y + cell * 0.22);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
}

function mudFlecks(ctx: CanvasRenderingContext2D, cell: number) {
  for (let i = 0; i < WAYPOINTS.length - 1; i++) {
    const a = toPx(WAYPOINTS[i], cell);
    const b = toPx(WAYPOINTS[i + 1], cell);
    const steps = 6;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t + (hash(i, s) - 0.5) * cell * 0.4;
      const y = a.y + (b.y - a.y) * t + (hash(i, s, 2) - 0.5) * cell * 0.4;
      ctx.beginPath();
      ctx.arc(x, y, cell * (0.05 + hash(i, s, 4) * 0.06), 0, Math.PI * 2);
      ctx.fillStyle = hash(i, s, 6) > 0.5 ? "rgba(58,42,24,0.6)" : "rgba(120,92,52,0.4)";
      ctx.fill();
    }
  }
}

function scenery(ctx: CanvasRenderingContext2D, cell: number, accent: string) {
  for (let c = 0; c < GRID_COLS; c++) {
    for (let r = 0; r < GRID_ROWS; r++) {
      if (onPath(c, r)) continue;
      const roll = hash(c, r, 11);
      // keep interior building tiles mostly clear; decorate edges + gaps densely
      const edge = c === 0 || r === 0 || c === GRID_COLS - 1 || r === GRID_ROWS - 1;
      const chance = edge ? 0.7 : 0.32;
      if (roll > chance) continue;
      const cx = c * cell + cell * (0.2 + hash(c, r, 12) * 0.6);
      const cy = r * cell + cell * (0.2 + hash(c, r, 13) * 0.6);
      const kind = hash(c, r, 14);
      if (kind < 0.5) tree(ctx, cx, cy, cell, hash(c, r, 15) > 0.5);
      else if (kind < 0.72) rock(ctx, cx, cy, cell);
      else if (kind < 0.88) bush(ctx, cx, cy, cell, accent);
      else mud(ctx, cx, cy, cell);
    }
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

function rock(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number) {
  const s = cell * 0.2;
  const g = ctx.createLinearGradient(x - s, y - s, x + s, y + s);
  g.addColorStop(0, "#8a8f96");
  g.addColorStop(1, "#4b5157");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x - s, y + s * 0.5);
  ctx.lineTo(x - s * 0.5, y - s * 0.6);
  ctx.lineTo(x + s * 0.4, y - s * 0.5);
  ctx.lineTo(x + s, y + s * 0.4);
  ctx.closePath();
  ctx.fill();
}

function bush(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number, accent: string) {
  const s = cell * 0.16;
  ctx.fillStyle = "#2f6a2c";
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

export function draw(ctx: CanvasRenderingContext2D, cell: number, s: DrawState) {
  const w = cell * GRID_COLS;
  const h = cell * GRID_ROWS;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(background(cell, s.code, s.palette), 0, 0);

  // keyboard build cursor (only shown during keyboard play)
  if (s.cursor) {
    const x = s.cursor.x * cell;
    const y = s.cursor.y * cell;
    ctx.strokeStyle = "rgba(132,204,22,0.95)";
    ctx.lineWidth = 2.5;
    roundRect(ctx, x + 3, y + 3, cell - 6, cell - 6, cell * 0.12);
    ctx.stroke();
  }

  // towers
  for (const t of s.towers) {
    const p = toPx(t.cell, cell);
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
    drawTower(ctx, p, cell, t, s.palette, s.code, s.time);
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
      s.palette,
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
  drawBase(ctx, toPx(BASE_CELL, cell), cell, s.palette, s.time, 1 - s.lives / s.maxLives, s.code);

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
function drawTower(
  ctx: CanvasRenderingContext2D,
  p: Vec2,
  cell: number,
  t: Tower,
  palette: string[],
  code: string,
  time: number,
) {
  const def = TOWER_DEFS[t.type];
  // higher-level towers are physically bigger and beefier-looking
  const R = cell * (0.32 + t.level * 0.045);
  const c1 = palette[0] ?? "#64748b"; // the nation's main colour

  // ground shadow
  ctx.fillStyle = "rgba(0,0,0,0.38)";
  ctx.beginPath();
  ctx.ellipse(p.x, p.y + R * 0.72, R * 0.82, R * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();

  // circular metallic armor base in the nation's colour, with a beveled rim
  const body = ctx.createRadialGradient(
    p.x + LIGHT.x * R, p.y + LIGHT.y * R, R * 0.1, p.x, p.y, R * 1.15,
  );
  body.addColorStop(0, shade(c1, 0.5));
  body.addColorStop(0.68, c1);
  body.addColorStop(1, shade(c1, -0.55));
  ctx.beginPath();
  ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = R * 0.1; // dark beveled rim
  ctx.strokeStyle = shade(c1, -0.55);
  ctx.stroke();
  ctx.lineWidth = 1.5; // thin bright highlight ring inside the rim
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.beginPath();
  ctx.arc(p.x, p.y, R * 0.86, 0, Math.PI * 2);
  ctx.stroke();

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

  // domed turret, lit from the sun
  const domeR = R * 0.66;
  const dome = ctx.createRadialGradient(
    p.x + LIGHT.x * domeR,
    p.y + LIGHT.y * domeR,
    domeR * 0.1,
    p.x,
    p.y,
    domeR,
  );
  dome.addColorStop(0, shade(def.color, 0.55));
  dome.addColorStop(0.55, def.color);
  dome.addColorStop(1, shade(def.color, -0.5));
  ctx.beginPath();
  ctx.arc(p.x, p.y, domeR, 0, Math.PI * 2);
  ctx.fillStyle = dome;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = shade(def.color, -0.4);
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

  // emblem glyph so kids can still tell the towers apart at a glance
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = `${Math.round(cell * 0.3)}px system-ui`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(def.icon, p.x, p.y + 1);

  // level shown as small gold stars on the lower hull (kept inside the tower)
  for (let i = 0; i < t.level; i++) {
    star(ctx, p.x - (t.level - 1) * R * 0.13 + i * R * 0.26, p.y + R * 0.72, R * 0.085, "#fbbf24");
  }

  // a small national flag WAVING on a short pole at the back of the turret
  towerFlag(ctx, code, p.x - R * 0.1, p.y - R * 0.35, R, time, t.id);
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
) {
  const poleTop = baseY - R * 1.5;
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
  const w = R * 1.05;
  const h = R * 0.62;
  const fx = baseX + ctx.lineWidth * 0.5;
  const fy = poleTop + R * 0.02;
  if (!img) {
    ctx.fillStyle = "#94a3b8";
    ctx.fillRect(fx, fy, w, h);
    return;
  }
  const nw = img.naturalWidth || 640;
  const nh = img.naturalHeight || 480;
  const cols = 14;
  const colW = nw / cols;
  const dw = w / cols;
  const amp = h * 0.24;
  for (let i = 0; i < cols; i++) {
    const t2 = i / (cols - 1); // 0 at the pole, 1 at the free end
    const ph = time * 6 - i * 0.7 + phase;
    const yo = Math.sin(ph) * amp * t2; // vertical ripple, biggest at the free end
    const dx = fx + i * dw;
    ctx.drawImage(img, i * colW, 0, colW, nh, dx, fy + yo, dw + 0.7, h);
    // fold lighting: crest (rising slope) catches light, trough darkens
    const sh = Math.cos(ph) * 0.4 * (0.35 + t2);
    ctx.fillStyle = sh >= 0 ? `rgba(255,255,255,${sh})` : `rgba(0,0,0,${-sh})`;
    ctx.fillRect(dx, fy + yo, dw + 0.7, h);
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
function drawShock(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, seed: number, time: number) {
  ctx.strokeStyle = "#fde047";
  ctx.lineWidth = 2;
  ctx.shadowColor = "#facc15";
  ctx.shadowBlur = 6;
  const bolts = 4;
  for (let b = 0; b < bolts; b++) {
    const base = (b / bolts) * Math.PI * 2 + seed * 1.3 + time * 12;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    for (let s = 1; s <= 3; s++) {
      const rad = (r * 1.2 * s) / 3;
      const jitter = Math.sin(seed * 7.1 + b * 3.3 + s * 5.5 + time * 20) * 0.5;
      const a = base + jitter;
      ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    }
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
}

// A filled 5-point star with a dark outline.
function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? r : r * 0.45;
    const x = cx + Math.cos(ang) * rad;
    const y = cy + Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
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
  switch (pr.type) {
    case "laser": {
      // fat glowing beam
      ctx.strokeStyle = "rgba(34,211,238,0.35)";
      ctx.lineWidth = cell * 0.16;
      line(ctx, a, b);
      ctx.strokeStyle = "#a5f3fc";
      ctx.lineWidth = cell * 0.06;
      line(ctx, a, b);
      break;
    }
    case "rapid": {
      // a little bullet with a short tracer
      ctx.strokeStyle = "rgba(244,114,182,0.5)";
      ctx.lineWidth = cell * 0.05;
      const mid = { x: b.x + (a.x - b.x) * 0.3, y: b.y + (a.y - b.y) * 0.3 };
      line(ctx, mid, b);
      ctx.fillStyle = "#fce7f3";
      ctx.beginPath();
      ctx.arc(b.x, b.y, cell * 0.06, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "sniper": {
      // thin precise tracer + muzzle spark + hit flash
      ctx.strokeStyle = "rgba(167,139,250,0.9)";
      ctx.lineWidth = 1.5;
      line(ctx, a, b);
      spark(ctx, a, cell * 0.12, "#c4b5fd");
      spark(ctx, b, cell * 0.14, "#ffffff");
      break;
    }
    case "cannon": {
      // heavy shell mid-flight + explosion ring at the target
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      ctx.fillStyle = "#1f2937";
      ctx.beginPath();
      ctx.arc(m.x, m.y, cell * 0.1, 0, Math.PI * 2);
      ctx.fill();
      const g = ctx.createRadialGradient(b.x, b.y, 1, b.x, b.y, cell * 0.34);
      g.addColorStop(0, "rgba(255,220,120,0.9)");
      g.addColorStop(0.5, "rgba(249,115,22,0.6)");
      g.addColorStop(1, "rgba(249,115,22,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, cell * 0.34, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "frost": {
      // icy shard + a little snowflake burst at the target
      ctx.strokeStyle = "rgba(191,219,254,0.7)";
      ctx.lineWidth = cell * 0.05;
      line(ctx, a, b);
      ctx.strokeStyle = "#dbeafe";
      ctx.lineWidth = 1.5;
      for (let k = 0; k < 3; k++) {
        const ang = (k / 3) * Math.PI;
        ctx.beginPath();
        ctx.moveTo(b.x - Math.cos(ang) * cell * 0.12, b.y - Math.sin(ang) * cell * 0.12);
        ctx.lineTo(b.x + Math.cos(ang) * cell * 0.12, b.y + Math.sin(ang) * cell * 0.12);
        ctx.stroke();
      }
      break;
    }
    case "tesla": {
      // jagged lightning bolt
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      const mx = (a.x + b.x) / 2 + pr.jitter * cell;
      const my = (a.y + b.y) / 2 - pr.jitter * cell;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(mx, my);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      break;
    }
    case "slime": {
      // gooey green glob with a sticky trail
      ctx.strokeStyle = "rgba(132,204,22,0.5)";
      ctx.lineWidth = cell * 0.14;
      line(ctx, a, b);
      const g = ctx.createRadialGradient(b.x - cell * 0.05, b.y - cell * 0.05, 1, b.x, b.y, cell * 0.2);
      g.addColorStop(0, "#bef264");
      g.addColorStop(1, "#4d7c0f");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, cell * 0.18, 0, Math.PI * 2);
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

function strokePath(ctx: CanvasRenderingContext2D, cell: number) {
  ctx.beginPath();
  WAYPOINTS.forEach((wp, i) => {
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
  code: string,
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

  // the spinning glossy flag marble, drawn in 2D so it works on EVERY device
  // (the old WebGL overlay broke into a white box on some browsers)
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  paintFlag(ctx, getFlagImage(code), cx, cy, r, time * cell * 0.55); // scroll = spin
  sphereShade(ctx, cx, cy, r); // 3D spherical shading
  if (red > 0) {
    ctx.fillStyle = `rgba(220,38,38,${Math.min(0.5, red * 0.55)})`;
    ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
  }
  ctx.restore();
  specular(ctx, cx, cy, r); // bright glossy glint

  // about to die: the base catches fire (small past 10 lost, a blaze past 15)
  if (hurt > 0.5) drawFire(ctx, cx, cy - r * 0.6, r * 1.1, hurt > 0.8 ? 2 : 1, time, 0);

  // health bar above the base - replaces the heart HUD counter, ticks down as
  // invaders leak through (just like an enemy's bar)
  const frac = Math.max(0, 1 - hurt);
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
