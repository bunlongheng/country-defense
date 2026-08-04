import type { Country } from "../countries.ts";
import type { Enemy } from "./types.ts";
import { pointAtDistance } from "./map.ts";

// 10 invaders per wave. Each wave they get tankier AND faster, so the player has
// to keep upgrading. Numbers are tuned to feel fair for a kid: winnable, but only
// if you spend your gold.

export const ENEMIES_PER_WAVE = 10;
export const TOTAL_WAVES = 12;

const BASE_HP = 34;
const BASE_SPEED = 0.9; // tiles/sec
const BASE_REWARD = 8;

export interface WaveStats {
  hp: number;
  speed: number;
  reward: number;
}

/** Difficulty for a given wave (1-indexed): +28% hp and +7% speed each wave. */
export function waveStats(wave: number): WaveStats {
  const w = Math.max(1, wave);
  return {
    hp: Math.round(BASE_HP * Math.pow(1.28, w - 1)),
    speed: +(BASE_SPEED * Math.pow(1.07, w - 1)).toFixed(3),
    reward: Math.round(BASE_REWARD + (w - 1) * 2),
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

/**
 * Build the 10 invaders for a wave. Countries are drawn from the pool (excluding
 * the player's own country) so each invader wears a real flag. Enemies are spaced
 * out behind the entry so they stream in rather than all appear at once.
 */
export function spawnWave(
  wave: number,
  pool: Country[],
  spacing = 1.6,
  seed = 0,
): Enemy[] {
  const stats = waveStats(wave);
  const enemies: Enemy[] = [];
  for (let i = 0; i < ENEMIES_PER_WAVE; i++) {
    const idx = ((seed + wave * 7 + i * 3) % pool.length + pool.length) % pool.length;
    const country = pool[idx];
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
