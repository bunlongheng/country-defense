import type { Country } from "../countries.ts";
import type { Enemy } from "./types.ts";
import { pointAtDistance } from "./map.ts";

// Every country invades exactly ONCE across the whole game. The pool (all
// countries except the player's) is shuffled and split evenly across the 10
// waves - ~19 invaders per wave, with the leftover countries arriving in the
// final wave. Each wave they get tankier AND faster, so keep upgrading.

export const TOTAL_WAVES = 10;

const BASE_HP = 34;
const BASE_SPEED = 0.9; // tiles/sec
// Small per-kill reward: waves now have ~19 invaders each, so a low bounty keeps
// gold reasonable and the game challenging instead of a runaway pile of cash.
const BASE_REWARD = 4;

export interface WaveStats {
  hp: number;
  speed: number;
  reward: number;
}

// Per-wave HP growth for each difficulty (speed grows +7%/wave regardless).
// Easy waves get a touch tankier each time; Hard nearly doubles the ramp.
export const DIFFICULTY = { Easy: 1.22, Normal: 1.38, Hard: 1.55 } as const;
export type Difficulty = keyof typeof DIFFICULTY;

/** Difficulty for a given wave (1-indexed): +hpGrowth hp and +7% speed each wave. */
export function waveStats(wave: number, hpGrowth: number = DIFFICULTY.Normal): WaveStats {
  const w = Math.max(1, wave);
  return {
    hp: Math.round(BASE_HP * Math.pow(hpGrowth, w - 1)),
    speed: +(BASE_SPEED * Math.pow(1.07, w - 1)).toFixed(3),
    reward: Math.round(BASE_REWARD + (w - 1) * 1),
  };
}

/** Gold awarded for clearing a whole wave, on top of per-kill rewards. */
export function waveClearBonus(wave: number): number {
  return 30 + wave * 10;
}

let nextId = 1;
export function resetEnemyIds() {
  nextId = 1;
}

// Small seeded PRNG so a given seed always produces the same shuffle (keeps the
// sim deterministic and unit-testable) while different seeds vary the lineup.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(arr: readonly T[], seed: number): T[] {
  const a = arr.slice();
  const rnd = mulberry32(seed + 1);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Split the whole pool across the 10 waves: floor(pool/10) countries per wave,
 * with the remainder tacked onto the last wave. Deterministic for a given seed.
 * Every country appears in exactly one wave.
 */
export function waveAssignments(pool: Country[], seed = 0): Country[][] {
  const shuffled = seededShuffle(pool, seed);
  const per = Math.floor(pool.length / TOTAL_WAVES);
  const groups: Country[][] = [];
  let idx = 0;
  for (let w = 0; w < TOTAL_WAVES; w++) {
    const count = w === TOTAL_WAVES - 1 ? pool.length - idx : per;
    groups.push(shuffled.slice(idx, idx + count));
    idx += count;
  }
  return groups;
}

/**
 * Build the invaders for a wave: this wave's slice of the shuffled pool, each a
 * distinct country (nobody invades twice). Enemies are spaced out behind the
 * entry so they stream in rather than all appear at once.
 */
export function spawnWave(
  wave: number,
  pool: Country[],
  spacing = 1.6,
  seed = 0,
  hpGrowth: number = DIFFICULTY.Normal,
): Enemy[] {
  const stats = waveStats(wave, hpGrowth);
  const groups = waveAssignments(pool, seed);
  const w = Math.max(1, Math.min(TOTAL_WAVES, wave));
  const countries = groups[w - 1] ?? [];
  const enemies: Enemy[] = [];
  for (let i = 0; i < countries.length; i++) {
    const country = countries[i];
    const dist = -i * spacing; // staggered behind the entry
    enemies.push({
      id: nextId++,
      code: country.code,
      name: country.name,
      maxHp: stats.hp,
      hp: stats.hp,
      speed: stats.speed,
      dist,
      reward: stats.reward,
      slowUntil: 0,
      slowMul: 1,
      pos: pointAtDistance(Math.max(0, dist)),
    });
  }
  return enemies;
}
