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
  Radiation,
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
  playBoom,
  playNukeTick,
  playNukeStrike,
} from "@/lib/game/audio";
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
  TOTAL_WAVES,
  resetEnemyIds,
  DIFFICULTY,
  type Difficulty,
} from "@/lib/game/waves";
import { STAGES, TOTAL_STAGES, stageBase } from "@/lib/game/stages";
import {
  moveEnemies,
  fireTowers,
  stepBombs,
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
const NUKE_RADIUS = 3; // tiles wiped by the one-per-game nuke

// Deterministic confetti pieces (Math.sin hash so SSR/CSR agree, no random).
const CONFETTI_COLORS = ["#f87171", "#fb923c", "#facc15", "#4ade80", "#38bdf8", "#a78bfa", "#f472b6"];
const CONFETTI_GOLD = ["#fde047", "#facc15", "#f59e0b", "#fbbf24", "#fff7cc"];
const CONFETTI_PIECES = Array.from({ length: 48 }, (_, i) => {
  const r = (s: number) => {
    const n = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453;
    return n - Math.floor(n);
  };
  return {
    left: r(1) * 100,
    size: 5 + r(2) * 6,
    dur: 2.4 + r(3) * 2.4,
    delay: r(4) * 2.6,
    color: CONFETTI_COLORS[Math.floor(r(5) * CONFETTI_COLORS.length)],
    gold: CONFETTI_GOLD[Math.floor(r(6) * CONFETTI_GOLD.length)],
  };
});

function Confetti({ gold }: { gold: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-40 overflow-hidden rounded-2xl">
      {CONFETTI_PIECES.map((p, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            left: `${p.left}%`,
            top: 0,
            width: p.size,
            height: p.size * 1.7,
            borderRadius: 1,
            background: gold ? p.gold : p.color,
            animation: `confettiFall ${p.dur}s linear ${p.delay}s infinite`,
          }}
        />
      ))}
    </div>
  );
}
const FIRST_WAVE_DELAY = 6; // seconds to build before the very first wave
const NEXT_WAVE_DELAY = 4; // seconds between waves (auto-start)

