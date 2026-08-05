"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Waves,
  Coins,
  Skull as SkullIcon,
  Pause as PauseIcon,
  Play as PlayIcon,
  Volume2,
  VolumeX,
  Settings,
} from "lucide-react";
import { COUNTRIES, findCountry, flagUrl } from "@/lib/countries";
import { loadFlagImage, getFlagPalette } from "@/lib/flagImage";
import {
  unlockAudio,
  toggleMute,
  playShoot,
  playImpact,
  playKill,
  playLeak,
  playBuild,
  playUpgrade,
  playSell,
  playWaveStart,
  playCountdown,
  playWin,
  playLose,
} from "@/lib/game/audio";
import type { Enemy, Projectile, Tower, TowerType } from "@/lib/game/types";
import {
  GRID_COLS,
  GRID_ROWS,
  BASE_CELL,
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
  TOTAL_WAVES,
  resetEnemyIds,
  DIFFICULTY,
  type Difficulty,
} from "@/lib/game/waves";
import {
  moveEnemies,
  fireTowers,
  reapDead,
  ageProjectiles,
  resetProjectileIds,
} from "@/lib/game/engine";
import type { Particle } from "@/lib/game/particles";
import {
  spawnExplosion,
  spawnWisp,
  stepParticles,
  resetParticleSeed,
} from "@/lib/game/particles";

const START_GOLD = 200;
const START_LIVES = 10;
const BLOCKED = pathCells();
const PATH_LEN = pathLength();
const FIRST_WAVE_DELAY = 6; // seconds to build before the very first wave
const NEXT_WAVE_DELAY = 4; // seconds between waves (auto-start)

// Radial build menu: the 7 towers sit on a ring around the tapped tile, forming
// a donut with the placement spot open in the middle (tap outside or Esc to
// close). MENU_STEP is the ring radius; MENU_AROUND holds unit-circle offsets,
// clockwise from the top.
const MENU_STEP = 82;
const MENU_AROUND: [number, number][] = Array.from({ length: 7 }, (_, i) => {
  const a = -Math.PI / 2 + (i * Math.PI * 2) / 7;
  return [Math.cos(a), Math.sin(a)];
});

// Icons from the lucide-react library (bundled SVGs, no external requests).
const IC = "h-4 w-4 sm:h-5 sm:w-5";
const Icon = {
  Wave: () => <Waves className={IC} />,
  Coin: () => <Coins className={IC} />,
  Skull: () => <SkullIcon className={IC} />,
  Pause: () => <PauseIcon className={IC} />,
  Play: () => <PlayIcon className={IC} />,
  SoundOn: () => <Volume2 className={IC} />,
  SoundOff: () => <VolumeX className={IC} />,
  Gear: () => <Settings className={IC} />,
};

type Phase = "ready" | "wave" | "won" | "lost";

