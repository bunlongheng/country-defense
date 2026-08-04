"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { COUNTRIES, findCountry, flagUrl } from "@/lib/countries";
import { loadFlagImage } from "@/lib/flagImage";
import type { Enemy, Projectile, Tower, TowerType } from "@/lib/game/types";
import {
  GRID_COLS,
  GRID_ROWS,
  pathCells,
  pathLength,
  isBuildable,
} from "@/lib/game/map";
import {
  TOWER_DEFS,
  TOWER_ORDER,
  MAX_LEVEL,
  upgradeCost,
  sellValue,
} from "@/lib/game/towers";
import { draw } from "@/lib/game/render";
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
  const country = findCountry(code);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // mutable simulation state (kept in refs so the rAF loop never re-renders)
  const enemies = useRef<Enemy[]>([]);
  const towers = useRef<Tower[]>([]);
  const projectiles = useRef<Projectile[]>([]);
  const time = useRef(0);
  const nextTowerId = useRef(1);
  const phaseRef = useRef<Phase>("ready");
  const cellRef = useRef(48); // px per tile, recomputed on resize
  const seedRef = useRef(0); // per-game seed so each playthrough varies invaders
  const cursorRef = useRef<{ x: number; y: number } | null>(null); // keyboard cursor

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
  // transient feedback banner (e.g. "Not enough gold") so a rejected tap is never silent
  const [hint, setHint] = useState("");
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = (msg: string) => {
    setHint(msg);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(""), 1400);
  };

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

  // preload the player's flag and a handful of enemy flags up front, and pick a
  // per-game seed so invader lineups differ between playthroughs
  useEffect(() => {
    seedRef.current = Math.floor(Math.random() * pool.current.length);
    loadFlagImage(code).catch(() => {});
    pool.current.slice(0, 30).forEach((c) => loadFlagImage(c.code).catch(() => {}));
  }, [code]);

  // ---- wave control ------------------------------------------------------
  const startWave = useCallback(() => {
    if (phaseRef.current !== "ready") return;
    const w = waveRef.current;
    const fresh = spawnWave(w, pool.current, 1.6, seedRef.current);
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
    seedRef.current = Math.floor(Math.random() * pool.current.length);
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
        cursor: cursorRef.current,
      });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [code]);

  // ---- build / select (shared by pointer taps and keyboard) --------------
  const selectOrBuild = useCallback(
    (col: number, row: number) => {
      const existing = towers.current.find(
        (t) => t.cell.x === col && t.cell.y === row,
      );
      if (existing) {
        setSelected({ id: existing.id, type: existing.type, level: existing.level });
        return;
      }
      setSelected(null);
      const type = buildTypeRef.current;
      if (!type) return;
      if (!isBuildable(col, row, BLOCKED)) {
        flash("Can't build on the path");
        return;
      }
      const cost = TOWER_DEFS[type].cost;
      if (goldRef.current < cost) {
        flash(`Need ${cost} gold`);
        return;
      }
      towers.current.push({
        id: nextTowerId.current++,
        type,
        cell: { x: col, y: row },
        level: 1,
        cooldown: 0,
      });
      spendGold(cost);
    },
    // all reads are refs; state setters are stable
    [],
  );

  const onCanvasPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const cell = cellRef.current;
    cursorRef.current = null; // pointer play hides the keyboard cursor
    selectOrBuild(
      Math.floor((e.clientX - rect.left) / cell),
      Math.floor((e.clientY - rect.top) / cell),
    );
  };

  // ---- keyboard: move a build cursor, place, and pick towers -------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phaseRef.current === "won" || phaseRef.current === "lost") return;
      const digit = "123456".indexOf(e.key);
      if (digit >= 0) {
        setSelected(null);
        setBuildType(TOWER_ORDER[digit]);
        return;
      }
      const cur = cursorRef.current ?? { x: 6, y: 4 };
      let { x, y } = cur;
      if (e.key === "ArrowLeft") x = Math.max(0, x - 1);
      else if (e.key === "ArrowRight") x = Math.min(GRID_COLS - 1, x + 1);
      else if (e.key === "ArrowUp") y = Math.max(0, y - 1);
      else if (e.key === "ArrowDown") y = Math.min(GRID_ROWS - 1, y + 1);
      else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectOrBuild(cur.x, cur.y);
        return;
      } else if (e.key === "Escape") {
        cursorRef.current = null;
        setSelected(null);
        return;
      } else return;
      e.preventDefault();
      cursorRef.current = { x, y };
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectOrBuild]);

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

  // Confirm before abandoning a battle in progress so one stray tap does not wipe a run.
  const handleExit = () => {
    if (
      (phaseRef.current === "wave" || towers.current.length > 0) &&
      typeof window !== "undefined" &&
      !window.confirm("Leave the battle? Your progress will be lost.")
    ) {
      return;
    }
    onExit();
  };

  // clean up the hint timer on unmount
  useEffect(() => () => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
  }, []);

  const ws = waveStats(wave);

  if (!country) return null;

  return (
    <div
      className="flex min-h-dvh flex-col bg-black text-white"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* top HUD */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-3"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <button
          onClick={handleExit}
          className="min-h-11 rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/80 active:scale-95"
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
          style={{ backgroundImage: `url(${flagUrl(code)})` }}
          title={country.name}
          role="img"
          aria-label={`Defending ${country.name}`}
        />
      </div>

      {/* arena */}
      <div className="relative flex flex-1 items-center justify-center px-2">
        <div className="relative w-full max-w-4xl">
          <canvas
            ref={canvasRef}
            onPointerDown={onCanvasPointer}
            role="img"
            aria-label="Battle map - tap an open tile to place a tower, tap a tower to upgrade it"
            className="mx-auto block touch-none rounded-2xl ring-1 ring-white/10"
          />

          {/* transient feedback banner for rejected taps */}
          {hint && (
            <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
              <span className="rounded-full bg-rose-500/90 px-4 py-1.5 text-sm font-semibold text-white shadow-lg">
                {hint}
              </span>
            </div>
          )}

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
                  className="min-h-11 rounded-lg bg-cyan-400 px-3 py-2 text-sm font-bold text-black disabled:opacity-40"
                >
                  {selected.level >= MAX_LEVEL
                    ? "Maxed"
                    : `Upgrade ${upgradeCost(selected.type, selected.level)}`}
                </button>
                <button
                  onClick={doSell}
                  className="min-h-11 rounded-lg border border-white/20 px-3 py-2 text-sm text-white/80"
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
        {/* fixed-height control row so the shop never jumps when a wave starts */}
        <div className="mb-3 flex h-10 items-center justify-center gap-3">
          {phase === "ready" ? (
            <>
              <button
                onClick={startWave}
                className="min-h-11 rounded-full bg-emerald-400 px-6 py-2.5 font-bold text-black shadow-lg shadow-emerald-500/20 active:scale-95"
              >
                Start Wave {wave} ▸
              </button>
              <span className="text-xs text-white/60">
                Invaders: {ws.hp} hp · faster each wave
              </span>
            </>
          ) : (
            <span className="text-sm font-semibold text-cyan-400">
              Wave {wave} - defend!
            </span>
          )}
        </div>
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
                aria-pressed={active}
                className={`flex min-h-11 flex-col items-center gap-0.5 rounded-xl border px-2 py-2 transition ${
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
      <span className="text-[11px] uppercase tracking-wider text-white/60">
        {label}
      </span>
    </div>
  );
}

