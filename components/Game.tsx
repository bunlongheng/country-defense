"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { COUNTRIES, findCountry } from "@/lib/countries";
import { getFlagImage, loadFlagImage } from "@/lib/flagImage";
import type { Enemy, Projectile, Tower, TowerType, Vec2 } from "@/lib/game/types";
import {
  GRID_COLS,
  GRID_ROWS,
  WAYPOINTS,
  BASE_CELL,
  pathCells,
  pathLength,
  isBuildable,
} from "@/lib/game/map";
import {
  TOWER_DEFS,
  TOWER_ORDER,
  MAX_LEVEL,
  towerStats,
  upgradeCost,
  sellValue,
} from "@/lib/game/towers";
import {
  spawnWave,
  waveClearBonus,
  waveStats,
  TOTAL_WAVES,
  resetEnemyIds,
} from "@/lib/game/waves";
import {
  moveEnemies,
  fireTowers,
  reapDead,
  ageProjectiles,
  resetProjectileIds,
} from "@/lib/game/engine";

const START_GOLD = 220;
const START_LIVES = 20;
const BLOCKED = pathCells();
const PATH_LEN = pathLength();

type Phase = "ready" | "wave" | "won" | "lost";

export default function Game({
  code,
  onExit,
}: {
  code: string;
  onExit: () => void;
}) {
  const country = findCountry(code)!;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // mutable simulation state (kept in refs so the rAF loop never re-renders)
  const enemies = useRef<Enemy[]>([]);
  const towers = useRef<Tower[]>([]);
  const projectiles = useRef<Projectile[]>([]);
  const time = useRef(0);
  const nextTowerId = useRef(1);
  const phaseRef = useRef<Phase>("ready");
  const cellRef = useRef(48); // px per tile, recomputed on resize

  // HUD state (updated from the loop only when a value changes)
  const [gold, setGold] = useState(START_GOLD);
  const [lives, setLives] = useState(START_LIVES);
  const [wave, setWave] = useState(1);
  const [phase, setPhaseState] = useState<Phase>("ready");
  const [buildType, setBuildType] = useState<TowerType | null>("laser");
  // display copy of the selected tower; the live tower lives in the towers ref
  const [selected, setSelected] = useState<{
    id: number;
    type: TowerType;
    level: number;
  } | null>(null);

  const goldRef = useRef(START_GOLD);
  const livesRef = useRef(START_LIVES);
  const waveRef = useRef(1);
  const selectedIdRef = useRef<number | null>(null);
  const buildTypeRef = useRef<TowerType | null>("laser");

  useEffect(() => {
    selectedIdRef.current = selected?.id ?? null;
  }, [selected]);
  useEffect(() => {
    buildTypeRef.current = buildType;
  }, [buildType]);

  const pool = useRef(COUNTRIES.filter((c) => c.code !== code));

  const setPhase = (p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  };
  const spendGold = (amount: number) => {
    goldRef.current -= amount;
    setGold(goldRef.current);
  };

  // preload the player's flag and a handful of enemy flags up front
  useEffect(() => {
    loadFlagImage(code).catch(() => {});
    pool.current.slice(0, 30).forEach((c) => loadFlagImage(c.code).catch(() => {}));
  }, [code]);

  // ---- wave control ------------------------------------------------------
  const startWave = useCallback(() => {
    if (phaseRef.current !== "ready") return;
    const w = waveRef.current;
    const fresh = spawnWave(w, pool.current);
    fresh.forEach((e) => loadFlagImage(e.code).catch(() => {}));
    enemies.current = fresh;
    setPhase("wave");
  }, []);

  const resetGame = useCallback(() => {
    resetEnemyIds();
    resetProjectileIds();
    enemies.current = [];
    towers.current = [];
    projectiles.current = [];
    time.current = 0;
    nextTowerId.current = 1;
    goldRef.current = START_GOLD;
    livesRef.current = START_LIVES;
    waveRef.current = 1;
    setGold(START_GOLD);
    setLives(START_LIVES);
    setWave(1);
    setSelected(null);
    setBuildType("laser");
    setPhase("ready");
  }, []);

  // ---- the game loop -----------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let last = performance.now();

    const resize = () => {
      const parent = canvas.parentElement!;
      const cw = parent.clientWidth;
      const cell = Math.floor(cw / GRID_COLS);
      cellRef.current = cell;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = cell * GRID_COLS * dpr;
      canvas.height = cell * GRID_ROWS * dpr;
      canvas.style.width = `${cell * GRID_COLS}px`;
      canvas.style.height = `${cell * GRID_ROWS}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement!);

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      if (phaseRef.current === "wave") {
        time.current += dt;
        const moved = moveEnemies(enemies.current, dt, time.current, PATH_LEN);
        enemies.current = moved.survivors;
        if (moved.leaked > 0) {
          livesRef.current = Math.max(0, livesRef.current - moved.leaked);
          setLives(livesRef.current);
        }
        const fired = fireTowers(towers.current, enemies.current, dt, time.current);
        if (fired.projectiles.length)
          projectiles.current.push(...fired.projectiles);
        const reaped = reapDead(enemies.current);
        enemies.current = reaped.survivors;
        if (reaped.gold > 0) {
          goldRef.current += reaped.gold;
          setGold(goldRef.current);
        }
        projectiles.current = ageProjectiles(projectiles.current, dt);

        if (livesRef.current <= 0) {
          setPhase("lost");
        } else if (enemies.current.length === 0) {
          const bonus = waveClearBonus(waveRef.current);
          goldRef.current += bonus;
          setGold(goldRef.current);
          if (waveRef.current >= TOTAL_WAVES) {
            setPhase("won");
          } else {
            waveRef.current += 1;
            setWave(waveRef.current);
            setPhase("ready");
          }
        }
      } else {
        projectiles.current = ageProjectiles(projectiles.current, dt);
      }

      draw(ctx, cellRef.current, {
        code,
        enemies: enemies.current,
        towers: towers.current,
        projectiles: projectiles.current,
        selectedId: selectedIdRef.current,
        buildType: buildTypeRef.current,
      });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [code]);

  // ---- pointer: build / select ------------------------------------------
  const onCanvasPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const cell = cellRef.current;
    const col = Math.floor((e.clientX - rect.left) / cell);
    const row = Math.floor((e.clientY - rect.top) / cell);

    const existing = towers.current.find(
      (t) => t.cell.x === col && t.cell.y === row,
    );
    if (existing) {
      setSelected({ id: existing.id, type: existing.type, level: existing.level });
      return;
    }
    setSelected(null);
    if (!buildType) return;
    if (!isBuildable(col, row, BLOCKED)) return;
    const cost = TOWER_DEFS[buildType].cost;
    if (goldRef.current < cost) return;
    towers.current.push({
      id: nextTowerId.current++,
      type: buildType,
      cell: { x: col, y: row },
      level: 1,
      cooldown: 0,
    });
    spendGold(cost);
  };

  const doUpgrade = () => {
    const id = selectedIdRef.current;
    const t = towers.current.find((x) => x.id === id);
    if (!t || t.level >= MAX_LEVEL) return;
    const cost = upgradeCost(t.type, t.level);
    if (goldRef.current < cost) return;
    t.level += 1;
    spendGold(cost);
    setSelected({ id: t.id, type: t.type, level: t.level }); // refresh panel
  };
  const doSell = () => {
    const id = selectedIdRef.current;
    const t = towers.current.find((x) => x.id === id);
    if (!t) return;
    goldRef.current += sellValue(t.type, t.level);
    setGold(goldRef.current);
    towers.current = towers.current.filter((x) => x.id !== id);
    setSelected(null);
  };

  const ws = waveStats(wave);

  return (
    <div className="flex min-h-dvh flex-col bg-black text-white">
      {/* top HUD */}
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <button
          onClick={onExit}
          className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/70 active:scale-95"
        >
          ← Change
        </button>
        <div className="flex items-center gap-4 text-sm font-semibold sm:gap-6">
          <Stat label="Wave" value={`${wave}/${TOTAL_WAVES}`} tone="text-cyan-400" />
          <Stat label="Lives" value={lives} tone="text-rose-400" />
          <Stat label="Gold" value={gold} tone="text-amber-300" />
        </div>
        <div
          className="h-7 w-10 rounded-md bg-cover bg-center ring-1 ring-white/30"
          style={{ backgroundImage: `url(/flags/${code}.svg)` }}
          title={country.name}
          aria-label={country.name}
        />
      </div>

      {/* arena */}
      <div className="relative flex flex-1 items-center justify-center px-2">
        <div className="relative w-full max-w-4xl">
          <canvas
            ref={canvasRef}
            onPointerDown={onCanvasPointer}
            className="mx-auto block touch-none rounded-2xl ring-1 ring-white/10"
          />

          {/* upgrade / sell panel */}
          {selected && (
            <div className="absolute left-1/2 top-2 -translate-x-1/2 rounded-xl border border-white/15 bg-neutral-900/95 px-4 py-3 text-center shadow-xl">
              <div
                className="text-sm font-bold"
                style={{ color: TOWER_DEFS[selected.type].color }}
              >
                {TOWER_DEFS[selected.type].name} · Lv {selected.level}
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={doUpgrade}
                  disabled={
                    selected.level >= MAX_LEVEL ||
                    gold < upgradeCost(selected.type, selected.level)
                  }
                  className="rounded-lg bg-cyan-400 px-3 py-1.5 text-sm font-bold text-black disabled:opacity-40"
                >
                  {selected.level >= MAX_LEVEL
                    ? "Maxed"
                    : `Upgrade ${upgradeCost(selected.type, selected.level)}`}
                </button>
                <button
                  onClick={doSell}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-sm text-white/80"
                >
                  Sell {sellValue(selected.type, selected.level)}
                </button>
              </div>
            </div>
          )}

          {/* win / lose overlay */}
          {(phase === "won" || phase === "lost") && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 rounded-2xl bg-black/80 backdrop-blur-sm">
              <div className="text-5xl">{phase === "won" ? "🏆" : "💥"}</div>
              <div className="text-2xl font-black">
                {phase === "won" ? `${country.name} holds!` : `${country.name} fell`}
              </div>
              <div className="text-sm text-white/60">
                {phase === "won"
                  ? `You survived all ${TOTAL_WAVES} waves`
                  : `You reached wave ${wave}`}
              </div>
              <button
                onClick={resetGame}
                className="rounded-full bg-cyan-400 px-6 py-3 font-bold text-black active:scale-95"
              >
                Play again
              </button>
            </div>
          )}
        </div>
      </div>

      {/* bottom: tower shop */}
      <div className="border-t border-white/10 p-3">
        {phase === "ready" && (
          <div className="mb-3 flex items-center justify-center gap-3">
            <button
              onClick={startWave}
              className="rounded-full bg-emerald-400 px-6 py-2.5 font-bold text-black shadow-lg shadow-emerald-500/20 active:scale-95"
            >
              Start Wave {wave} ▸
            </button>
            <span className="text-xs text-white/40">
              Invaders: {ws.hp} hp · faster each wave
            </span>
          </div>
        )}
        <div className="mx-auto grid max-w-4xl grid-cols-3 gap-2 sm:grid-cols-6">
          {TOWER_ORDER.map((type) => {
            const d = TOWER_DEFS[type];
            const active = buildType === type && !selected;
            const afford = gold >= d.cost;
            return (
              <button
                key={type}
                onClick={() => {
                  setSelected(null);
                  setBuildType(type);
                }}
                className={`flex flex-col items-center gap-0.5 rounded-xl border px-2 py-2 transition ${
                  active
                    ? "border-white bg-white/10"
                    : "border-white/10 bg-white/[0.03]"
                } ${afford ? "" : "opacity-40"}`}
              >
                <span className="text-lg" style={{ color: d.color }}>
                  {d.icon}
                </span>
                <span className="text-[11px] font-semibold text-white/80">
                  {d.name}
                </span>
                <span className="text-[10px] text-amber-300">{d.cost}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: string;
}) {
  return (
    <div className="flex flex-col items-center leading-none">
      <span className={`text-lg font-black ${tone}`}>{value}</span>
      <span className="text-[10px] uppercase tracking-wider text-white/40">
        {label}
      </span>
    </div>
  );
}

// ---- canvas rendering ----------------------------------------------------

interface DrawState {
  code: string;
  enemies: Enemy[];
  towers: Tower[];
  projectiles: Projectile[];
  selectedId: number | null;
  buildType: TowerType | null;
}

const toPx = (v: Vec2, cell: number): Vec2 => ({
  x: (v.x + 0.5) * cell,
  y: (v.y + 0.5) * cell,
});

function draw(ctx: CanvasRenderingContext2D, cell: number, s: DrawState) {
  const w = cell * GRID_COLS;
  const h = cell * GRID_ROWS;
  ctx.clearRect(0, 0, w, h);

  // background
  ctx.fillStyle = "#08090c";
  ctx.fillRect(0, 0, w, h);

  // subtle grid
  ctx.strokeStyle = "rgba(255,255,255,0.035)";
  ctx.lineWidth = 1;
  for (let c = 0; c <= GRID_COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * cell, 0);
    ctx.lineTo(c * cell, h);
    ctx.stroke();
  }
  for (let r = 0; r <= GRID_ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * cell);
    ctx.lineTo(w, r * cell);
    ctx.stroke();
  }

  // path road
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(56,189,248,0.12)";
  ctx.lineWidth = cell * 0.82;
  strokePath(ctx, cell);
  ctx.strokeStyle = "rgba(56,189,248,0.28)";
  ctx.lineWidth = cell * 0.66;
  strokePath(ctx, cell);

  // towers
  for (const t of s.towers) {
    const p = toPx(t.cell, cell);
    const stats = towerStats(t.type, t.level);
    const def = TOWER_DEFS[t.type];
    if (t.id === s.selectedId) {
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
    // level pips
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
    const col = TOWER_DEFS[pr.type].color;
    ctx.strokeStyle = col;
    ctx.lineWidth = pr.type === "sniper" ? 2.5 : pr.type === "laser" ? 3 : 2;
    ctx.globalAlpha = Math.min(1, pr.ttl * 6);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    if (pr.type === "tesla") {
      const mx = (a.x + b.x) / 2 + (Math.random() - 0.5) * cell * 0.3;
      const my = (a.y + b.y) / 2 + (Math.random() - 0.5) * cell * 0.3;
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
    // hp bar
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

  // spherical shading: dark rim
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

  // specular highlight
  ctx.beginPath();
  ctx.arc(p.x - r * 0.32, p.y - r * 0.34, r * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fill();

  // outline
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.lineWidth = isBase ? 3 : 1.5;
  ctx.strokeStyle = isBase ? "#38bdf8" : "rgba(255,255,255,0.35)";
  ctx.stroke();
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
