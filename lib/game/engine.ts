import type { Enemy, Projectile, Tower, Vec2 } from "./types.ts";
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

export const BOMB_LOB = 0.6; // seconds a thrown bomb spends arcing to its target
export const BOMB_RADIUS = 0.85; // tiles wiped when a bomb lands (mostly its target)
export const FROST_DURATION = 1.2; // seconds a slow lasts after the last hit
export const FREEZE_DURATION = 3; // frost freezes an enemy solid for 3s
export const FREEZE_IMMUNE = 2.5; // after a thaw, frost can't re-freeze for this long
export const SLIME_SLOW_DURATION = 5; // slime's slow lingers for 5s
const SHOCK_DURATION = 0.35; // how long the tesla electric arc shows on a foe

// Stamp the per-tower status effect (electric arc / freeze) onto a hit enemy.
// Frost freezes an enemy solid, then grants a freeze-immunity window so it CAN'T
// be perpetually re-frozen. Without this, stacked frost towers hold a 0-damage
// enemy in place forever - if no damage tower can reach it, the wave deadlocks
// (it never dies, never leaks) and the run soft-locks. During immunity frost
// still applies its slow, so the enemy always creeps forward and the wave ends.
function markEffect(enemy: Enemy, type: string, time: number) {
  if (type === "tesla") enemy.shockUntil = time + SHOCK_DURATION;
  else if (type === "frost" || type === "roamer") {
    if (time >= (enemy.freezeImmuneUntil ?? 0)) {
      enemy.frozenUntil = time + FREEZE_DURATION;
      enemy.freezeImmuneUntil = enemy.frozenUntil + FREEZE_IMMUNE;
    }
  }
}

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
  waypoints?: Vec2[],
): MoveResult {
  const survivors: Enemy[] = [];
  let leaked = 0;
  for (const e of enemies) {
    // frost freezes an enemy solid (no movement); otherwise a slow may apply
    const frozen = e.frozenUntil !== undefined && time < e.frozenUntil;
    const mul = frozen ? 0 : time < e.slowUntil ? e.slowMul : 1;
    e.dist += e.speed * mul * dt;
    if (e.dist >= pathLen) {
      leaked++;
      continue;
    }
    e.pos = pointAtDistance(Math.max(0, e.dist), waypoints);
    survivors.push(e);
  }
  return { survivors, leaked };
}

