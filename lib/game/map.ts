import type { Vec2 } from "./types.ts";

// The arena is a fixed grid of tiles. Enemies march along a fixed S-shaped path
// from the entry (left) to the base (right). Towers may be built on any tile the
// path does not occupy. Everything is in tile units.

export const GRID_COLS = 14;
export const GRID_ROWS = 9;

// Turn points of the path, as tile-center coordinates. The first and last points
// sit just off-grid so enemies slide in and the base sits at the final corner.
export const WAYPOINTS: Vec2[] = [
  { x: -1, y: 1 },
  { x: 11, y: 1 },
  { x: 11, y: 4 },
  { x: 2, y: 4 },
  { x: 2, y: 7 },
  { x: 13, y: 7 },
];

// The base (player's country) sits at the end of the path.
export const BASE_CELL: Vec2 = { x: 13, y: 7 };

const dist2 = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

/** Total path length in tiles. */
export function pathLength(waypoints: Vec2[] = WAYPOINTS): number {
  let total = 0;
  for (let i = 1; i < waypoints.length; i++) {
    total += dist2(waypoints[i - 1], waypoints[i]);
  }
  return total;
}

/** World position at a given distance along the path (clamped to the ends). */
export function pointAtDistance(
  d: number,
  waypoints: Vec2[] = WAYPOINTS,
): Vec2 {
  if (d <= 0) return { ...waypoints[0] };
  let remaining = d;
  for (let i = 1; i < waypoints.length; i++) {
    const seg = dist2(waypoints[i - 1], waypoints[i]);
    if (remaining <= seg) {
      const t = seg === 0 ? 0 : remaining / seg;
      return {
        x: waypoints[i - 1].x + (waypoints[i].x - waypoints[i - 1].x) * t,
        y: waypoints[i - 1].y + (waypoints[i].y - waypoints[i - 1].y) * t,
      };
    }
    remaining -= seg;
  }
  return { ...waypoints[waypoints.length - 1] };
}

/** All integer tiles the path corridor covers (used to block tower placement). */
export function pathCells(waypoints: Vec2[] = WAYPOINTS): Set<string> {
  const cells = new Set<string>();
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1];
    const b = waypoints[i];
    const steps = Math.ceil(dist2(a, b) * 4);
    for (let s = 0; s <= steps; s++) {
      const t = steps === 0 ? 0 : s / steps;
      const c = Math.round(a.x + (b.x - a.x) * t);
      const r = Math.round(a.y + (b.y - a.y) * t);
      if (c >= 0 && c < GRID_COLS && r >= 0 && r < GRID_ROWS) {
        cells.add(`${c},${r}`);
      }
    }
  }
  return cells;
}

export const cellKey = (c: number, r: number) => `${c},${r}`;

/** Is this tile a legal spot to build a tower on? */
export function isBuildable(
  c: number,
  r: number,
  blocked: Set<string>,
): boolean {
  if (c < 0 || c >= GRID_COLS || r < 0 || r >= GRID_ROWS) return false;
  return !blocked.has(cellKey(c, r));
}
