import type { Enemy, Tower, TowerType, Vec2 } from "./types.ts";
import { dist } from "./math.ts";

export const MAX_LEVEL = 5;

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
    damage: 6,
    fireRate: 2.7, // cheapest tower: modest damage, moderate cadence
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
    damage: 22,
    fireRate: 0.8,
    splash: 1.3,
    slow: 0,
    chain: 0,
  },
  frost: {
    type: "frost",
    name: "Water",
    blurb: "Water blast that splashes, slows and freezes foes",
    color: "#60a5fa",
    icon: "❄",
    cost: 55,
    range: 2.4,
    damage: 0, // pure crowd control - freezes, never damages
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
    damage: 46,
    fireRate: 0.33, // ~1 shot every 3s - a slow, hard-hitting sniper
    splash: 0,
    slow: 0,
    chain: 0,
  },
  rapid: {
    type: "rapid",
    name: "Smoke",
    blurb: "Fast puffs of smoke that choke and slow foes",
    color: "#f472b6",
    icon: "✦",
    cost: 60,
    range: 2,
    damage: 3, // small damage per puff; its job is the slow, and it fires fast
    fireRate: 4,
    splash: 0,
    slow: 0.25, // the smoke chokes enemies - a mild lingering slow
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
    damage: 15,
    fireRate: 1.2,
    splash: 0,
    slow: 0,
    chain: 3,
  },
  slime: {
    type: "slime",
    name: "Slime",
    blurb: "Gooey blobs, sticks and slows, no damage",
    color: "#84cc16",
    icon: "🟢",
    cost: 65,
    range: 2.5,
    damage: 0, // pure crowd control - slows, never damages
    fireRate: 1.3,
    splash: 0.9, // the goo splatters onto nearby foes
    slow: 0.6, // stickiest slow in the game
    chain: 0,
  },
  bomber: {
    type: "bomber",
    name: "Bomb Thrower",
    blurb: "Lobs a bomb that ends any country, no matter its health",
    color: "#556072", // a dark gunmetal tank - reads "black" but stays visible so
    // its size grows are easy to see when upgrading (pure black vanished on the map)
    icon: "💣",
    cost: 130, // pricey: an instant kill on a slow fuse
    range: 3,
    damage: 99999, // one bomb ends whoever it lands on, ignoring the health bar
    fireRate: 0.2, // one bomb every 5s at lvl1 (tightens with upgrades, see towerStats)
    splash: 0, // it targets one country; the blast radius is handled on landing
    slow: 0,
    chain: 0,
  },
  // the special white LINE LASER: given free at the start, it stays where you put it
  // and fires a white beam straight across the whole screen at its row, hitting every
  // enemy in that horizontal line (handled in fireTowers). You can reposition it at
  // any time - it's special.
  roamer: {
    type: "roamer",
    name: "Line Laser",
    blurb: "A stationary beam tank: fires a white laser straight across its whole row",
    color: "#eef2f7", // near-white
    icon: "—",
    cost: 0, // free - you start with one
    range: 30, // effectively the whole screen (the beam spans full width)
    damage: 16, // per shot, to EVERY enemy in the beam's row
    fireRate: 1.2,
    splash: 0,
    slow: 0,
    chain: 0,
  },
};

export const TOWER_ORDER: TowerType[] = [
  "laser",
  "rapid",
  "frost",
  "slime",
  "cannon",
  "tesla",
  "sniper",
  "bomber",
];

// There are only 7 types x 5 levels = 35 possible stat blocks, and towerStats is
// called several times per tower per frame, so memoize into a small lookup built
// lazily once instead of allocating a fresh spread object on every call.
const STATS_CACHE = new Map<string, TowerDef>();

/**
 * Per-level stat multiplier: +38% damage and +14% range per level above 1.
 * Fire rate creeps up only +10%/level so a maxed tower is stronger but never an
 * unstoppable machine gun - upgrades stay meaningful without trivializing waves.
 */
export function towerStats(type: TowerType, level: number): TowerDef {
  const lv = Math.max(1, Math.min(MAX_LEVEL, level));
  const key = `${type}${lv}`;
  const cached = STATS_CACHE.get(key);
  if (cached) return cached;

  const base = TOWER_DEFS[type];
  // every level: +38% damage, +14% range, +10% fire rate (all three grow)
  const dmgMul = 1 + 0.38 * (lv - 1);
  const rangeMul = 1 + 0.14 * (lv - 1);
  const rateMul = 1 + 0.1 * (lv - 1);
  // the sniper has a fixed per-level cadence, tightening 3s -> 1.5s across the 5
  // levels (kept slow so even a maxed sniper is a hard hitter, not a machine gun)
  const SNIPER_RATE = [1 / 3, 1 / 2.6, 1 / 2.2, 1 / 1.8, 1 / 1.5];
  // the bomb thrower reloads slowly: one instant-kill bomb every 5s, shaving ~1s
  // per upgrade down to every 2s (never faster - an instant kill must stay rare)
  const BOMBER_RATE = [1 / 5, 1 / 4, 1 / 3, 1 / 2.5, 1 / 2];
  const fireRate =
    type === "sniper"
      ? SNIPER_RATE[lv - 1]
      : type === "bomber"
        ? BOMBER_RATE[lv - 1]
        : +(base.fireRate * rateMul).toFixed(2);
  const stats: TowerDef = {
    ...base,
    damage: Math.round(base.damage * dmgMul),
    range: +(base.range * rangeMul).toFixed(2),
    fireRate,
    chain: base.chain > 0 ? base.chain + (lv - 1) : 0,
  };
  STATS_CACHE.set(key, stats);
  return stats;
}

/** Cost to upgrade from the given current level to the next. */
export function upgradeCost(type: TowerType, level: number): number {
  // the roamer is free to own but pricey to upgrade (it maneuvers), so anchor its
  // upgrade curve to a stiff notional base instead of its 0 build cost
  const base = type === "roamer" ? 160 : TOWER_DEFS[type].cost;
  return Math.round(base * (0.8 + level * 0.7));
}

/** Refund for selling: 60% of everything sunk into the tower. */
export function sellValue(type: TowerType, level: number): number {
  let total = TOWER_DEFS[type].cost;
  for (let lv = 1; lv < level; lv++) total += upgradeCost(type, lv);
  return Math.round(total * 0.6);
}

// The roamer fights from its live drifting position; fixed towers from their cell.
export const towerCenter = (t: Tower): Vec2 => t.pos ?? { x: t.cell.x, y: t.cell.y };

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
