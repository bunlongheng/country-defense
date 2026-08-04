import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";

import { COUNTRIES, searchCountries, findCountry } from "../lib/countries.ts";
import {
  waveStats,
  spawnWave,
  waveClearBonus,
  resetEnemyIds,
  ENEMIES_PER_WAVE,
} from "../lib/game/waves.ts";
import {
  towerStats,
  upgradeCost,
  sellValue,
  pickTarget,
  TOWER_DEFS,
  TOWER_ORDER,
  MAX_LEVEL,
} from "../lib/game/towers.ts";
import {
  moveEnemies,
  fireTowers,
  reapDead,
  ageProjectiles,
  resetProjectileIds,
} from "../lib/game/engine.ts";
import {
  pathLength,
  pointAtDistance,
  pathCells,
  isBuildable,
  WAYPOINTS,
  BASE_CELL,
} from "../lib/game/map.ts";
import type { Enemy, Tower } from "../lib/game/types.ts";

// ---- countries -----------------------------------------------------------

test("there are exactly 194 recognized countries, no duplicate codes", () => {
  assert.equal(COUNTRIES.length, 194);
  const codes = COUNTRIES.map((c) => c.code);
  assert.equal(new Set(codes).size, 194);
});

test("every country has a matching flag file in public/flags", () => {
  const files = new Set(readdirSync("public/flags"));
  for (const c of COUNTRIES) {
    assert.ok(files.has(`${c.code}.svg`), `missing flag for ${c.name}`);
  }
});

test("search matches by name and region, empty returns all", () => {
  assert.equal(searchCountries("").length, 194);
  assert.deepEqual(
    searchCountries("japan").map((c) => c.code),
    ["jp"],
  );
  assert.ok(searchCountries("europe").length > 30);
  assert.equal(findCountry("us")?.name, "United States");
});

// ---- waves ---------------------------------------------------------------

test("waves get tankier and faster every wave", () => {
  const w1 = waveStats(1);
  const w2 = waveStats(2);
  const w5 = waveStats(5);
  assert.ok(w2.hp > w1.hp, "hp grows");
  assert.ok(w2.speed > w1.speed, "speed grows");
  assert.ok(w5.hp > w2.hp && w5.speed > w2.speed);
  assert.ok(w5.reward > w1.reward, "reward grows");
});

test("spawnWave produces exactly 10 flagged invaders", () => {
  const pool = COUNTRIES.filter((c) => c.code !== "us");
  const enemies = spawnWave(3, pool);
  assert.equal(enemies.length, ENEMIES_PER_WAVE);
  for (const e of enemies) {
    assert.ok(e.hp > 0 && e.hp === e.maxHp);
    assert.ok(pool.some((c) => c.code === e.code));
    assert.notEqual(e.code, "us", "player country never invades");
  }
  // ids are unique
  assert.equal(new Set(enemies.map((e) => e.id)).size, 10);
});

// ---- towers --------------------------------------------------------------

test("there are 6 distinct tower types incl. laser and long-range sniper", () => {
  assert.equal(TOWER_ORDER.length, 6);
  assert.equal(new Set(TOWER_ORDER).size, 6);
  assert.ok(TOWER_DEFS.laser, "laser exists");
  assert.ok(TOWER_DEFS.sniper.range > TOWER_DEFS.rapid.range, "sniper out-ranges rapid");
});

test("upgrading a tower raises damage and range, capped at MAX_LEVEL", () => {
  const l1 = towerStats("laser", 1);
  const l2 = towerStats("laser", 2);
  const l3 = towerStats("laser", 3);
  assert.ok(l2.damage > l1.damage && l2.range > l1.range);
  assert.ok(l3.damage > l2.damage);
  // clamps beyond max
  assert.deepEqual(towerStats("laser", 9), towerStats("laser", MAX_LEVEL));
});

test("upgrade cost rises with level; sell refunds a fraction", () => {
  assert.ok(upgradeCost("cannon", 2) > upgradeCost("cannon", 1));
  assert.ok(sellValue("cannon", 2) > sellValue("cannon", 1));
  assert.ok(sellValue("cannon", 1) < TOWER_DEFS.cannon.cost, "sell < build cost");
});

