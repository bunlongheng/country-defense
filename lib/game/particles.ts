// A tiny, allocation-light particle system for smoke + sparks. Positions and
// velocities are in TILE units (like everything else in the sim) so the renderer
// just multiplies by the cell size. State lives in the React component; these are
// pure helpers so the whole thing stays unit-testable and DOM-free.

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number; // tiles/sec
  life: number; // seconds elapsed
  ttl: number; // seconds to live
  size: number; // tiles
  kind: "smoke" | "spark";
  color: string; // spark color (smoke ignores this)
}

const MAX_PARTICLES = 400; // hard cap so a huge wave never floods the array

// Deterministic-enough jitter without Math.random, so replays are stable.
let seed = 1;
function rnd(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

export function resetParticleSeed() {
  seed = 1;
}

/** A death puff: a ball of smoke plus a few bright sparks in the enemy's color. */
export function spawnExplosion(list: Particle[], x: number, y: number, color: string) {
  for (let i = 0; i < 6; i++) {
    const a = rnd() * Math.PI * 2;
    list.push({
      x,
      y,
      vx: Math.cos(a) * (0.2 + rnd() * 0.4),
      vy: -0.5 - rnd() * 0.6, // smoke rises
      life: 0,
      ttl: 0.6 + rnd() * 0.6,
      size: 0.16 + rnd() * 0.16,
      kind: "smoke",
      color: "",
    });
  }
  for (let i = 0; i < 6; i++) {
    const a = rnd() * Math.PI * 2;
    const s = 1.2 + rnd() * 1.8;
    list.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - 0.4,
      life: 0,
      ttl: 0.3 + rnd() * 0.25,
      size: 0.04 + rnd() * 0.04,
      kind: "spark",
      color,
    });
  }
  cap(list);
}

/** A single wisp of smoke trailing off a wounded enemy. */
export function spawnWisp(list: Particle[], x: number, y: number) {
  list.push({
    x: x + (rnd() - 0.5) * 0.2,
    y: y - 0.1,
    vx: (rnd() - 0.5) * 0.2,
    vy: -0.4 - rnd() * 0.3,
    life: 0,
    ttl: 0.5 + rnd() * 0.4,
    size: 0.1 + rnd() * 0.1,
    kind: "smoke",
    color: "",
  });
  cap(list);
}

function cap(list: Particle[]) {
  if (list.length > MAX_PARTICLES) list.splice(0, list.length - MAX_PARTICLES);
}

/** Advance every particle; return the still-alive ones. */
export function stepParticles(list: Particle[], dt: number): Particle[] {
  const alive: Particle[] = [];
  for (const p of list) {
    p.life += dt;
    if (p.life >= p.ttl) continue;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.kind === "smoke") {
      p.vy -= dt * 0.25; // keeps drifting up
      p.vx *= 1 - dt; // spread slows
      p.size += dt * 0.4; // billows outward
    } else {
      p.vy += dt * 3; // sparks fall
    }
    alive.push(p);
  }
  return alive;
}
