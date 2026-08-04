import type { Enemy, Projectile, Tower, TowerType, Vec2 } from "./types.ts";
import { GRID_COLS, GRID_ROWS, WAYPOINTS, BASE_CELL } from "./map.ts";
import { TOWER_DEFS, towerStats } from "./towers.ts";
import { getFlagImage } from "../flagImage.ts";
import { hexA } from "./math.ts";

// The 2D canvas renderer, kept out of the React component so it is a pure,
// reusable function of (ctx, cell, state). Browser-only (uses CanvasRenderingContext2D).

export interface DrawState {
  code: string;
  enemies: Enemy[];
  towers: Tower[];
  projectiles: Projectile[];
  selectedId: number | null;
  buildType: TowerType | null;
  cursor?: { x: number; y: number } | null;
}

const toPx = (v: Vec2, cell: number): Vec2 => ({
  x: (v.x + 0.5) * cell,
  y: (v.y + 0.5) * cell,
});

// The background (fill + grid + path road) never changes except on resize, so it
// is rendered once to an offscreen canvas and blitted each frame instead of
// re-stroking ~27 lines every frame.
let bgCanvas: HTMLCanvasElement | null = null;
let bgCell = 0;

function background(cell: number): HTMLCanvasElement {
  if (bgCanvas && bgCell === cell) return bgCanvas;
  const w = cell * GRID_COLS;
  const h = cell * GRID_ROWS;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#08090c";
  ctx.fillRect(0, 0, w, h);

  // grid, batched into a single path
  ctx.strokeStyle = "rgba(255,255,255,0.035)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 0; c <= GRID_COLS; c++) {
    ctx.moveTo(c * cell, 0);
    ctx.lineTo(c * cell, h);
  }
  for (let r = 0; r <= GRID_ROWS; r++) {
    ctx.moveTo(0, r * cell);
    ctx.lineTo(w, r * cell);
  }
  ctx.stroke();

  // path road (two overlaid strokes for a soft edge)
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(56,189,248,0.12)";
  ctx.lineWidth = cell * 0.82;
  strokePath(ctx, cell);
  ctx.strokeStyle = "rgba(56,189,248,0.28)";
  ctx.lineWidth = cell * 0.66;
  strokePath(ctx, cell);

  bgCanvas = canvas;
  bgCell = cell;
  return canvas;
}

export function draw(ctx: CanvasRenderingContext2D, cell: number, s: DrawState) {
  const w = cell * GRID_COLS;
  const h = cell * GRID_ROWS;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(background(cell), 0, 0);

  // keyboard build cursor (only shown during keyboard play)
  if (s.cursor) {
    const x = s.cursor.x * cell;
    const y = s.cursor.y * cell;
    ctx.strokeStyle = "rgba(34,211,238,0.9)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 2, y + 2, cell - 4, cell - 4);
  }

  // towers
  for (const t of s.towers) {
    const p = toPx(t.cell, cell);
    const def = TOWER_DEFS[t.type];
    if (t.id === s.selectedId) {
      const stats = towerStats(t.type, t.level);
      ctx.beginPath();
      ctx.arc(p.x, p.y, stats.range * cell, 0, Math.PI * 2);
      ctx.fillStyle = hexA(def.color, 0.08);
      ctx.fill();
      ctx.strokeStyle = hexA(def.color, 0.5);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    const rad = cell * 0.34;
    ctx.beginPath();
    ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
    ctx.fillStyle = "#12141a";
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = def.color;
    ctx.stroke();
    ctx.fillStyle = def.color;
    ctx.font = `${Math.round(cell * 0.42)}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(def.icon, p.x, p.y + 1);
    for (let i = 0; i < t.level; i++) {
      ctx.beginPath();
      ctx.arc(p.x - rad + 5 + i * 6, p.y + rad - 3, 2, 0, Math.PI * 2);
      ctx.fillStyle = def.color;
      ctx.fill();
    }
  }

  // projectiles
  for (const pr of s.projectiles) {
    const a = toPx(pr.from, cell);
    const b = toPx(pr.to, cell);
    ctx.strokeStyle = TOWER_DEFS[pr.type].color;
    ctx.lineWidth = pr.type === "sniper" ? 2.5 : pr.type === "laser" ? 3 : 2;
    ctx.globalAlpha = Math.min(1, pr.ttl * 6);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    if (pr.type === "tesla") {
      // deterministic jitter so the bolt shape is stable across frames
      const mx = (a.x + b.x) / 2 + pr.jitter * cell;
      const my = (a.y + b.y) / 2 - pr.jitter * cell;
      ctx.lineTo(mx, my);
    }
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // base marble (player's country)
  drawMarble(ctx, toPx(BASE_CELL, cell), cell * 0.46, s.code, true);

  // enemies
  for (const e of s.enemies) {
    if (e.dist < 0) continue; // still queued off-screen
    const p = toPx(e.pos, cell);
    drawMarble(ctx, p, cell * 0.34, e.code, false);
    const bw = cell * 0.6;
    const frac = Math.max(0, e.hp / e.maxHp);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(p.x - bw / 2, p.y - cell * 0.5, bw, 4);
    ctx.fillStyle = frac > 0.5 ? "#34d399" : frac > 0.25 ? "#fbbf24" : "#f87171";
    ctx.fillRect(p.x - bw / 2, p.y - cell * 0.5, bw * frac, 4);
  }
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

// glossy flag marble: clipped flag + radial shading + specular highlight
function drawMarble(
  ctx: CanvasRenderingContext2D,
  p: Vec2,
  r: number,
  code: string,
  isBase: boolean,
) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.clip();

  const img = getFlagImage(code);
  if (img) {
    const nw = img.naturalWidth || 640;
    const nh = img.naturalHeight || 480;
    const scale = Math.max((2 * r) / nw, (2 * r) / nh);
    const iw = nw * scale;
    const ih = nh * scale;
    ctx.drawImage(img, p.x - iw / 2, p.y - ih / 2, iw, ih);
  } else {
    ctx.fillStyle = "#475569";
    ctx.fillRect(p.x - r, p.y - r, 2 * r, 2 * r);
  }

  const shade = ctx.createRadialGradient(
    p.x - r * 0.3,
    p.y - r * 0.3,
    r * 0.1,
    p.x,
    p.y,
    r,
  );
  shade.addColorStop(0, "rgba(255,255,255,0.15)");
  shade.addColorStop(0.6, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = shade;
  ctx.fillRect(p.x - r, p.y - r, 2 * r, 2 * r);
  ctx.restore();

  ctx.beginPath();
  ctx.arc(p.x - r * 0.32, p.y - r * 0.34, r * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.lineWidth = isBase ? 3 : 1.5;
  ctx.strokeStyle = isBase ? "#38bdf8" : "rgba(255,255,255,0.35)";
  ctx.stroke();
}
