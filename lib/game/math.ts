import type { Vec2 } from "./types.ts";

// Tiny shared geometry/color helpers used across the simulation and renderer.
// Kept in one place so the Euclidean-distance helper is not re-declared per file.

export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** "#rrggbb" + alpha -> "rgba(r,g,b,a)" for canvas fills. */
export function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