// Radial build menu: the 8 towers sit on a ring around the tapped tile, forming
// a donut with the placement spot open in the middle (tap outside or Esc to
// close). MENU_STEP is the ring radius; MENU_AROUND holds unit-circle offsets,
// clockwise from the top.
const MENU_STEP = 82;
const MENU_AROUND: [number, number][] = Array.from({ length: 8 }, (_, i) => {
  const a = -Math.PI / 2 + (i * Math.PI * 2) / 8;
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

type Phase = "ready" | "wave" | "stageclear" | "won" | "lost";

// Pick black or white text so a themed button stays readable on any tower color
// (the dark gunmetal Bomb Thrower needs white; bright cyan/orange need black).
function readableOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum < 145 ? "#ffffff" : "#000000";
}

// A tower's accent color for text/stars ON the dark panel - lightened when the
// color itself is dark (the Bomb Thrower gunmetal) so it doesn't vanish.
function labelColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  if (0.299 * r + 0.587 * g + 0.114 * b >= 120) return hex;
  const mix = (c: number) => Math.round(c + (255 - c) * 0.55);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

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
  // stage journey: which of the 10 maps we're on + its derived path / blocked cells
  const stageRef = useRef(0); // 0-based index into STAGES
  const waypointsRef = useRef(STAGES[0].waypoints);
  const pathCellsRef = useRef<Set<string>>(pathCells(STAGES[0].waypoints)); // road tiles
  const noBuildRef = useRef<Set<string>>(new Set(STAGES[0].noBuild)); // water / lava
  const blockedRef = useRef<Set<string>>(new Set(pathCells(STAGES[0].waypoints))); // road + noBuild
  const pathLenRef = useRef(pathLength(STAGES[0].waypoints));
  const baseRef = useRef(stageBase(STAGES[0]));
  const hpMulRef = useRef(STAGES[0].hpMul);
  const [stage, setStage] = useState(0);
  const [confetti, setConfetti] = useState<"none" | "regular" | "gold">("none");
  // nuke: one strike per game. armed = picking a spot; target/count drive the reticle + countdown.
  const nukeArmedRef = useRef(false);
  const nukeTargetRef = useRef<{ x: number; y: number } | null>(null);
  const nukeAimRef = useRef<{ x: number; y: number } | null>(null); // pointer while aiming
  const nukeBlastRef = useRef<{ x: number; y: number; born: number } | null>(null); // warhead + cloud
  const [nukeUsed, setNukeUsed] = useState(false);
  const [nukeArmed, setNukeArmed] = useState(false);
  const [nukeCount, setNukeCount] = useState<number | null>(null); // 3/2/1 overlay
  const [nukeFlash, setNukeFlash] = useState(false);

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
    const fresh = spawnWave(
      w,
      pool.current,
      1.6,
      seedRef.current,
      DIFFICULTY[difficultyRef.current],
      waypointsRef.current,
      hpMulRef.current,
    );
    fresh.forEach((e) => loadFlagImage(e.code).catch(() => {}));
    enemies.current = fresh;
    countdownEndRef.current = null;
    shownCountdownRef.current = null;
    setCountdown(null);
    playWaveStart();
    setPhase("wave");
  }, []);

  // Point the game at a stage: derive its path, blocked cells, base and toughness.
  const applyStage = useCallback((idx: number) => {
    const st = STAGES[idx];
    stageRef.current = idx;
    waypointsRef.current = st.waypoints;
    const road = pathCells(st.waypoints);
    pathCellsRef.current = road;
    noBuildRef.current = new Set(st.noBuild);
    blockedRef.current = new Set([...road, ...st.noBuild]);
    pathLenRef.current = pathLength(st.waypoints);
    baseRef.current = stageBase(st);
    hpMulRef.current = st.hpMul;
    setStage(idx);
  }, []);

  // Wipe the board for a fresh defense (towers, gold, lives, wave, nuke). Does
  // NOT touch which stage we're on - callers set the stage first.
  const resetBoard = useCallback(() => {
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
    // fresh nuke for the new board
    nukeArmedRef.current = false;
    nukeTargetRef.current = null;
    nukeAimRef.current = null;
    nukeBlastRef.current = null;
    setNukeUsed(false);
    setNukeArmed(false);
    setNukeCount(null);
    setPhase("ready");
  }, []);

  // Restart the whole journey from stage 1.
  const resetGame = useCallback(() => {
    applyStage(0);
    setConfetti("none");
    resetBoard();
  }, [applyStage, resetBoard]);

  // Move on to the next stage: new map + scenery, fresh board, +10% tougher.
  const advanceStage = useCallback(() => {
    applyStage(stageRef.current + 1);
    setConfetti("none");
    resetBoard();
  }, [applyStage, resetBoard]);

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
      const moved = moveEnemies(enemies.current, dt, time.current, pathLenRef.current, waypointsRef.current);
      enemies.current = moved.survivors;
      if (moved.leaked > 0) {
        livesRef.current = Math.max(0, livesRef.current - moved.leaked);
        playLeak();
      }
      const fired = fireTowers(towers.current, enemies.current, dt, time.current);
      if (fired.projectiles.length) {
        projectiles.current.push(...fired.projectiles);
        // sound EACH distinct weapon that fired this frame (not just the first),
        // so every tower type is heard - a later-placed laser isn't silenced by
        // an earlier tower firing on the same frame
        const firedTypes = new Set(fired.projectiles.map((p) => p.type));
        for (const t of firedTypes) playShoot(t, time.current);
        playImpact(time.current);
      }
      // lobbed bombs: home onto their target and detonate on landing
      const booms = stepBombs(projectiles.current, enemies.current, dt);
      for (const bm of booms) {
        spawnExplosion(particlesRef.current, bm.x, bm.y, "#f97316");
        spawnExplosion(particlesRef.current, bm.x, bm.y, "#fde047");
        playBoom();
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
          // whole stage cleared
          if (stageRef.current >= TOTAL_STAGES - 1) {
            // final stage down -> CHAMPION of the journey
            playWin();
            setConfetti("gold");
            setPhase("won");
          } else {
            // celebrate this stage, then roll on to the next map
            playWin();
            setConfetti("regular");
            setPhase("stageclear");
            window.setTimeout(() => advanceStage(), 2600);
          }
        } else {
          waveRef.current += 1;
          setWave(waveRef.current);
          setPhase("ready");
        }
      }
    };

    // the nuke reticle to draw: the locked target during countdown, otherwise the
    // live aim point while the player is choosing where to strike
    const nukeRender = () => {
      const t = nukeTargetRef.current ?? (nukeArmedRef.current ? nukeAimRef.current : null);
      return t
        ? { x: t.x, y: t.y, radius: NUKE_RADIUS, armed: nukeArmedRef.current && !nukeTargetRef.current }
        : null;
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
          nuke: nukeRender(),
          nukeBlast: nukeBlastRef.current,
          stageId: STAGES[stageRef.current].id,
          scenery: STAGES[stageRef.current].scenery,
          waypoints: waypointsRef.current,
          pathSet: pathCellsRef.current,
          noBuild: noBuildRef.current,
          baseCell: baseRef.current,
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
        spawnWisp(particlesRef.current, baseRef.current.x, baseRef.current.y - 0.35);
      if (hurtFrac > 0.8 && Math.random() < dt * 5)
        spawnExplosion(particlesRef.current, baseRef.current.x, baseRef.current.y - 0.4, "#f97316");

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
        nuke: nukeRender(),
        nukeBlast: nukeBlastRef.current,
        stageId: STAGES[stageRef.current].id,
        scenery: STAGES[stageRef.current].scenery,
        waypoints: waypointsRef.current,
        pathSet: pathCellsRef.current,
        noBuild: noBuildRef.current,
        baseCell: baseRef.current,
      });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [code, startWave, advanceStage]);

  // ---- build / select ----------------------------------------------------
  // Core purchase: validate, place the tower, spend gold, ka-ching. Returns
  // whether it actually built (so callers can close the menu on success only).
  const buildAt = useCallback((col: number, row: number, type: TowerType): boolean => {
    if (!isBuildable(col, row, blockedRef.current)) {
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

  // ---- nuke: one strike per game -----------------------------------------
  // Wipe every enemy inside the blast crater, award their bounties, and throw a
  // big multi-burst explosion + screen flash.
  const detonateNuke = useCallback(() => {
    const t = nukeTargetRef.current;
    if (!t) return;
    let killed = 0;
    let gold = 0;
    const survivors: Enemy[] = [];
    for (const e of enemies.current) {
      if (e.dist >= 0 && Math.hypot(e.pos.x - t.x, e.pos.y - t.y) <= NUKE_RADIUS) {
        killed++;
        gold += e.reward;
        spawnExplosion(particlesRef.current, e.pos.x, e.pos.y, "#f97316");
      } else {
        survivors.push(e);
      }
    }
    enemies.current = survivors;
    // giant central blast across the crater
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const rr = (k % 3) * 0.9;
      spawnExplosion(
        particlesRef.current,
        t.x + Math.cos(a) * rr,
        t.y + Math.sin(a) * rr,
        k % 2 ? "#fde047" : "#f97316",
      );
    }
    if (gold > 0) {
      goldRef.current += gold;
      setGold(goldRef.current);
    }
    if (killed > 0) {
      killsRef.current += killed;
      setKills(killsRef.current);
    }
    playBoom(true);
    setNukeCount(null);
    nukeTargetRef.current = null;
    setNukeFlash(true);
    window.setTimeout(() => setNukeFlash(false), 380);
  }, []);

  // After the countdown: a warhead drops in (0.35s), then it detonates and the
  // mushroom cloud blooms + fades (~1.7s total).
  const launchNuke = useCallback(() => {
    const t = nukeTargetRef.current;
    if (!t) return;
    nukeBlastRef.current = { x: t.x, y: t.y, born: performance.now() / 1000 };
    setNukeCount(null);
    playNukeStrike(); // incoming whistle
    window.setTimeout(() => detonateNuke(), 350); // warhead lands -> boom
    window.setTimeout(() => {
      nukeBlastRef.current = null;
    }, 1750);
  }, [detonateNuke]);

  // Lock the target and run the 3-2-1 countdown, then launch the strike.
  const dropNukeAt = useCallback(
    (x: number, y: number) => {
      nukeArmedRef.current = false;
      setNukeArmed(false);
      nukeTargetRef.current = { x, y };
      setNukeUsed(true); // consumed the moment a spot is chosen
      setNukeCount(3);
      playNukeTick(3);
      window.setTimeout(() => {
        if (nukeTargetRef.current) { setNukeCount(2); playNukeTick(2); }
      }, 800);
      window.setTimeout(() => {
        if (nukeTargetRef.current) { setNukeCount(1); playNukeTick(1); }
      }, 1600);
      window.setTimeout(() => {
        if (nukeTargetRef.current) launchNuke();
      }, 2400);
    },
    [launchNuke],
  );

  // Arm targeting mode: the next tap on the arena drops the nuke there.
  const armNuke = useCallback(() => {
    unlockAudio();
    if (nukeUsed || nukeArmedRef.current || nukeTargetRef.current) return;
    setSelected(null);
    setMenu(null);
    previewRef.current = null;
    nukeAimRef.current = { x: GRID_COLS / 2 - 0.5, y: GRID_ROWS / 2 - 0.5 };
    nukeArmedRef.current = true;
    setNukeArmed(true);
    flash("Tap where to nuke");
  }, [nukeUsed]);

  // Track the aim point under the pointer while arming (drives the live reticle).
  const onCanvasMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!nukeArmedRef.current) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const cell = cellRef.current;
    nukeAimRef.current = {
      x: (e.clientX - rect.left) / cell - 0.5,
      y: (e.clientY - rect.top) / cell - 0.5,
    };
  };

  // Tap a tile: existing tower -> select it; empty buildable tile -> open the
  // honeycomb menu of towers to pick from; road -> reject.
  const onCanvasPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    unlockAudio();
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const cell = cellRef.current;
    // arming the nuke: this tap picks the strike spot instead of building
    if (nukeArmedRef.current) {
      dropNukeAt((e.clientX - rect.left) / cell - 0.5, (e.clientY - rect.top) / cell - 0.5);
      return;
    }
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
    if (!isBuildable(col, row, blockedRef.current)) {
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

  // ---- gamepad: play the whole game with a Bluetooth controller ----------
  // The pad drives the same tile cursor the keyboard uses. Handlers are refreshed
  // each render into a ref so the single polling loop always calls the latest
  // ones (no loop restarts, no stale closures).
  const noop = () => {};
  const padActionsRef = useRef<{
    move: (dx: number, dy: number) => void;
    confirm: () => void;
    cancel: () => void;
    upgrade: () => void;
    sell: () => void;
    tower: (dir: number) => void;
    nuke: () => void;
    speed: () => void;
    pause: () => void;
  }>({
    move: noop,
    confirm: noop,
    cancel: noop,
    upgrade: noop,
    sell: noop,
    tower: noop,
    nuke: noop,
    speed: noop,
    pause: noop,
  });
  useEffect(() => {
    padActionsRef.current = {
      move: (dx, dy) => {
        const cur = cursorRef.current ?? { x: 6, y: 4 };
        cursorRef.current = {
          x: Math.max(0, Math.min(GRID_COLS - 1, cur.x + dx)),
          y: Math.max(0, Math.min(GRID_ROWS - 1, cur.y + dy)),
        };
      },
      confirm: () => {
        unlockAudio();
        const cur = cursorRef.current ?? { x: 6, y: 4 };
        cursorRef.current = cur;
        if (nukeArmedRef.current) dropNukeAt(cur.x, cur.y);
        else selectOrBuild(cur.x, cur.y);
      },
      cancel: () => {
        if (nukeArmedRef.current) {
          nukeArmedRef.current = false;
          setNukeArmed(false);
        }
        setSelected(null);
        closeMenu();
      },
      upgrade: doUpgrade,
      sell: doSell,
      tower: (dir) => {
        const i = TOWER_ORDER.indexOf(buildTypeRef.current ?? "laser");
        setSelected(null);
        setBuildType(TOWER_ORDER[(i + dir + TOWER_ORDER.length) % TOWER_ORDER.length]);
      },
      nuke: armNuke,
      speed: cycleSpeed,
      pause: togglePause,
    };
  });

  useEffect(() => {
    if (typeof navigator === "undefined" || !("getGamepads" in navigator)) return;
    // No connect banner/badge by design - the pad just works silently, nothing
    // is ever overlaid on the UI. Polling getGamepads picks up the controller.
    let raf = 0;
    const prev: boolean[] = [];
    let moveCooldown = 0;
    let lastT = performance.now();
    const DEAD = 0.5;

    const poll = () => {
      const now = performance.now();
      const dt = now - lastT;
      lastT = now;
      const pads = navigator.getGamepads?.() ?? [];
      const gp = Array.from(pads).find(Boolean);
      if (gp) {
        const a = padActionsRef.current;
        const b = gp.buttons;
        const pressed = (i: number) => !!b[i]?.pressed;
        const rising = (i: number) => {
          const p = pressed(i);
          const r = p && !prev[i];
          prev[i] = p;
          return r;
        };
        // movement: d-pad (12-15) or left stick, with a repeat cooldown
        let dx = 0;
        let dy = 0;
        const ax = gp.axes[0] ?? 0;
        const ay = gp.axes[1] ?? 0;
        if (pressed(14) || ax < -DEAD) dx = -1;
        else if (pressed(15) || ax > DEAD) dx = 1;
        if (pressed(12) || ay < -DEAD) dy = -1;
        else if (pressed(13) || ay > DEAD) dy = 1;
        moveCooldown -= dt;
        if ((dx || dy) && moveCooldown <= 0) {
          a.move(dx, dy);
          moveCooldown = 160; // ms between steps while held
        } else if (!dx && !dy) {
          moveCooldown = 0; // move immediately on the next press
        }
        // action buttons (edge-triggered)
        if (rising(0)) a.confirm(); // A - place / select / drop nuke
        if (rising(1)) a.cancel(); // B - cancel / close
        if (rising(2)) a.tower(-1); // X - previous tower
        if (rising(3)) a.tower(1); // Y - next tower
        if (rising(4)) a.tower(-1); // LB - previous tower
        if (rising(5)) a.tower(1); // RB - next tower
        if (rising(6)) a.speed(); // LT - game speed
        if (rising(7)) a.upgrade(); // RT - upgrade selected
        if (rising(8)) a.sell(); // Back/Select - sell selected
        if (rising(9)) a.pause(); // Start - pause
        if (rising(16)) a.nuke(); // Guide/other - nuke (where present)
        // keep the rest of the button edges fresh so none get stuck
        for (let i = 0; i < b.length; i++) prev[i] = pressed(i);
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, []);

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
        {/* stage + wave + auto-start countdown */}
        <span
          className="flex items-center gap-1.5 rounded-md bg-white/5 px-2 py-0.5 text-xs font-black text-white/85 sm:text-sm"
          title="Stage"
        >
          S{stage + 1}/{TOTAL_STAGES}
          <span className="hidden font-bold text-white/55 sm:inline">· {STAGES[stage].name}</span>
        </span>
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
          {/* nuke: one strike per game */}
          {!nukeUsed && (
            <button
              onClick={armNuke}
              className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-black active:scale-95 ${
                nukeArmed
                  ? "animate-pulse border-rose-400 bg-rose-500/30 text-rose-100"
                  : "border-rose-500/60 bg-rose-600/20 text-rose-300"
              }`}
              aria-label="Nuke - one strike per game"
              title="Nuke (one strike per game)"
            >
              <Radiation className="h-4 w-4 sm:h-5 sm:w-5" />
              {nukeArmed ? "Tap map" : "NUKE"}
            </button>
          )}
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
            onPointerMove={onCanvasMove}
            role="img"
            aria-label="Battle map - tap an open tile to open the tower menu, tap a tower to upgrade it"
            className={`block touch-none rounded-2xl ring-1 ring-white/10 ${
              nukeArmed ? "cursor-crosshair" : ""
            }`}
          />

          {/* nuke: giant 3-2-1 countdown + a blinding detonation flash */}
          <style>{`
            @keyframes nukePop { 0%{transform:scale(.3);opacity:0} 28%{transform:scale(1.18);opacity:1} 100%{transform:scale(1);opacity:.92} }
            @keyframes nukeFlash { 0%{opacity:.9} 100%{opacity:0} }
            @keyframes confettiFall { 0%{transform:translateY(-30px) rotate(0deg);opacity:1} 100%{transform:translateY(95vh) rotate(720deg);opacity:.85} }
            @keyframes trophySpin { 0%{transform:rotateY(0deg) scale(1)} 50%{transform:rotateY(180deg) scale(1.08)} 100%{transform:rotateY(360deg) scale(1)} }
            @keyframes popIn { 0%{transform:scale(.4);opacity:0} 60%{transform:scale(1.1);opacity:1} 100%{transform:scale(1)} }
          `}</style>
          {nukeCount !== null && (
            <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center">
              <div
                key={nukeCount}
                className="font-black text-rose-500"
                style={{
                  fontSize: "22vh",
                  textShadow: "0 0 30px rgba(244,63,94,0.85)",
                  animation: "nukePop 0.7s ease-out",
                }}
              >
                {nukeCount}
              </div>
            </div>
          )}
          {nukeFlash && (
            <div
              className="pointer-events-none absolute inset-0 z-50 rounded-2xl bg-white"
              style={{ animation: "nukeFlash 0.38s ease-out forwards" }}
            />
          )}

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
                style={{ color: labelColor(TOWER_DEFS[selected.type].color) }}
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
                            ? labelColor(TOWER_DEFS[selected.type].color)
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
                  className="min-h-11 rounded-lg px-3 py-2 text-sm font-bold disabled:opacity-40"
                  style={{
                    backgroundColor: TOWER_DEFS[selected.type].color,
                    color: readableOn(TOWER_DEFS[selected.type].color),
                  }}
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

          {/* confetti: rainbow on a stage clear, gold on the championship */}
          {confetti !== "none" && <Confetti gold={confetti === "gold"} />}

          {/* between-stage celebration banner (auto-advances) */}
          {phase === "stageclear" && (
            <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center">
              <div
                style={{ animation: "popIn 0.5s ease-out" }}
                className="rounded-2xl bg-black/70 px-8 py-6 text-center backdrop-blur-sm"
              >
                <div className="text-4xl">🎉</div>
                <div className="mt-1 text-2xl font-black text-emerald-300">Stage {stage + 1} cleared!</div>
                <div className="mt-1 text-sm text-white/70">
                  Next up: {STAGES[Math.min(stage + 1, TOTAL_STAGES - 1)].name}
                </div>
              </div>
            </div>
          )}

          {/* CHAMPION: beat all 10 stages - spinning gold cup + golden podium */}
          {phase === "won" && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 rounded-2xl bg-gradient-to-b from-amber-900/85 to-black/90 backdrop-blur-sm">
              <div className="text-7xl" style={{ animation: "trophySpin 2.2s ease-in-out infinite" }}>
                🏆
              </div>
              <div className="text-3xl font-black text-amber-300" style={{ animation: "popIn 0.5s ease-out" }}>
                CHAMPION!
              </div>
              <div className="flex flex-col items-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={flagUrl(code)}
                  alt=""
                  className="h-12 w-16 rounded-md object-cover ring-2 ring-amber-300"
                />
                <div className="mt-1 text-lg font-black text-white">{country.name}</div>
                <div className="mt-1 h-3 w-40 rounded-b bg-gradient-to-b from-amber-300 to-amber-600" />
                <div className="h-6 w-28 rounded-b bg-gradient-to-b from-amber-400 to-amber-700" />
              </div>
              <div className="text-sm text-amber-100/80">You conquered all {TOTAL_STAGES} stages!</div>
              <button
                onClick={resetGame}
                className="mt-1 rounded-full bg-amber-300 px-6 py-3 font-black text-black active:scale-95"
              >
                Play again
              </button>
            </div>
          )}

          {/* defeat */}
          {phase === "lost" && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 rounded-2xl bg-black/55">
              <div className="text-5xl">💥</div>
              <div className="text-2xl font-black">{country.name} fell</div>
              <div className="text-sm text-white/60">
                Stage {stage + 1}, wave {wave}
              </div>
              <button
                onClick={resetGame}
                className="rounded-full bg-cyan-400 px-6 py-3 font-bold text-black active:scale-95"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

