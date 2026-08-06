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
  Trophy,
} from "lucide-react";
import { COUNTRIES, findCountry, flagUrl } from "@/lib/countries";
import { loadFlagImage, getFlagPalette } from "@/lib/flagImage";
import FlagShatter3D from "./FlagShatter3D";
import FlagMarble3D from "./FlagMarble3D";
import { startGameMusic, stopGameMusic } from "@/lib/game/music";
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
import { draw, drawTower } from "@/lib/game/render";
import {
  spawnWave,
  waveClearBonus,
  TOTAL_WAVES,
  resetEnemyIds,
  DIFFICULTY,
  type Difficulty,
} from "@/lib/game/waves";
import { STAGES, TOTAL_STAGES, stageBase } from "@/lib/game/stages";
import { loadSprite } from "@/lib/game/sprites";
import {
  POINTS,
  saveScore,
  highScore,
  formatWhen,
  type ScoreEntry,
} from "@/lib/game/score";
import {
  moveEnemies,
  fireTowers,
  stepBombs,
  reapDead,
  ageProjectiles,
  resetProjectileIds,
  stepRoamers,
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

// Game-over score card: the run's final score, whether it's a new best, and the
// device's top-5 board with timestamps.
function ScorePanel({
  r,
}: {
  r: { final: number; prevBest: number; isBest: boolean; board: ScoreEntry[] };
}) {
  return (
    <div className="w-full max-w-xs rounded-xl bg-black/40 p-3 text-center ring-1 ring-white/10">
      <div className="text-3xl font-black text-white">{r.final.toLocaleString()}</div>
      <div className="text-[10px] font-medium uppercase tracking-widest text-white/45">Score</div>
      {r.isBest ? (
        <div className="mt-1 text-sm font-black text-white">🎉 New high score!</div>
      ) : (
        <div className="mt-1 text-xs text-white/55">Best {r.prevBest.toLocaleString()}</div>
      )}
      {r.board.length > 0 && (
        <div className="mt-3 space-y-1 text-left">
          {r.board.slice(0, 5).map((e, i) => {
            // older rows were saved before we stored the flag code - fall back to
            // resolving it from the country name so every row still gets a flag
            const fcode = e.code ?? COUNTRIES.find((c) => c.name === e.country)?.code;
            return (
            <div key={i} className="flex items-center gap-2 text-[11px]">
              <span className="w-3 text-white/35">{i + 1}</span>
              {fcode ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={flagUrl(fcode)}
                  alt=""
                  className="h-3 w-4 shrink-0 rounded-[2px] object-cover ring-1 ring-white/20"
                />
              ) : (
                <span className="h-3 w-4 shrink-0" />
              )}
              <span className="flex-1 truncate text-white/75">{e.country}</span>
              <span className="text-white/35">{formatWhen(e.date)}</span>
              <span className="w-12 text-right font-medium text-white">
                {e.score.toLocaleString()}
              </span>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

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
// close). The ring radius is computed per-open (responsive + edge-clamped);
// MENU_AROUND holds unit-circle offsets, clockwise from the top.
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

// A tiny live preview of the ACTUAL tower a build petal will place - the real
// drawn tank (plate + glossy dome + barrel + emblem), not just its ability icon,
// so you can see what you're getting. Static level-1 render (no flag until lvl3).
function TowerChip({ type }: { type: TowerType }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const S = 40;
    const cell = 52;
    cv.width = S * dpr;
    cv.height = S * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);
    drawTower(
      ctx,
      { x: S / 2, y: S / 2 + 2 },
      cell,
      { id: 0, type, cell: { x: 0, y: 0 }, level: 1, cooldown: 0 },
      "",
      0,
    );
  }, [type]);
  return <canvas ref={ref} className="h-[40px] w-[40px]" aria-hidden />;
}

export default function Game({ code, onExit }: { code: string; onExit: () => void }) {
  const country = findCountry(code);

  // battle music for the whole match (the menu already unlocked audio, so it just
  // starts); stops when we leave the game
  useEffect(() => {
    startGameMusic();
    return () => stopGameMusic();
  }, []);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseMarbleRef = useRef<HTMLDivElement>(null); // 3D flag marble pinned over the base tile

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
  const speedRef = useRef(1); // 1x .. 5x fast-forward
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
  const holdTimersRef = useRef<number[]>([]); // press-and-hold-the-road charge timers
  const [nukeUsed, setNukeUsed] = useState(false);
  const [nukeArmed, setNukeArmed] = useState(false);
  const [nukeCount, setNukeCount] = useState<number | null>(null); // 3/2/1 overlay
  const [nukeFlash, setNukeFlash] = useState(false);

  // HUD state (updated from the loop only when a value changes)
  const [gold, setGold] = useState(START_GOLD);
  const [wave, setWave] = useState(1);
  const [kills, setKills] = useState(0); // total invaders terminated
  const killsRef = useRef(0);
  const [score, setScore] = useState(0); // running score from kills + waves + stages
  const scoreRef = useRef(0);
  // end-of-game result: final score + how it stacks up + the top board (localStorage)
  const [result, setResult] = useState<{
    final: number;
    prevBest: number;
    isBest: boolean;
    board: ScoreEntry[];
  } | null>(null);
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
    left: number; // ring centre (clamped inside the arena so no petal goes off-screen)
    top: number;
    step: number; // ring radius (tighter on phones)
    dotX: number; // offset of the real placement tile from the ring centre
    dotY: number;
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
  // drag-to-relocate: the tower currently being dragged (grace period only)
  const dragRef = useRef<{
    id: number;
    type: TowerType;
    level: number;
    fromCol: number;
    fromRow: number;
    moved: boolean;
  } | null>(null);

  const goldRef = useRef(START_GOLD);
  const livesRef = useRef(START_LIVES);
  // one-time base shield: soaks the first invader that reaches the base for free
  // (no life lost), then pops - so the base survives 11 leaks instead of 10. The
  // white wavy bubble shows while it's up; the health bar hides until it pops.
  const shieldRef = useRef(true);
  const [shieldUp, setShieldUp] = useState(true);
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
    loadSprite("/towers/fx/slime_shot.png"); // generated toxic-orb projectile art
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
    // one free self-roaming Frost Rover per board, starting mid-map
    const rc = { x: Math.floor(GRID_COLS / 2), y: Math.floor(GRID_ROWS / 2) };
    towers.current.push({
      id: nextTowerId.current++,
      type: "roamer",
      cell: rc,
      level: 1,
      cooldown: 0,
      pos: { x: rc.x, y: rc.y },
      wander: { x: rc.x, y: rc.y },
    });
    seedRef.current = Math.floor(Math.random() * pool.current.length);
    goldRef.current = START_GOLD;
    livesRef.current = START_LIVES;
    shieldRef.current = true; // fresh shield each run
    setShieldUp(true);
    waveRef.current = 1;
    killsRef.current = 0;
    setKills(0);
    scoreRef.current = 0;
    setScore(0);
    setResult(null);
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
    holdTimersRef.current.forEach((id) => window.clearTimeout(id));
    holdTimersRef.current = [];
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

  // Tally the final score at game over (running score + a bonus for the lives and
  // the gold left over), record it on the device board, and stash the result.
  const finalizeScore = useCallback(
    (outcome: "won" | "lost") => {
      const final =
        scoreRef.current +
        livesRef.current * POINTS.lifePerLeft +
        goldRef.current * POINTS.goldPerLeft;
      const prevBest = highScore();
      const board = saveScore({
        score: final,
        date: Date.now(),
        outcome,
        stage: stageRef.current + 1,
        wave: waveRef.current,
        country: country?.name ?? code,
        code,
      });
      setResult({ final, prevBest, isBest: final > prevBest, board });
    },
    [code, country],
  );

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
        let leak = moved.leaked;
        if (shieldRef.current) {
          // the shield eats the first invader for free, then shatters
          shieldRef.current = false;
          setShieldUp(false);
          leak -= 1;
          spawnExplosion(particlesRef.current, baseRef.current.x, baseRef.current.y - 0.2, "#a5f3fc");
          spawnExplosion(particlesRef.current, baseRef.current.x, baseRef.current.y - 0.2, "#ffffff");
        }
        if (leak > 0) livesRef.current = Math.max(0, livesRef.current - leak);
        playLeak();
      }
      const fired = fireTowers(towers.current, enemies.current, dt, time.current, waypointsRef.current[0]);
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
        scoreRef.current += reaped.kills * POINTS.kill;
        setScore(scoreRef.current);
        for (const e of killed) {
          spawnExplosion(particlesRef.current, e.pos.x, e.pos.y, "#f97316");
        }
      }

      projectiles.current = ageProjectiles(projectiles.current, dt);
      particlesRef.current = stepParticles(particlesRef.current, dt);

      if (livesRef.current <= 0) {
        playLose();
        finalizeScore("lost");
        setPhase("lost");
      } else if (enemies.current.length === 0) {
        const bonus = waveClearBonus(waveRef.current);
        goldRef.current += bonus;
        setGold(goldRef.current);
        if (waveRef.current >= TOTAL_WAVES) {
          scoreRef.current += POINTS.stage; // a whole stage cleared
          setScore(scoreRef.current);
          // whole stage cleared
          if (stageRef.current >= TOTAL_STAGES - 1) {
            // final stage down -> CHAMPION of the journey
            playWin();
            setConfetti("gold");
            finalizeScore("won");
            setPhase("won");
          } else {
            // celebrate this stage, then roll on to the next map
            playWin();
            setConfetti("regular");
            setPhase("stageclear");
            window.setTimeout(() => advanceStage(), 2600);
          }
        } else {
          scoreRef.current += POINTS.wave; // a wave cleared
          setScore(scoreRef.current);
          waveRef.current += 1;
          setWave(waveRef.current);
          setPhase("ready");
        }
      }
    };

    // the nuke reticle to draw: the locked target during countdown, otherwise the
    // live aim point while the player is choosing where to strike
    const nukeRender = () => {
      const locked = nukeTargetRef.current;
      const t = locked ?? (nukeArmedRef.current ? nukeAimRef.current : null);
      return t
        ? {
            x: t.x,
            y: t.y,
            radius: NUKE_RADIUS,
            armed: nukeArmedRef.current && !locked,
            counting: !!locked, // target locked -> spinning portal + beam to the sky
          }
        : null;
    };

    // pin the 3D flag-marble overlay right over the base tile, matching the same
    // float/bob and size drawBase would have used for the 2D sphere it replaced
    const positionBase = (now: number) => {
      const el = baseMarbleRef.current;
      const canvas2 = canvasRef.current;
      if (!el || !canvas2) return;
      const cell = cellRef.current;
      const bc = baseRef.current;
      const t = now / 1000;
      const bob = Math.sin(t * 1.6) * cell * 0.07;
      const cx = (bc.x + 0.5) * cell;
      const cy = (bc.y + 0.5) * cell - cell * 0.12 - bob;
      const size = cell * 0.98; // container so the rendered sphere ~= the old 2D one
      // place it over the canvas regardless of how the canvas is centred/letterboxed:
      // canvas top-left in the overlay's offset-parent space, plus the base pixel
      const host = el.offsetParent as HTMLElement | null;
      const cr = canvas2.getBoundingClientRect();
      const hr = host?.getBoundingClientRect();
      const ox = cr.left - (hr?.left ?? 0);
      const oy = cr.top - (hr?.top ?? 0);
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.left = `${ox + cx - size / 2}px`;
      el.style.top = `${oy + cy - size / 2}px`;
      const over = phaseRef.current === "won" || phaseRef.current === "lost";
      el.style.opacity = over ? "0" : "1"; // the game-over overlay owns the death visual
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
          shield: shieldRef.current,
        });
        positionBase(now);
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

      // the self-roaming tank patrols every frame, wave or grace period alike
      stepRoamers(towers.current, dt, GRID_COLS, GRID_ROWS);

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
      positionBase(now);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [code, startWave, advanceStage, finalizeScore]);

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
    // face the enemy entry by default so a fresh tower already watches the entrance
    const entry = waypointsRef.current[0];
    towers.current.push({
      id: nextTowerId.current++,
      type,
      cell: { x: col, y: row },
      level: 1,
      cooldown: 0,
      aim: Math.atan2(entry.y - row, entry.x - col),
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

  // Press-and-hold the road for ~3s to call in the nuke right there. A short grace
  // period means a quick tap (used to close the build menu) never triggers it.
  const startNukeHold = useCallback(
    (x: number, y: number) => {
      const timers: number[] = [];
      timers.push(
        window.setTimeout(() => {
          nukeTargetRef.current = { x, y }; // shows the charging portal + beam here
          setNukeCount(3);
          playNukeTick(3);
          timers.push(window.setTimeout(() => { setNukeCount(2); playNukeTick(2); }, 850));
          timers.push(window.setTimeout(() => { setNukeCount(1); playNukeTick(1); }, 1700));
          timers.push(
            window.setTimeout(() => {
              setNukeUsed(true);
              holdTimersRef.current = [];
              launchNuke(); // warhead drops -> boom
            }, 2550),
          );
        }, 350),
      );
      holdTimersRef.current = timers;
    },
    [launchNuke],
  );

  // Finger lifted: if a hold was still charging, abort it (and treat it as a quick
  // tap = close the build menu).
  const onCanvasUp = () => {
    // finishing a drag-relocate: drop the tower on the ghost tile if it's open
    if (dragRef.current) {
      const drag = dragRef.current;
      dragRef.current = null;
      const ghost = previewRef.current;
      previewRef.current = null;
      const canvas = canvasRef.current;
      const cell = cellRef.current;
      if (drag.moved && ghost && canvas) {
        const { x: col, y: row } = ghost.cell;
        const t = towers.current.find((tw) => tw.id === drag.id);
        const taken = towers.current.some(
          (tw) => tw.id !== drag.id && tw.cell.x === col && tw.cell.y === row,
        );
        if (t && isBuildable(col, row, blockedRef.current) && !taken) {
          t.cell = { x: col, y: row };
          playUpgrade();
          setSelected({
            id: t.id,
            type: t.type,
            level: t.level,
            left: canvas.offsetLeft + (col + 0.5) * cell,
            top: canvas.offsetTop + row * cell,
          });
        } else {
          flash("Drop on an open tile");
        }
      }
      return;
    }
    if (!holdTimersRef.current.length) return;
    holdTimersRef.current.forEach((id) => window.clearTimeout(id));
    holdTimersRef.current = [];
    if (nukeTargetRef.current && !nukeBlastRef.current) {
      nukeTargetRef.current = null;
      setNukeCount(null);
    }
    setSelected(null);
    closeMenu();
  };

  // Track the aim point under the pointer while arming (drives the live reticle).
  const onCanvasMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // dragging a tower to relocate it: show a ghost of it under the pointer tile
    if (dragRef.current) {
      const rect = canvasRef.current!.getBoundingClientRect();
      const cell = cellRef.current;
      const col = Math.floor((e.clientX - rect.left) / cell);
      const row = Math.floor((e.clientY - rect.top) / cell);
      if (col !== dragRef.current.fromCol || row !== dragRef.current.fromRow) {
        dragRef.current.moved = true;
      }
      previewRef.current = { cell: { x: col, y: row }, type: dragRef.current.type };
      return;
    }
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
    const fx = (e.clientX - rect.left) / cell;
    const fy = (e.clientY - rect.top) / cell;
    const col = Math.floor(fx);
    const row = Math.floor(fy);
    const onRoad = !isBuildable(col, row, blockedRef.current);

    // HOLD-TO-NUKE: press and hold the road for ~3s to drop the one-per-game strike
    // right there (no more tapping the base). A quick tap on the road just closes
    // the menu - handled on pointer-up once the hold is aborted.
    if (onRoad && !nukeUsed && !nukeTargetRef.current) {
      startNukeHold(fx - 0.5, fy - 0.5);
      return;
    }

    // the roamer isn't on a fixed cell - select it by tapping near its live spot
    const tapTile = { x: fx - 0.5, y: fy - 0.5 };
    const roamer = towers.current.find(
      (t) =>
        t.type === "roamer" &&
        t.pos !== undefined &&
        Math.hypot(t.pos.x - tapTile.x, t.pos.y - tapTile.y) < 0.7,
    );
    if (roamer && roamer.pos) {
      setSelected({
        id: roamer.id,
        type: roamer.type,
        level: roamer.level,
        left: canvas.offsetLeft + (roamer.pos.x + 0.5) * cell,
        top: canvas.offsetTop + roamer.pos.y * cell,
      });
      closeMenu();
      return;
    }

    const existing = towers.current.find(
      (t) => t.type !== "roamer" && t.cell.x === col && t.cell.y === row,
    );
    if (existing) {
      setSelected({
        id: existing.id,
        type: existing.type,
        level: existing.level,
        left: canvas.offsetLeft + (col + 0.5) * cell,
        top: canvas.offsetTop + row * cell,
      });
      // grace period: pressing a tower picks it up so you can drag-drop it to a new
      // tile (a quick tap without moving just leaves it selected)
      if (phaseRef.current === "ready") {
        dragRef.current = {
          id: existing.id,
          type: existing.type,
          level: existing.level,
          fromCol: col,
          fromRow: row,
          moved: false,
        };
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      }
      closeMenu();
      return;
    }
    setSelected(null);
    // tapping the street when the nuke is already spent is just a silent click-out
    if (onRoad) {
      closeMenu();
      return;
    }
    // open the radial menu centred on the tapped tile, but keep the whole ring
    // inside the arena so no petal falls off-screen (esp. edge/corner tiles on a
    // phone). The ring is tighter on small screens.
    const step = Math.round(Math.max(74, Math.min(110, cell * 2)));
    const margin = step + 30; // ring radius + half a petal + breathing room
    const parent = canvas.parentElement!;
    const rawX = canvas.offsetLeft + col * cell + cell / 2;
    const rawY = canvas.offsetTop + row * cell + cell / 2;
    const clamp = (v: number, lo: number, hi: number) =>
      lo > hi ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi);
    const left = clamp(rawX, margin, parent.clientWidth - margin);
    const top = clamp(rawY, margin, parent.clientHeight - margin);
    setMenu({ col, row, left, top, step, dotX: rawX - left, dotY: rawY - top });
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
    const next = speedRef.current >= 5 ? 1 : speedRef.current + 1;
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
        {/* stage - white throughout, spelled out */}
        <span className="flex items-center gap-1.5 text-sm font-medium text-white sm:text-base" title="Stage">
          Stage {stage + 1}/{TOTAL_STAGES}
          <span className="hidden font-medium text-white/85 sm:inline">· {STAGES[stage].name}</span>
        </span>
        {/* gold + terminated */}
        <div className="flex items-center gap-3 sm:gap-4">
          <span className="flex items-center gap-1.5 text-sm font-medium text-amber-300 sm:text-base" title="Total gold">
            <Icon.Coin />
            {gold}
          </span>
          <span className="flex items-center gap-1.5 text-sm font-medium text-white sm:text-base" title="Total kills">
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
            className="flex h-9 min-w-9 items-center justify-center rounded-lg border border-white/15 px-2 text-sm font-medium text-white active:scale-95"
            aria-label={`Game speed ${speed} times, tap to change`}
          >
            {speed}x
          </button>
          <button
            onClick={togglePause}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 text-white/90 active:scale-95"
            aria-label={paused ? "Resume" : "Pause"}
            aria-pressed={paused}
          >
            {paused ? <Icon.Play /> : <Icon.Pause />}
          </button>
          <div className="flex items-center gap-1.5">
            <span className="max-w-[8rem] truncate text-sm font-medium text-white/90 sm:text-base">
              {country.name}
            </span>
            <div
              className="h-7 w-10 rounded-md bg-cover bg-center ring-1 ring-white/30"
              style={{ backgroundImage: `url(${flagUrl(code)})` }}
              title={country.name}
              role="img"
              aria-label={`Defending ${country.name}`}
            />
          </div>
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
              className="mb-3 flex w-full items-center justify-center gap-2 rounded-lg bg-white/10 py-2.5 font-bold active:scale-95"
            >
              {paused ? <Icon.Play /> : <Icon.Pause />}
              {paused ? "Resume" : "Pause"}
            </button>
            <button
              onClick={onToggleMute}
              className="mb-5 flex w-full items-center justify-center gap-2 rounded-lg bg-white/10 py-2.5 font-bold active:scale-95"
              aria-pressed={muted}
            >
              {muted ? <Icon.SoundOff /> : <Icon.SoundOn />}
              {muted ? "Sound off" : "Sound on"}
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
            onPointerUp={onCanvasUp}
            onPointerCancel={onCanvasUp}
            onPointerMove={onCanvasMove}
            role="img"
            aria-label="Battle map - tap an open tile to open the tower menu, tap a tower to upgrade it"
            className={`block touch-none rounded-2xl ring-1 ring-white/10 ${
              nukeArmed ? "cursor-crosshair" : ""
            }`}
          />

          {/* the home base's real 3D flag marble (same one as the country select),
              pinned over the base tile each frame; non-interactive so taps fall
              through to the arena canvas underneath */}
          {/* left/top/size are set imperatively each frame (positionBase); keeping
              them OUT of the JSX style stops React re-renders from resetting them */}
          <div ref={baseMarbleRef} className="pointer-events-none absolute left-0 top-0 z-10 h-0 w-0">
            <FlagMarble3D code={code} shield={shieldUp} />
          </div>

          {/* wave (bottom-left) + score (bottom-right) - split to the corners */}
          <div className="pointer-events-none absolute bottom-2 left-2 z-30 flex items-center gap-1.5 rounded-lg bg-black/45 px-2.5 py-1 text-sm font-medium text-white sm:text-base">
            <Icon.Wave />
            Wave {wave}/{TOTAL_WAVES}
            {phase === "ready" && countdown !== null && (
              <span className="text-white/70">· {countdown}s</span>
            )}
          </div>
          <div className="pointer-events-none absolute bottom-2 right-2 z-30 flex items-center gap-1.5 rounded-lg bg-black/45 px-2.5 py-1 text-sm font-medium text-white sm:text-base">
            <Trophy className={IC} />
            {score.toLocaleString()}
          </div>

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
                {/* the placement spot marker - sits on the REAL tapped tile even
                    when the ring has been shifted inward to stay on-screen */}
                <div
                  className="pointer-events-none absolute h-[46px] w-[46px] rounded-full border-2 border-dashed border-white/70"
                  style={{ left: menu.dotX, top: menu.dotY, transform: "translate(-50%, -50%)" }}
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
                        left: ox * menu.step,
                        top: oy * menu.step,
                        transform: "translate(-50%, -50%)",
                        borderColor: d.color,
                        background: `radial-gradient(circle at 40% 30%, ${d.color}33, #0b0d12 88%)`,
                      }}
                    >
                      <TowerChip type={type} />
                      <span className="text-[9px] font-medium leading-none text-amber-300">
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
                {selected.type !== "roamer" && (
                  <button
                    onClick={doSell}
                    className="min-h-11 rounded-lg bg-rose-600 px-3 py-2 text-sm font-bold text-white"
                  >
                    Sell ${sellValue(selected.type, selected.level)}
                  </button>
                )}
              </div>
              {phase === "ready" && selected.type !== "roamer" && (
                <div className="mt-2 text-[11px] text-white/50">Drag me to move</div>
              )}
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
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 overflow-y-auto rounded-2xl bg-gradient-to-b from-amber-900/85 to-black/90 py-6 backdrop-blur-sm">
              <div className="text-6xl" style={{ animation: "trophySpin 2.2s ease-in-out infinite" }}>
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
                  className="h-11 w-14 rounded-md object-cover ring-2 ring-amber-300"
                />
                <div className="mt-1 text-base font-black text-white">{country.name}</div>
                <div className="mt-1 h-2.5 w-36 rounded-b bg-gradient-to-b from-amber-300 to-amber-600" />
                <div className="h-5 w-24 rounded-b bg-gradient-to-b from-amber-400 to-amber-700" />
              </div>
              <div className="text-xs text-amber-100/80">You conquered all {TOTAL_STAGES} stages!</div>
              {result && <ScorePanel r={result} />}
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
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 overflow-y-auto rounded-2xl bg-gradient-to-b from-black/88 to-black/96 py-6 backdrop-blur-sm">
              <FlagShatter3D code={code} />
              <div className="text-2xl font-black">{country.name}</div>
              <div className="text-sm text-white/60">
                Stage {stage + 1}, wave {wave}
              </div>
              {result && <ScorePanel r={result} />}
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