test("pickTarget selects the in-range enemy furthest along, else null", () => {
  const tower: Tower = { id: 1, type: "laser", cell: { x: 5, y: 1 }, level: 1, cooldown: 0 };
  const near: Enemy = mkEnemy(2, { x: 5, y: 1.5 }, 3);
  const far: Enemy = mkEnemy(3, { x: 5.5, y: 1 }, 9); // further along path
  const outOfRange: Enemy = mkEnemy(4, { x: 30, y: 30 }, 50);
  assert.equal(pickTarget(tower, [near, far, outOfRange])?.id, 3);
  assert.equal(pickTarget(tower, [outOfRange]), null);
});

// ---- engine --------------------------------------------------------------

test("moveEnemies advances position and counts leaks at the base", () => {
  const len = pathLength();
  const walking = mkEnemy(1, { x: 0, y: 1 }, 0.5, 2);
  const atEnd = mkEnemy(2, { x: 0, y: 1 }, len - 0.01, 5);
  const res = moveEnemies([walking, atEnd], 0.1, 0, len);
  assert.equal(res.leaked, 1, "one reached the base");
  assert.equal(res.survivors.length, 1);
  assert.ok(res.survivors[0].dist > 0.5, "survivor moved forward");
});

test("frost slow reduces effective movement speed", () => {
  const len = pathLength();
  const normal = mkEnemy(1, { x: 0, y: 1 }, 1, 1);
  const slowed = mkEnemy(2, { x: 0, y: 1 }, 1, 1);
  slowed.slowMul = 0.5;
  slowed.slowUntil = 10;
  moveEnemies([normal], 1, 0, len);
  moveEnemies([slowed], 1, 0, len);
  assert.ok(slowed.dist < normal.dist, "slowed enemy travels less");
});

test("fireTowers damages target, sets cooldown, spends no gold directly", () => {
  const tower: Tower = { id: 1, type: "sniper", cell: { x: 11, y: 2 }, level: 1, cooldown: 0 };
  const target = mkEnemy(2, { x: 11, y: 1 }, 3, 100);
  const before = target.hp;
  const res = fireTowers([tower], [target], 0.016, 0);
  assert.ok(target.hp < before, "target took damage");
  assert.ok(tower.cooldown > 0, "cooldown started");
  assert.ok(res.projectiles.length >= 1, "a tracer was emitted");
});

test("cannon splash hits neighbours; tesla chains to extra foes", () => {
  const cannon: Tower = { id: 1, type: "cannon", cell: { x: 5, y: 5 }, level: 1, cooldown: 0 };
  const a = mkEnemy(2, { x: 5, y: 5 }, 6, 200);
  const b = mkEnemy(3, { x: 5.4, y: 5 }, 5, 200); // within splash of a
  fireTowers([cannon], [a, b], 0.016, 0);
  assert.ok(b.hp < 200, "splash caught the neighbour");

  const tesla: Tower = { id: 9, type: "tesla", cell: { x: 5, y: 5 }, level: 1, cooldown: 0 };
  const t1 = mkEnemy(20, { x: 5, y: 5 }, 6, 200);
  const t2 = mkEnemy(21, { x: 5.5, y: 5 }, 5, 200);
  fireTowers([tesla], [t1, t2], 0.016, 0);
  assert.ok(t2.hp < 200, "chain arced to the second enemy");
});

test("reapDead awards gold for kills and keeps the living", () => {
  const dead = mkEnemy(1, { x: 0, y: 0 }, 0, 100);
  dead.hp = 0;
  dead.reward = 12;
  const alive = mkEnemy(2, { x: 0, y: 0 }, 0, 100);
  const res = reapDead([dead, alive]);
  assert.equal(res.gold, 12);
  assert.equal(res.kills, 1);
  assert.equal(res.survivors.length, 1);
});

test("frost slow expires after its duration - enemy resumes full speed", () => {
  const len = pathLength();
  const normal = mkEnemy(1, { x: 0, y: 1 }, 1, 1);
  const expired = mkEnemy(2, { x: 0, y: 1 }, 1, 1);
  expired.slowMul = 0.5;
  expired.slowUntil = 1; // slow already lapsed at time=2
  moveEnemies([normal], 1, 2, len);
  moveEnemies([expired], 1, 2, len);
  assert.equal(expired.dist, normal.dist, "expired slow no longer reduces speed");
});