// Drive the self-roaming tanks: each drifts toward a random point on the board and
// picks a new one when it arrives, so the white Frost Rover patrols on its own. Runs
// every frame (even between waves) so the tank is always alive on the map.
export function stepRoamers(towers: Tower[], dt: number, cols: number, rows: number) {
  const pick = (): Vec2 => ({
    x: Math.random() * (cols - 1),
    y: Math.random() * (rows - 1),
  });
  for (const t of towers) {
    if (t.type !== "roamer") continue;
    if (!t.pos) t.pos = { x: t.cell.x, y: t.cell.y };
    if (!t.wander) t.wander = pick();
    const dx = t.wander.x - t.pos.x;
    const dy = t.wander.y - t.pos.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.2) {
      t.wander = pick();
      continue;
    }
    const stepLen = Math.min(d, 1.5 * dt); // ~1.5 tiles/sec
    t.pos.x += (dx / d) * stepLen;
    t.pos.y += (dy / d) * stepLen;
  }
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
  entry?: Vec2,
): FireResult {
  const projectiles: Projectile[] = [];
  for (const tower of towers) {
    tower.cooldown -= dt;
    const target = pickTarget(tower, enemies);
    const center = towerCenter(tower);
    // aim at the target while one is in range; otherwise face the enemy ENTRY so
    // an idle barrel always watches the entrance (never a random direction)
    if (target) {
      tower.aim = Math.atan2(target.pos.y - center.y, target.pos.x - center.x);
    } else if (entry) {
      tower.aim = Math.atan2(entry.y - center.y, entry.x - center.x);
    }
    if (tower.cooldown > 0 || !target) continue;

    const stats = towerStats(tower.type, tower.level);
    tower.cooldown = 1 / stats.fireRate;
    const slowDur = tower.type === "slime" ? SLIME_SLOW_DURATION : FROST_DURATION;
    // bigger shots at higher levels: +15% visual size per level (lvl1 = 1x, lvl5 = 1.6x)
    const shotScale = 1 + (tower.level - 1) * 0.15;
    // shots leave the BARREL MUZZLE (offset along the aim), not the tower centre
    const aim = tower.aim ?? 0;
    const from = { x: center.x + Math.cos(aim) * 0.55, y: center.y + Math.sin(aim) * 0.55 };

    // bomb thrower: lob an arcing bomb instead of a hitscan shot. It carries no
    // instant damage - the game loop homes it onto the target and detonates it on
    // landing, ending that country regardless of its health.
    if (tower.type === "bomber") {
      projectiles.push({
        id: projId,
        from,
        to: { ...target.pos },
        targetId: target.id,
        type: "bomber",
        ttl: BOMB_LOB,
        jitter: boltJitter(projId++),
        scale: shotScale,
        detonate: true,
      });
      continue;
    }

    // the roamer shears off half the target's max health per shot (heavy % damage,
    // never a clean one-shot) on top of freezing it; everyone else deals flat damage
    const dmg = tower.type === "roamer" ? Math.ceil(target.maxHp * 0.5) : stats.damage;
    // primary hit
    applyHit(target, dmg, stats.slow, time, slowDur);
    markEffect(target, tower.type, time);
    projectiles.push({
      id: projId,
      from,
      to: { ...target.pos },
      targetId: target.id,
      type: tower.type,
      ttl: tower.type === "laser" ? 0.08 : 0.18,
      jitter: boltJitter(projId++),
      scale: shotScale,
    });

    // cannon splash: everyone near the target takes the hit too
    if (stats.splash > 0) {
      for (const e of enemiesInRadius(target.pos, stats.splash, enemies, target.id)) {
        applyHit(e, Math.round(stats.damage * 0.6), stats.slow, time, slowDur);
        markEffect(e, tower.type, time);
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
        e.shockUntil = time + SHOCK_DURATION;
        projectiles.push({
          id: projId,
          from: prev,
          to: { ...e.pos },
          targetId: e.id,
          type: "tesla",
          ttl: 0.12,
          jitter: boltJitter(projId++),
          scale: shotScale,
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

function applyHit(
  enemy: Enemy,
  damage: number,
  slow: number,
  time: number,
  slowDur = FROST_DURATION,
) {
  enemy.hp -= damage;
  if (slow > 0) {
    enemy.slowMul = 1 - slow;
    enemy.slowUntil = time + slowDur;
  }
}

export interface Boom {
  x: number;
  y: number;
}

/**
 * Advance in-flight bombs: home each onto its (moving) target so the lob always
 * lands on the country it was thrown at, and when the fuse runs out this frame,
 * detonate - wiping every enemy within BOMB_RADIUS regardless of health. Returns
 * the detonation points so the caller can draw the blast and play the boom.
 */
export function stepBombs(projectiles: Projectile[], enemies: Enemy[], dt: number): Boom[] {
  const booms: Boom[] = [];
  for (const p of projectiles) {
    if (p.type !== "bomber" || !p.detonate) continue;
    const tgt = enemies.find((e) => e.id === p.targetId && e.hp > 0);
    if (tgt) p.to = { ...tgt.pos }; // track the fleeing country
    if (p.ttl - dt <= 0) {
      p.detonate = false;
      for (const e of enemies) {
        if (e.hp > 0 && dist(p.to, e.pos) <= BOMB_RADIUS) e.hp = 0;
      }
      booms.push({ x: p.to.x, y: p.to.y });
    }
  }
  return booms;
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