export default function Game({ code, onExit }: { code: string; onExit: () => void }) {
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
  const speedRef = useRef(1); // 1x / 2x / 3x fast-forward
  const pausedRef = useRef(false);
  const paletteRef = useRef<string[]>([]); // dominant flag colors (country theme)
  const countdownEndRef = useRef<number | null>(null); // performance.now() deadline for auto-start
  const shownCountdownRef = useRef<number | null>(null); // last countdown value pushed to HUD
  // live range/ghost preview drawn on the canvas while the honeycomb menu is open
  const previewRef = useRef<{ cell: { x: number; y: number }; type: TowerType } | null>(null);
  const particlesRef = useRef<Particle[]>([]); // smoke + sparks + embers

  // HUD state (updated from the loop only when a value changes)
  const [gold, setGold] = useState(START_GOLD);
  const [wave, setWave] = useState(1);
  const [kills, setKills] = useState(0); // total invaders terminated
  const killsRef = useRef(0);
  const [phase, setPhaseState] = useState<Phase>("ready");
  const [buildType, setBuildType] = useState<TowerType | null>("laser");
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>("Normal");
  const difficultyRef = useRef<Difficulty>("Normal");
  const [showSettings, setShowSettings] = useState(false);
  // honeycomb build menu: opened by tapping an empty buildable tile
  const [menu, setMenu] = useState<{
    col: number;
    row: number;
    left: number;
    top: number;
  } | null>(null);
  // display copy of the selected tower (+ its on-screen position so the upgrade
  // panel can sit right next to the tapped tower); the live tower lives in the ref
  const [selected, setSelected] = useState<{
    id: number;
    type: TowerType;
    level: number;
    left: number;
    top: number;
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
    // entering the "ready" lull arms the auto-start deadline and shows the FULL
    // delay right away, so the countdown reads 4..3..2..1 (not 3..2..1)
    if (p === "ready" && typeof performance !== "undefined") {
      const delay = waveRef.current === 1 ? FIRST_WAVE_DELAY : NEXT_WAVE_DELAY;
      countdownEndRef.current = performance.now() + delay * 1000;
      shownCountdownRef.current = delay;
      setCountdown(delay);
    } else {
      countdownEndRef.current = null;
      shownCountdownRef.current = null;
    }
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
    // arm the very first wave's auto-start (build time before invaders arrive)
    countdownEndRef.current = performance.now() + FIRST_WAVE_DELAY * 1000;
    loadFlagImage(code)
      .then(() => {
        paletteRef.current = getFlagPalette(code);
      })
      .catch(() => {});
    pool.current.slice(0, 30).forEach((c) => loadFlagImage(c.code).catch(() => {}));
  }, [code]);

  // ---- wave control ------------------------------------------------------
  const startWave = useCallback(() => {
    if (phaseRef.current !== "ready") return;
    const w = waveRef.current;
    const fresh = spawnWave(w, pool.current, 1.6, seedRef.current, DIFFICULTY[difficultyRef.current]);
    fresh.forEach((e) => loadFlagImage(e.code).catch(() => {}));
    enemies.current = fresh;
    countdownEndRef.current = null;
    shownCountdownRef.current = null;
    setCountdown(null);
    playWaveStart();
    setPhase("wave");
  }, []);

  const resetGame = useCallback(() => {
    resetEnemyIds();
    resetProjectileIds();
    resetParticleSeed();
    particlesRef.current = [];
    enemies.current = [];
    towers.current = [];
    projectiles.current = [];
    time.current = 0;
    nextTowerId.current = 1;
    seedRef.current = Math.floor(Math.random() * pool.current.length);
    goldRef.current = START_GOLD;
    livesRef.current = START_LIVES;
    waveRef.current = 1;
    killsRef.current = 0;
    setKills(0);
    setGold(START_GOLD);
    setWave(1);
    setSelected(null);
    setBuildType("laser");
    setMenu(null);
    previewRef.current = null;
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
      // fit the whole board inside the available box (both width AND height) so
      // the arena fills the screen without ever overflowing off the bottom
      const cw = parent.clientWidth;
      const ch = parent.clientHeight || cw * (GRID_ROWS / GRID_COLS);
      const cell = Math.max(
        24,
        Math.floor(Math.min(cw / GRID_COLS, ch / GRID_ROWS)),
      );
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

    // One fixed-size slice of simulation. Called once per frame at 1x and up to
    // 3 times per frame at 3x, so fast-forward stays accurate instead of taking
    // giant, collision-skipping steps.
    const stepWave = (dt: number) => {
      time.current += dt;
      const moved = moveEnemies(enemies.current, dt, time.current, PATH_LEN);
      enemies.current = moved.survivors;
      if (moved.leaked > 0) {
        livesRef.current = Math.max(0, livesRef.current - moved.leaked);
        playLeak();
      }
      const fired = fireTowers(towers.current, enemies.current, dt, time.current);
      if (fired.projectiles.length) {
        projectiles.current.push(...fired.projectiles);
        playShoot(fired.projectiles[0].type, time.current);
        playImpact(time.current);
      }
      // death puffs: capture everything about to be reaped for the explosions
      const killed = enemies.current.filter((e) => e.hp <= 0);
      const reaped = reapDead(enemies.current);
      enemies.current = reaped.survivors;
      if (reaped.gold > 0) {
        goldRef.current += reaped.gold;
        setGold(goldRef.current);
      }
      if (reaped.kills > 0) {
        playKill();
        killsRef.current += reaped.kills;
        setKills(killsRef.current);
        for (const e of killed) {
          spawnExplosion(particlesRef.current, e.pos.x, e.pos.y, "#f97316");
        }
      }

      projectiles.current = ageProjectiles(projectiles.current, dt);
      particlesRef.current = stepParticles(particlesRef.current, dt);

      if (livesRef.current <= 0) {
        playLose();
        setPhase("lost");
      } else if (enemies.current.length === 0) {
        const bonus = waveClearBonus(waveRef.current);
        goldRef.current += bonus;
        setGold(goldRef.current);
        if (waveRef.current >= TOTAL_WAVES) {
          playWin();
          setPhase("won");
        } else {
          waveRef.current += 1;
          setWave(waveRef.current);
          setPhase("ready");
        }
      }
    };

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      // paused: freeze the whole simulation (and hold the auto-start countdown),
      // but keep drawing so the frozen board still shows
      if (pausedRef.current) {
        if (countdownEndRef.current !== null) countdownEndRef.current += dt * 1000;
        draw(ctx, cellRef.current, {
          code,
          palette: paletteRef.current,
          time: now / 1000,
          enemies: enemies.current,
          towers: towers.current,
          projectiles: projectiles.current,
          particles: particlesRef.current,
          lives: livesRef.current,
          maxLives: START_LIVES,
          gameTime: time.current,
          selectedId: selectedIdRef.current,
          buildType: buildTypeRef.current,
          cursor: cursorRef.current,
          preview: previewRef.current,
        });
        raf = requestAnimationFrame(frame);
        return;
      }

      if (phaseRef.current === "wave") {
        for (let i = 0; i < speedRef.current; i++) {
          if (phaseRef.current !== "wave") break;
          stepWave(dt);
        }
      } else {
        projectiles.current = ageProjectiles(projectiles.current, dt);
        particlesRef.current = stepParticles(particlesRef.current, dt);
        // auto-start countdown during the "ready" lull
        if (phaseRef.current === "ready" && countdownEndRef.current !== null) {
          const remain = Math.max(0, Math.ceil((countdownEndRef.current - now) / 1000));
          if (remain !== shownCountdownRef.current) {
            shownCountdownRef.current = remain;
            setCountdown(remain);
            if (remain > 0 && remain <= 3) playCountdown();
          }
          if (now >= countdownEndRef.current) startWave();
        }
      }

      // the base smokes past half-health, then burns as it nears death
      const hurtFrac = 1 - livesRef.current / START_LIVES;
      if (hurtFrac > 0.5 && Math.random() < dt * (hurtFrac > 0.8 ? 12 : 5))
        spawnWisp(particlesRef.current, BASE_CELL.x, BASE_CELL.y - 0.35);
      if (hurtFrac > 0.8 && Math.random() < dt * 5)
        spawnExplosion(particlesRef.current, BASE_CELL.x, BASE_CELL.y - 0.4, "#f97316");

      draw(ctx, cellRef.current, {
        code,
        palette: paletteRef.current,
        time: now / 1000,
        enemies: enemies.current,
        towers: towers.current,
        projectiles: projectiles.current,
        particles: particlesRef.current,
        lives: livesRef.current,
        maxLives: START_LIVES,
        gameTime: time.current,
        selectedId: selectedIdRef.current,
        buildType: buildTypeRef.current,
        cursor: cursorRef.current,
        preview: previewRef.current,
      });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [code, startWave]);

  // ---- build / select ----------------------------------------------------
  // Core purchase: validate, place the tower, spend gold, ka-ching. Returns
  // whether it actually built (so callers can close the menu on success only).
  const buildAt = useCallback((col: number, row: number, type: TowerType): boolean => {
    if (!isBuildable(col, row, BLOCKED)) {
      flash("Can't build on the path");
      return false;
    }
    if (towers.current.some((t) => t.cell.x === col && t.cell.y === row)) return false;
    const cost = TOWER_DEFS[type].cost;
    if (goldRef.current < cost) {
      flash(`Need $${cost}`);
      return false;
    }
    towers.current.push({
      id: nextTowerId.current++,
      type,
      cell: { x: col, y: row },
      level: 1,
      cooldown: 0,
    });
    spendGold(cost);
    playBuild(); // ka-ching
    return true;
  }, []);

  const closeMenu = useCallback(() => {
    setMenu(null);
    previewRef.current = null;
  }, []);

  // Tap a tile: existing tower -> select it; empty buildable tile -> open the
  // honeycomb menu of towers to pick from; road -> reject.
  const onCanvasPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    unlockAudio();
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const cell = cellRef.current;
    cursorRef.current = null; // pointer play hides the keyboard cursor
    const col = Math.floor((e.clientX - rect.left) / cell);
    const row = Math.floor((e.clientY - rect.top) / cell);

    const existing = towers.current.find((t) => t.cell.x === col && t.cell.y === row);
    if (existing) {
      setSelected({
        id: existing.id,
        type: existing.type,
        level: existing.level,
        left: canvas.offsetLeft + (col + 0.5) * cell,
        top: canvas.offsetTop + row * cell,
      });
      closeMenu();
      return;
    }
    setSelected(null);
    if (!isBuildable(col, row, BLOCKED)) {
      flash("Can't build on the path");
      closeMenu();
      return;
    }
    // open the honeycomb centered on the tapped tile (coords within the arena wrapper)
    setMenu({
      col,
      row,
      left: canvas.offsetLeft + col * cell + cell / 2,
      top: canvas.offsetTop + row * cell + cell / 2,
    });
    previewRef.current = null;
  };

  // Keyboard play keeps the direct place-with-current-type flow.
  const selectOrBuild = useCallback(
    (col: number, row: number) => {
      unlockAudio();
      const existing = towers.current.find((t) => t.cell.x === col && t.cell.y === row);
      if (existing) {
        const cell = cellRef.current;
        const canvas = canvasRef.current;
        setSelected({
          id: existing.id,
          type: existing.type,
          level: existing.level,
          left: (canvas?.offsetLeft ?? 0) + (col + 0.5) * cell,
          top: (canvas?.offsetTop ?? 0) + row * cell,
        });
        return;
      }
      setSelected(null);
      const type = buildTypeRef.current;
      if (type) buildAt(col, row, type);
    },
    [buildAt],
  );

  // ---- keyboard: move a build cursor, place, and pick towers -------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phaseRef.current === "won" || phaseRef.current === "lost") return;
      unlockAudio();
      const digit = "1234567".indexOf(e.key);
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
        closeMenu();
        return;
      } else return;
      e.preventDefault();
      cursorRef.current = { x, y };
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectOrBuild, closeMenu]);

  const doUpgrade = () => {
    const id = selectedIdRef.current;
    const t = towers.current.find((x) => x.id === id);
    if (!t || t.level >= MAX_LEVEL) return;
    const cost = upgradeCost(t.type, t.level);
    if (goldRef.current < cost) return;
    t.level += 1;
    spendGold(cost);
    playUpgrade();
    setSelected((prev) => (prev ? { ...prev, level: t.level } : prev)); // keep position
  };
  const doSell = () => {
    const id = selectedIdRef.current;
    const t = towers.current.find((x) => x.id === id);
    if (!t) return;
    goldRef.current += sellValue(t.type, t.level);
    setGold(goldRef.current);
    playSell();
    towers.current = towers.current.filter((x) => x.id !== id);
    setSelected(null);
  };

  const cycleSpeed = () => {
    const next = speedRef.current >= 3 ? 1 : speedRef.current + 1;
    speedRef.current = next;
    setSpeed(next);
  };
  const onToggleMute = () => {
    unlockAudio();
    setMuted(toggleMute());
  };
  const togglePause = () => {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
  };

  // clean up the hint timer on unmount
  useEffect(() => () => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
  }, []);

  if (!country) return null;

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden bg-black text-white"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* top HUD - real icons, responsive (wraps on narrow screens) */}
      <div
        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 sm:px-4 sm:py-3"
        style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
      >
        {/* wave + auto-start countdown */}
        <span className="flex items-center gap-1.5 text-sm font-black text-cyan-400 sm:text-base" title="Wave">
          <Icon.Wave />
          {wave}/{TOTAL_WAVES}
          {phase === "ready" && countdown !== null && (
            <span className="font-bold text-white/70">· {countdown}s</span>
          )}
        </span>
        {/* gold + terminated */}
        <div className="flex items-center gap-3 sm:gap-4">
          <span className="flex items-center gap-1.5 text-sm font-black text-amber-300 sm:text-base" title="Gold">
            <Icon.Coin />
            {gold}
          </span>
          <span className="flex items-center gap-1.5 text-sm font-black text-white/85 sm:text-base" title="Terminated">
            <Icon.Skull />
            {kills}
          </span>
        </div>
        {/* controls */}
        <div className="flex items-center gap-3 sm:gap-4">
          <button
            onClick={() => setShowSettings(true)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 text-white/90 active:scale-95"
            aria-label="Settings"
          >
            <Icon.Gear />
          </button>
          <button
            onClick={cycleSpeed}
            className="flex h-9 min-w-9 items-center justify-center rounded-lg border border-white/15 px-2 text-sm font-black text-cyan-300 active:scale-95"
            aria-label={`Game speed ${speed} times, tap to change`}
          >
            {speed}x
          </button>
          <button
            onClick={onToggleMute}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 text-white/90 active:scale-95"
            aria-label={muted ? "Unmute sound" : "Mute sound"}
            aria-pressed={muted}
          >
            {muted ? <Icon.SoundOff /> : <Icon.SoundOn />}
          </button>
          <div
            className="h-7 w-10 rounded-md bg-cover bg-center ring-1 ring-white/30"
            style={{ backgroundImage: `url(${flagUrl(code)})` }}
            title={country.name}
            role="img"
            aria-label={`Defending ${country.name}`}
          />
        </div>
      </div>

      {/* settings panel: pause/resume + difficulty */}
      {showSettings && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onPointerDown={() => setShowSettings(false)}
        >
          <div
            className="w-full max-w-xs rounded-2xl border border-white/15 bg-neutral-900 p-5 text-center shadow-2xl"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-center gap-2 text-lg font-black">
              <Icon.Gear /> Settings
            </div>
            <button
              onClick={togglePause}
              className="mb-5 flex w-full items-center justify-center gap-2 rounded-lg bg-white/10 py-2.5 font-bold active:scale-95"
            >
              {paused ? <Icon.Play /> : <Icon.Pause />}
              {paused ? "Resume" : "Pause"}
            </button>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/50">
              Difficulty
            </div>
            <div className="mb-2 grid grid-cols-3 gap-2">
              {(["Easy", "Normal", "Hard"] as Difficulty[]).map((d) => (
                <button
                  key={d}
                  onClick={() => {
                    difficultyRef.current = d;
                    setDifficulty(d);
                  }}
                  className={`rounded-lg py-2 text-sm font-bold active:scale-95 ${
                    difficulty === d ? "bg-cyan-400 text-black" : "bg-white/10 text-white/80"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
            <p className="mb-5 text-[11px] text-white/45">
              Higher difficulty = tankier waves. Applies from the next wave.
            </p>
            <button
              onClick={() => {
                if (
                  typeof window === "undefined" ||
                  towers.current.length === 0 ||
                  window.confirm("Leave the battle and pick a new country? Progress will be lost.")
                ) {
                  onExit();
                }
              }}
              className="mb-2 w-full rounded-lg border border-white/20 py-2.5 text-sm font-bold text-white/80 active:scale-95"
            >
              Change country
            </button>
            <button
              onClick={() => setShowSettings(false)}
              className="w-full rounded-full bg-cyan-400 py-2.5 font-black text-black active:scale-95"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* arena - fills all remaining space; the board is fit to this box */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-1 sm:px-2">
        <div className="relative flex h-full w-full items-center justify-center">
          <canvas
            ref={canvasRef}
            onPointerDown={onCanvasPointer}
            role="img"
            aria-label="Battle map - tap an open tile to open the tower menu, tap a tower to upgrade it"
            className="block touch-none rounded-2xl ring-1 ring-white/10"
          />

          {/* square build menu: 8 tiles around the center (the tile you're placing
              on stays open in the middle so it is never covered) */}
          {menu && (
            <>
              <button
                aria-label="Close tower menu"
                onPointerDown={closeMenu}
                className="absolute inset-0 z-20 cursor-default"
              />
              <div className="absolute z-30" style={{ left: menu.left, top: menu.top }}>
                {/* center: the placement spot (non-interactive, kept clear) */}
                <div
                  className="pointer-events-none absolute h-[46px] w-[46px] rounded-full border-2 border-dashed border-white/70"
                  style={{ left: 0, top: 0, transform: "translate(-50%, -50%)" }}
                />
                {TOWER_ORDER.map((type, i) => {
                  const [ox, oy] = MENU_AROUND[i];
                  const d = TOWER_DEFS[type];
                  const afford = gold >= d.cost;
                  return (
                    <button
                      key={type}
                      disabled={!afford}
                      onPointerEnter={() => {
                        previewRef.current = { cell: { x: menu.col, y: menu.row }, type };
                      }}
                      onPointerLeave={() => {
                        previewRef.current = null;
                      }}
                      onClick={() => {
                        if (buildAt(menu.col, menu.row, type)) closeMenu();
                      }}
                      title={`${d.name} - $${d.cost}`}
                      className="absolute flex h-[54px] w-[54px] flex-col items-center justify-center gap-0.5 rounded-full border-2 shadow-lg transition active:scale-90 disabled:opacity-40"
                      style={{
                        left: ox * MENU_STEP,
                        top: oy * MENU_STEP,
                        transform: "translate(-50%, -50%)",
                        borderColor: d.color,
                        background: `radial-gradient(circle at 40% 30%, ${d.color}33, #0b0d12 88%)`,
                      }}
                    >
                      <span className="text-lg leading-none" style={{ color: d.color }}>
                        {d.icon}
                      </span>
                      <span className="text-[9px] font-bold leading-none text-amber-300">
                        ${d.cost}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* transient feedback banner for rejected taps */}
          {hint && (
            <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
              <span className="rounded-full bg-rose-500/90 px-4 py-1.5 text-sm font-semibold text-white shadow-lg">
                {hint}
              </span>
            </div>
          )}

          {/* upgrade / sell panel - floats right above the tapped tower */}
          {selected && (
            <div
              className="absolute z-40 -translate-x-1/2 -translate-y-full rounded-xl border border-white/15 bg-neutral-900/95 px-4 py-3 text-center shadow-xl"
              style={{ left: selected.left, top: selected.top - 6 }}
            >
              <div
                className="flex items-center justify-center gap-2 text-sm font-bold"
                style={{ color: TOWER_DEFS[selected.type].color }}
              >
                {TOWER_DEFS[selected.type].name}
                <span className="flex gap-0.5">
                  {Array.from({ length: MAX_LEVEL }, (_, i) => (
                    <svg
                      key={i}
                      viewBox="0 0 24 24"
                      className="h-3.5 w-3.5"
                      style={{
                        fill:
                          i < selected.level
                            ? TOWER_DEFS[selected.type].color
                            : "rgba(255,255,255,0.2)",
                      }}
                    >
                      <path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 18l-6 3.6 1.4-6.8L2.3 9.1l6.9-.8z" />
                    </svg>
                  ))}
                </span>
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={doUpgrade}
                  disabled={
                    selected.level >= MAX_LEVEL ||
                    gold < upgradeCost(selected.type, selected.level)
                  }
                  className="min-h-11 rounded-lg px-3 py-2 text-sm font-bold text-black disabled:opacity-40"
                  style={{ backgroundColor: TOWER_DEFS[selected.type].color }}
                >
                  {selected.level >= MAX_LEVEL
                    ? "Max level"
                    : `Upgrade $${upgradeCost(selected.type, selected.level)}`}
                </button>
                <button
                  onClick={doSell}
                  className="min-h-11 rounded-lg bg-rose-600 px-3 py-2 text-sm font-bold text-white"
                >
                  Sell ${sellValue(selected.type, selected.level)}
                </button>
              </div>
            </div>
          )}

          {/* win / lose overlay */}
          {(phase === "won" || phase === "lost") && (
            <div
              className={`absolute inset-0 flex flex-col items-center justify-center gap-4 rounded-2xl ${
                phase === "lost" ? "bg-black/45" : "bg-black/80 backdrop-blur-sm"
              }`}
            >
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

    </div>
  );
}