test("splash and chain apply their exact damage factors", () => {
  const cannon: Tower = { id: 1, type: "cannon", cell: { x: 5, y: 5 }, level: 1, cooldown: 0 };
  const dmg = towerStats("cannon", 1).damage;
  const primary = mkEnemy(2, { x: 5, y: 5 }, 6, 500);
  const neighbour = mkEnemy(3, { x: 5.3, y: 5 }, 5, 500);
  fireTowers([cannon], [primary, neighbour], 0.016, 0);
  assert.equal(primary.hp, 500 - dmg, "primary takes full damage");
  assert.equal(neighbour.hp, 500 - Math.round(dmg * 0.6), "splash is 60%");
});

test("tesla chain never hits more than its chain count of extra foes", () => {
  const tesla: Tower = { id: 1, type: "tesla", cell: { x: 5, y: 5 }, level: 1, cooldown: 0 };
  const chain = towerStats("tesla", 1).chain; // 3 at level 1
  const primary = mkEnemy(1, { x: 5, y: 5 }, 9, 999);
  const extras = Array.from({ length: 6 }, (_, i) =>
    mkEnemy(10 + i, { x: 5 + (i + 1) * 0.15, y: 5 }, 5, 999),
  );
  fireTowers([tesla], [primary, ...extras], 0.016, 0);
  const hit = extras.filter((e) => e.hp < 999).length;
  assert.ok(hit <= chain, `at most ${chain} extras hit, got ${hit}`);
  assert.ok(hit > 0, "chain reached at least one extra");
});

test("waveClearBonus grows every wave", () => {
  assert.equal(waveClearBonus(1), 40);
  assert.ok(waveClearBonus(2) > waveClearBonus(1));
  assert.ok(waveClearBonus(12) > waveClearBonus(6));
});

test("resetting id counters makes a replay start enemy/projectile ids at 1", () => {
  resetEnemyIds();
  const first = spawnWave(1, COUNTRIES);
  assert.equal(first[0].id, 1);
  spawnWave(2, COUNTRIES); // advance the counter
  resetEnemyIds();
  const replay = spawnWave(1, COUNTRIES);
  assert.equal(replay[0].id, 1, "ids restart after reset");
  resetProjectileIds(); // smoke: callable, no throw
});

test("projectiles expire once their ttl runs out", () => {
  const live = ageProjectiles(
    [{ id: 1, from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, targetId: 1, type: "laser", ttl: 0.1 }],
    0.2,
  );
  assert.equal(live.length, 0);
});

// ---- map -----------------------------------------------------------------

test("path geometry: length is positive and endpoints resolve", () => {
  const len = pathLength();
  assert.ok(len > 10);
  assert.deepEqual(pointAtDistance(-5), { x: WAYPOINTS[0].x, y: WAYPOINTS[0].y });
  const end = pointAtDistance(len + 100);
  assert.equal(end.x, WAYPOINTS[WAYPOINTS.length - 1].x);
});

test("path cells block building; open tiles are buildable", () => {
  const blocked = pathCells();
  assert.ok(blocked.size > 0);
  // the base tile sits on the path, so it must be blocked
  assert.ok(!isBuildable(BASE_CELL.x, BASE_CELL.y, blocked));
  // a far corner off the path should be open
  assert.ok(isBuildable(0, 8, blocked) || isBuildable(6, 0, blocked));
  // out of bounds never buildable
  assert.ok(!isBuildable(-1, 0, blocked));
  assert.ok(!isBuildable(999, 0, blocked));
});

// ---- helpers -------------------------------------------------------------

function mkEnemy(
  id: number,
  pos: { x: number; y: number },
  dist: number,
  hp = 30,
): Enemy {
  return {
    id,
    code: "xx",
    name: "Test",
    maxHp: hp,
    hp,
    speed: 1,
    dist,
    reward: 8,
    slowUntil: 0,
    slowMul: 1,
    pos,
  };
}
