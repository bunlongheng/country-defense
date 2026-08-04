import type { Enemy, Projectile, Tower } from "./types.ts";
import { dist } from "./math.ts";
import { pathLength, pointAtDistance } from "./map.ts";
import {
  enemiesInRadius,
  pickTarget,
  towerCenter,
  towerStats,
} from "./towers.ts";

// Pure simulation helpers. The React component owns the requestAnimationFrame
// loop and simply calls these each frame; keeping them free of DOM/time-of-day
// side effects makes the whole game unit-testable.

export const FROST_DURATION = 1.2; // seconds a slow lasts after the last hit

export interface MoveResult {
  survivors: Enemy[];
  leaked: number; // how many reached the base this step
}

/**
 * Advance every enemy along the path. Slowed enemies move at their reduced
 * speed until slowUntil expires. Enemies that pass the end of the path are
 * removed and counted as leaks (each costs the player a life).
 */
export function moveEnemies(
  enemies: Enemy[],
  dt: number,
  time: number,
  pathLen = pathLength(),
): MoveResult {
  const survivors: Enemy[] = [];
  let leaked = 0;
  for (const e of enemies) {
    const mul = time < e.slowUntil ? e.slowMul : 1;
    e.dist += e.speed * mul * dt;
    if (e.dist >= pathLen) {
      leaked++;
      continue;
    }
    e.pos = pointAtDistance(Math.max(0, e.dist));
    survivors.push(e);
  }
  return { survivors, leaked };
}

let projId = 1;
export function resetProjectileIds() {
  projId = 1;
}

export interface FireResult {
  projectiles: Projectile[];
}

/**
 * Tick every tower's cooldown and let ready towers fire at the best target in
 * range. Damage is hitscan (applied immediately); the returned projectiles are
 * purely visual tracers. Handles splash (cannon), chain (tesla) and slow (frost).
 */
export function fireTowers(
  towers: Tower[],
  enemies: Enemy[],
  dt: number,
  time: number,
): FireResult {
  const projectiles: Projectile[] = [];
  for (const tower of towers) {
    tower.cooldown -= dt;
    if (tower.cooldown > 0) continue;
    const target = pickTarget(tower, enemies);
    if (!target) continue;

    const stats = towerStats(tower.type, tower.level);
    tower.cooldown = 1 / stats.fireRate;
    const from = towerCenter(tower);

    // primary hit
    applyHit(target, stats.damage, stats.slow, time);
    projectiles.push({
      id: projId,
      from,
      to: { ...target.pos },
      targetId: target.id,
      type: tower.type,
      ttl: tower.type === "laser" ? 0.08 : 0.18,
      jitter: boltJitter(projId++),
    });

    // cannon splash: everyone near the target takes the hit too
    if (stats.splash > 0) {
      for (const e of enemiesInRadius(target.pos, stats.splash, enemies, target.id)) {
        applyHit(e, Math.round(stats.damage * 0.6), stats.slow, time);
      }
    }

    // tesla chain: lightning arcs to nearby foes for reduced damage
    if (stats.chain > 0) {
      const arcs = enemiesInRadius(target.pos, stats.range, enemies, target.id)
        .sort((a, b) => dist(target.pos, a.pos) - dist(target.pos, b.pos))
        .slice(0, stats.chain);
      let prev = target.pos;
      for (const e of arcs) {
        applyHit(e, Math.round(stats.damage * 0.7), stats.slow, time);
        projectiles.push({
          id: projId,
          from: prev,
          to: { ...e.pos },
          targetId: e.id,
          type: "tesla",
          ttl: 0.12,
          jitter: boltJitter(projId++),
        });
        prev = e.pos;
      }
    }
  }
  return { projectiles };
}

// Deterministic per-projectile bolt offset (-0.3..0.3) so tesla arcs look jagged
// but never re-randomize every frame (which tied flicker speed to refresh rate).
function boltJitter(id: number): number {
  return (((id * 9301 + 49297) % 233280) / 233280 - 0.5) * 0.6;
}

function applyHit(enemy: Enemy, damage: number, slow: number, time: number) {
  enemy.hp -= damage;
  if (slow > 0) {
    enemy.slowMul = 1 - slow;
    enemy.slowUntil = time + FROST_DURATION;
  }
}

export interface ReapResult {
  survivors: Enemy[];
  gold: number; // total reward from enemies killed this step
  kills: number;
}

/** Remove dead enemies and tally the gold their bounties pay out. */
export function reapDead(enemies: Enemy[]): ReapResult {
  const survivors: Enemy[] = [];
  let gold = 0;
  let kills = 0;
  for (const e of enemies) {
    if (e.hp <= 0) {
      gold += e.reward;
      kills++;
    } else {
      survivors.push(e);
    }
  }
  return { survivors, gold, kills };
}

/** Age visual projectiles and drop the expired ones. */
export function ageProjectiles(projectiles: Projectile[], dt: number): Projectile[] {
  const alive: Projectile[] = [];
  for (const p of projectiles) {
    p.ttl -= dt;
    if (p.ttl > 0) alive.push(p);
  }
  return alive;
}
