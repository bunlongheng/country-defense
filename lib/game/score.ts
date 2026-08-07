// Local high-score board. Every finished game (win or loss) is recorded with its
// score, timestamp, outcome and how far the player got, persisted in the browser
// (localStorage) so the top runs survive reloads. No backend - it's the device's
// own leaderboard, which is exactly what "who's the next high score" needs.

export interface ScoreEntry {
  score: number;
  date: number; // epoch ms - when the run finished
  outcome: "won" | "lost";
  stage: number; // stage reached (1-based)
  wave: number; // wave reached (1-based)
  country: string; // the defended country's name
  code?: string; // flag code (for the tiny flag in the board; older rows lack it)
}

// v2: the scoring formula was rebalanced (distance-weighted, loss gives no gold
// bonus), so the old board is wiped once and for all by moving to a fresh key -
// old entries scored under the old rules would rank incoherently against new ones.
const KEY = "country-defense:scores:v2";
const MAX_KEPT = 25;

// Score weighting - HOW FAR you get is everything. A whole stage cleared is worth
// far more than every kill and wave in it combined, so more stages ALWAYS outranks
// a shorter run. On TOP of that, each stage cleared banks an efficiency + speed
// bonus (below) that grades HOW WELL you beat it - but that bonus is bounded well
// under one stage's points, so it can never let a shorter run leapfrog a longer one.
export const POINTS = {
  kill: 10, // per invader terminated
  wave: 500, // per wave cleared
  stage: 10000, // per whole stage cleared - dominates the score so distance wins
};

// Per-stage EFFICIENCY + SPEED bonus, banked the moment a stage is cleared so the
// score reflects how GOOD the clear was, not just that it happened:
//  - lives still standing  -> you took little damage that stage
//  - leftover gold          -> you spent economically (capped so hoarding can't run away)
//  - nuke still in hand      -> you won without the panic button
//  - fast, decisive clear    -> less COMBAT time. Measured in SIM seconds (the fast-
//    forward speed multiplies real and sim time equally, so it can't game this); the
//    reward decays smoothly with time instead of a harsh cutoff.
// Every term is small on purpose: the whole bonus maxes out far below one stage's
// 10000, so reaching one stage further always beats playing one stage prettier.
export const STAGE_BONUS = {
  perLife: 80, // x lives still standing when the stage clears (10 lives -> 800)
  goldRate: 0.5, // fraction of leftover gold banked
  goldCap: 1500, // ...counted only up to this much gold (-> 750 max)
  nukeSaved: 1000, // cleared the stage without firing the nuke
  timePool: 1500, // instant clears earn this; it decays with combat time
  timeScale: 45, // sim-seconds constant: bonus = timePool / (1 + seconds/timeScale)
};

/** Efficiency + speed points earned for the WAY a single stage was cleared. */
export function stageEfficiencyBonus(
  livesLeft: number,
  goldLeft: number,
  nukeUsed: boolean,
  combatSeconds: number,
): number {
  const b = STAGE_BONUS;
  const lives = Math.max(0, livesLeft) * b.perLife;
  const gold = Math.round(Math.min(Math.max(0, goldLeft), b.goldCap) * b.goldRate);
  const nuke = nukeUsed ? 0 : b.nukeSaved;
  const time = Math.round(b.timePool / (1 + Math.max(0, combatSeconds) / b.timeScale));
  return lives + gold + nuke + time;
}

// The most a single stage's efficiency bonus can ever add (all 10 lives, gold
// capped, nuke saved, instant clear) - proven below to stay under one stage.
export const MAX_STAGE_BONUS =
  10 * STAGE_BONUS.perLife +
  STAGE_BONUS.goldCap * STAGE_BONUS.goldRate +
  STAGE_BONUS.nukeSaved +
  STAGE_BONUS.timePool;

export function loadScores(): ScoreEntry[] {
  if (typeof window === "undefined") return [];
  try {
    // one-time cleanup of the pre-rebalance board so it can never resurface
    window.localStorage.removeItem("country-defense:scores");
    const raw = window.localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as ScoreEntry[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** The best score on record right now (0 if none yet). */
export function highScore(): number {
  return loadScores().reduce((m, e) => Math.max(m, e.score), 0);
}

/** Record a finished run; returns the updated top board (sorted, capped). */
export function saveScore(entry: ScoreEntry): ScoreEntry[] {
  const board = [...loadScores(), entry]
    .sort((a, b) => b.score - a.score || b.date - a.date)
    .slice(0, MAX_KEPT);
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(KEY, JSON.stringify(board));
    }
  } catch {
    // storage full / disabled - the run just isn't saved, no crash
  }
  return board;
}

/** Short "Aug 6, 3:45 PM" style stamp for the board rows. */
export function formatWhen(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
