import type { Enemy, Tower, TowerType, Vec2 } from "./types.ts";
import { dist } from "./math.ts";

export const MAX_LEVEL = 3;

export interface TowerDef {
  type: TowerType;
  name: string;
  blurb: string;
  color: string; // primary accent color
  icon: string; // single glyph for the HUD button
  cost: number; // build cost
  range: number; // tiles
  damage: number; // per shot (per tick for laser)
  fireRate: number; // shots per second
  splash: number; // aoe radius in tiles (0 = single target)
  slow: number; // 0..1 speed multiplier applied to hit enemies (0 = none)
  chain: number; // extra targets hit besides the primary (tesla)
}

// Six distinct tower styles. Each has a clear role so upgrading the right mix
// matters as waves get tankier and faster.
export const TOWER_DEFS: Record<TowerType, TowerDef> = {
  laser: {
    type: "laser",
    name: "Laser",
    blurb: "Steady beam, fires fast",
    color: "#22d3ee",
    icon: "◉",
    cost: 40,
    range: 2.6,
    damage: 7,
    fireRate: 5,
    splash: 0,
    slow: 0,
    chain: 0,
  },
  cannon: {
    type: "cannon",
    name: "Cannon",
    blurb: "Splash blast, hits a group",
    color: "#f97316",
    icon: "●",
    cost: 70,
    range: 2.4,
    damage: 26,
    fireRate: 0.9,
    splash: 1.3,
    slow: 0,
    chain: 0,
  },
  frost: {
    type: "frost",
    name: "Frost",
    blurb: "Slows enemies to a crawl",
    color: "#60a5fa",
    icon: "❄",
    cost: 55,
    range: 2.4,
    damage: 5,
    fireRate: 1.6,
    splash: 0,
    slow: 0.45,
    chain: 0,
  },
  sniper: {
    type: "sniper",
    name: "Sniper",
    blurb: "Very long range, big hits",
    color: "#a78bfa",
    icon: "⌖",
    cost: 90,
    range: 6,
    damage: 55,
    fireRate: 0.6,
    splash: 0,
    slow: 0,
    chain: 0,
  },
  rapid: {
    type: "rapid",
    name: "Rapid",
    blurb: "Machine-fast, short range",
    color: "#f472b6",
    icon: "✦",
    cost: 60,
    range: 2,
    damage: 6,
    fireRate: 9,
    splash: 0,
    slow: 0,
    chain: 0,
  },
  tesla: {
    type: "tesla",
    name: "Tesla",
    blurb: "Lightning arcs to many foes",
    color: "#facc15",
    icon: "⚡",
    cost: 100,
    range: 2.8,
    damage: 18,
    fireRate: 1.4,
    splash: 0,
    slow: 0,
    chain: 3,
  },
};

export const TOWER_ORDER: TowerType[] = [
  "laser",
  "rapid",
  "frost",
  "cannon",
  "tesla",
  "sniper",
];

// There are only 6 types x 3 levels = 18 possible stat blocks, and towerStats is
// called several times per tower per frame, so memoize into a small lookup built
// lazily once instead of allocating a fresh spread object on every call.
const STATS_CACHE = new Map<string, TowerDef>();

/** Per-level stat multiplier: +45% damage and +12% range per level above 1. */
export function towerStats(type: TowerType, level: number): TowerDef {
  const lv = Math.max(1, Math.min(MAX_LEVEL, level));
  const key = `${type}${lv}`;
  const cached = STATS_CACHE.get(key);
  if (cached) return cached;

  const base = TOWER_DEFS[type];
  const dmgMul = 1 + 0.45 * (lv - 1);
  const rangeMul = 1 + 0.12 * (lv - 1);
  const rateMul = 1 + 0.15 * (lv - 1);
  const stats: TowerDef = {
    ...base,
    damage: Math.round(base.damage * dmgMul),
    range: +(base.range * rangeMul).toFixed(2),
    fireRate: +(base.fireRate * rateMul).toFixed(2),
    chain: base.chain > 0 ? base.chain + (lv - 1) : 0,
  };
  STATS_CACHE.set(key, stats);
  return stats;
}

/** Cost to upgrade from the given current level to the next. */
export function upgradeCost(type: TowerType, level: number): number {
  const base = TOWER_DEFS[type].cost;
  return Math.round(base * (0.8 + level * 0.7));
}

/** Refund for selling: 60% of everything sunk into the tower. */
export function sellValue(type: TowerType, level: number): number {
  let total = TOWER_DEFS[type].cost;
  for (let lv = 1; lv < level; lv++) total += upgradeCost(type, lv);
  return Math.round(total * 0.6);
}

export const towerCenter = (t: Tower): Vec2 => ({
  x: t.cell.x,
  y: t.cell.y,
});

/**
 * Choose the primary target for a tower: the enemy in range that is furthest
 * along the path (closest to the base), which is the classic, most useful rule.
 * Returns null if nothing is in range.
 */
export function pickTarget(
  tower: Tower,
  enemies: Enemy[],
): Enemy | null {
  const stats = towerStats(tower.type, tower.level);
  const center = towerCenter(tower);
  let best: Enemy | null = null;
  for (const e of enemies) {
    if (e.hp <= 0) continue;
    if (dist(center, e.pos) > stats.range) continue;
    if (!best || e.dist > best.dist) best = e;
  }
  return best;
}

/** Enemies caught in a splash/chain around a point (excluding the primary). */
export function enemiesInRadius(
  center: Vec2,
  radius: number,
  enemies: Enemy[],
  excludeId: number,
): Enemy[] {
  return enemies.filter(
    (e) =>
      e.id !== excludeId &&
      e.hp > 0 &&
      dist(center, e.pos) <= radius,
  );
}
