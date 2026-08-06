// Shared game types. Positions are in TILE units (not pixels) so the whole
// simulation is resolution-independent; the renderer multiplies by tile size.

export interface Vec2 {
  x: number;
  y: number;
}

export type TowerType =
  | "laser"
  | "cannon"
  | "frost"
  | "sniper"
  | "rapid"
  | "tesla"
  | "slime"
  | "bomber"
  | "roamer";

export interface Enemy {
  id: number;
  code: string; // country flag code
  name: string;
  maxHp: number;
  hp: number;
  speed: number; // tiles per second
  dist: number; // distance travelled along the path, in tiles
  reward: number;
  slowUntil: number; // game-time (s) until which the slow applies
  slowMul: number; // speed multiplier while slowed (1 = no slow)
  frozenUntil?: number; // game-time until which the enemy is frozen solid (frost)
  freezeImmuneUntil?: number; // after a thaw, frost can only slow (not re-freeze) until this time
  shockUntil?: number; // game-time until which to draw the tesla electric arc
  pos: Vec2; // cached world position, refreshed each step
}

export interface Tower {
  id: number;
  type: TowerType;
  cell: Vec2; // grid cell (integer col,row)
  level: number; // 1..MAX_LEVEL
  cooldown: number; // seconds until it can fire again
  aim?: number; // barrel angle (radians); tracks the current target, holds last on none
  pos?: Vec2; // free position for the white Line Laser (falls back to the cell centre)
}

export interface Projectile {
  id: number;
  from: Vec2;
  to: Vec2;
  targetId: number;
  type: TowerType;
  ttl: number; // seconds of visible life
  jitter: number; // deterministic bolt-offset seed for tesla arcs (-0.3..0.3)
  scale: number; // visual size multiplier from the firing tower's level (1 = lvl1)
  detonate?: boolean; // bomber lob: still live, kills its target on landing
}
