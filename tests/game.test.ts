import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";

import { COUNTRIES, searchCountries, findCountry } from "../lib/countries.ts";
import {
  waveStats,
  spawnWave,
  waveClearBonus,
  resetEnemyIds,
  waveAssignments,
  TOTAL_WAVES,
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
  stepBombs,
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
import { STAGES, TOTAL_STAGES, stageBase } from "../lib/game/stages.ts";
import { POINTS, MAX_EFFICIENCY_BONUS } from "../lib/game/score.ts";
import { dist, hexA } from "../lib/game/math.ts";
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

test("spawnWave builds a wave of distinct pool countries (~19/wave)", () => {
  const pool = COUNTRIES.filter((c) => c.code !== "us");
  const enemies = spawnWave(3, pool);
  assert.ok(enemies.length >= 15 && enemies.length <= 25, "roughly a tenth of the pool");
  for (const e of enemies) {
    assert.ok(e.hp > 0 && e.hp === e.maxHp);
    assert.ok(pool.some((c) => c.code === e.code));
    assert.notEqual(e.code, "us", "player country never invades");
  }
  // ids and country codes are unique within the wave
  assert.equal(new Set(enemies.map((e) => e.id)).size, enemies.length);
  assert.equal(new Set(enemies.map((e) => e.code)).size, enemies.length);
});

test("every country invades exactly once across the 10 waves", () => {
  const pool = COUNTRIES.filter((c) => c.code !== "us");
  const seen = new Set<string>();
  let total = 0;
  for (let w = 1; w <= TOTAL_WAVES; w++) {
    resetEnemyIds();
    const codes = spawnWave(w, pool, 1.6, 7).map((e) => e.code);
    total += codes.length;
    codes.forEach((c) => seen.add(c));
  }
  assert.equal(total, pool.length, "all countries used, no duplicates");
  assert.equal(seen.size, pool.length, "each country appears exactly once");
});

test("waveAssignments splits the pool evenly, remainder in the last wave", () => {
  const pool = COUNTRIES.filter((c) => c.code !== "us"); // 193
  const groups = waveAssignments(pool, 0);
  assert.equal(groups.length, TOTAL_WAVES);
  const per = Math.floor(pool.length / TOTAL_WAVES); // 19
  for (let w = 0; w < TOTAL_WAVES - 1; w++) assert.equal(groups[w].length, per);
  assert.equal(groups[TOTAL_WAVES - 1].length, pool.length - per * (TOTAL_WAVES - 1));
});

// ---- towers --------------------------------------------------------------

test("the journey has 10 stages that ramp up and stay on-grid", () => {
  assert.equal(TOTAL_STAGES, 10);
  assert.equal(STAGES.length, 10);
  let prevMul = 0;
  for (const st of STAGES) {
    assert.ok(st.waypoints.length >= 2, `${st.name} has a path`);
    assert.ok(st.hpMul >= prevMul, `${st.name} is at least as tough as the last`);
    prevMul = st.hpMul;
    // path stays within the grid (entry may sit one tile off the left edge)
    for (const wp of st.waypoints) {
      assert.ok(wp.x >= -1 && wp.x <= 13, `${st.name} x in range`);
      assert.ok(wp.y >= -1 && wp.y <= 8, `${st.name} y in range`);
    }
    const base = stageBase(st);
    assert.deepEqual(base, st.waypoints[st.waypoints.length - 1], "base is the path end");
  }
});

test("there are 9 distinct tower types incl. laser, sniper, slime, bomber and wind", () => {
  assert.equal(TOWER_ORDER.length, 9);
  assert.equal(new Set(TOWER_ORDER).size, 9);
  assert.ok(TOWER_DEFS.laser, "laser exists");
  // the black-wind tank slows AND rots hp over time (its defining role)
  assert.ok(TOWER_DEFS.wind.slow > 0, "wind slows");
  assert.ok((TOWER_DEFS.wind.dot ?? 0) > 0, "wind rots hp over time");
  assert.ok(TOWER_DEFS.sniper.range > TOWER_DEFS.rapid.range, "sniper out-ranges rapid");
  // the slime tower slows hard and splatters (its defining role)
  assert.ok(TOWER_DEFS.slime.slow > 0, "slime slows");
  assert.ok(TOWER_DEFS.slime.splash > 0, "slime splatters");
  // the bomb thrower one-shots anything (damage far exceeds any real HP)
  assert.ok(TOWER_DEFS.bomber.damage > 9000, "bomber ignores the health bar");
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

test("black wind stamps a slow + poison, and the poison keeps draining hp over time", () => {
  const wind: Tower = { id: 1, type: "wind", cell: { x: 5, y: 5 }, level: 1, cooldown: 0 };
  const target = mkEnemy(2, { x: 5, y: 5 }, 6, 200);
  fireTowers([wind], [target], 0.016, 0);
  assert.ok(target.slowMul < 1, "wind slows the target");
  assert.ok((target.poisonDps ?? 0) > 0 && (target.poisonUntil ?? 0) > 0, "wind poisons the target");
  // the rot keeps ticking on later frames even with no new shot
  const hpAfterHit = target.hp;
  moveEnemies([target], 1, 0.5, pathLength());
  assert.ok(target.hp < hpAfterHit, "poison drained more hp over the next second");
  // once the poison window passes, no more drain
  const hpSettled = target.hp;
  moveEnemies([target], 1, 99, pathLength());
  assert.equal(target.hp, hpSettled, "poison stops after its window");
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

test("scoring judges by distance: one more stage always outranks hoarding lives+gold", () => {
  // clearing a whole stage is worth more than every wave in it PLUS the full
  // efficiency (lives+gold) tiebreaker, so pushing one stage deeper can never be
  // beaten by a shorter run that hoarded coins and kept its lives
  const maxHoardWithinAStage = (TOTAL_WAVES - 1) * POINTS.wave + MAX_EFFICIENCY_BONUS;
  assert.ok(POINTS.stage > maxHoardWithinAStage, "a stage clear dwarfs any hoard");
  // the efficiency bonus is a tiebreaker, never a way to buy a stage of rank
  assert.ok(MAX_EFFICIENCY_BONUS < POINTS.stage, "efficiency can't bridge a stage");
  // progress out-weighs grinding: a stage clear beats a wave, a wave beats a kill
  assert.ok(POINTS.stage > POINTS.wave && POINTS.wave > POINTS.kill);
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

test("frost can't perpetually re-freeze - immunity keeps a wave from deadlocking", () => {
  // A frost tower does 0 damage. Without a freeze-immunity window, stacked frost
  // holds the last enemy frozen forever: it never dies, never leaks, and the wave
  // (and the whole run) soft-locks. This proves re-hits during immunity can't
  // extend the freeze, so the enemy always thaws and moves on.
  const frost: Tower = { id: 1, type: "frost", cell: { x: 5, y: 5 }, level: 1, cooldown: 0 };
  const e = mkEnemy(2, { x: 5, y: 5 }, 3, 9999); // huge hp, frost never kills it

  fireTowers([frost], [e], 0.016, 0); // t=0: first hit freezes solid
  const firstFreeze = e.frozenUntil;
  assert.ok(firstFreeze && firstFreeze > 0, "frozen on the first frost hit");

  frost.cooldown = 0;
  fireTowers([frost], [e], 0.016, 1); // t=1: re-hit while still immune
  assert.equal(e.frozenUntil, firstFreeze, "a re-hit during immunity does NOT extend the freeze");

  // once the freeze lapses the enemy moves again - the wave can end
  const thawed = mkEnemy(3, { x: 5, y: 5 }, 0, 9999);
  thawed.frozenUntil = firstFreeze; // frozen only until firstFreeze
  moveEnemies([thawed], 1, firstFreeze! + 1);
  assert.ok(thawed.dist > 0, "enemy resumes moving after the freeze expires (no deadlock)");
});

test("bomb thrower lobs a bomb that detonates and one-shots a full-HP enemy", () => {
  const bomber: Tower = { id: 1, type: "bomber", cell: { x: 5, y: 5 }, level: 1, cooldown: 0 };
  const foe = mkEnemy(2, { x: 5, y: 5 }, 6, 5000); // huge HP - the bomb ignores it
  const res = fireTowers([bomber], [foe], 0.016, 0);
  const bomb = res.projectiles.find((p) => p.type === "bomber");
  assert.ok(bomb && bomb.detonate, "a live bomb was lobbed");
  assert.equal(foe.hp, 5000, "no instant hitscan damage - the bomb kills on landing");
  // fuse still burning: no detonation yet
  assert.equal(stepBombs(res.projectiles, [foe], 0.1).length, 0, "bomb still in the air");
  // fast-forward the fuse to landing -> detonation wipes the target
  bomb.ttl = 0.01;
  const booms = stepBombs(res.projectiles, [foe], 0.05);
  assert.equal(booms.length, 1, "the bomb detonated");
  assert.ok(foe.hp <= 0, "the target is dead regardless of its health bar");
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
    [{ id: 1, from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, targetId: 1, type: "laser", ttl: 0.1, jitter: 0, scale: 1 }],
    0.2,
  );
  assert.equal(live.length, 0);
});

test("seeded spawn is deterministic per seed and varies across seeds", () => {
  const a = spawnWave(1, COUNTRIES, 1.6, 0).map((e) => e.code);
  const aAgain = spawnWave(1, COUNTRIES, 1.6, 0).map((e) => e.code);
  const b = spawnWave(1, COUNTRIES, 1.6, 50).map((e) => e.code);
  assert.deepEqual(a, aAgain, "same seed -> same lineup");
  assert.notDeepEqual(a, b, "different seed -> different lineup");
});

// ---- math ----------------------------------------------------------------

test("shared math helpers: dist and hexA", () => {
  assert.equal(dist({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  assert.equal(dist({ x: 1, y: 1 }, { x: 1, y: 1 }), 0);
  assert.equal(hexA("#ff8800", 0.5), "rgba(255,136,0,0.5)");
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
