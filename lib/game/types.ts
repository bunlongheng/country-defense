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
  | "tesla";

export interface Enemy {
  id: number;
  code: string; // country flag code
  name: string;
  maxHp: number;
  hp: number;
  speed: number; // tiles per second
  dist: number; // distance travelled along the path, in tiles
  reward: number;
  slowUntil: number; // game-time (s) until which the frost slow applies
  slowMul: number; // speed multiplier while slowed (1 = no slow)
  pos: Vec2; // cached world position, refreshed each step
}

export interface Tower {
  id: number;
  type: TowerType;
  cell: Vec2; // grid cell (integer col,row)
  level: number; // 1..MAX_LEVEL
  cooldown: number; // seconds until it can fire again
}

export interface Projectile {
  id: number;
  from: Vec2;
  to: Vec2;
  targetId: number;
  type: TowerType;
  ttl: number; // seconds of visible life
}
