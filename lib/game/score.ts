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

const KEY = "country-defense:scores";
const MAX_KEPT = 25;

// Score weighting - HOW FAR you get is everything. A whole stage cleared is worth
// far more than every kill, wave and hoarded coin in it combined, so more stages
// ALWAYS outranks a cautious short run. Lives + leftover gold are only a small,
// capped tiebreaker between two runs that got equally far (see MAX_EFFICIENCY_BONUS
// in Game.tsx) - they can never bridge a full stage of progress.
export const POINTS = {
  kill: 10, // per invader terminated
  wave: 500, // per wave cleared
  stage: 10000, // per whole stage cleared - dominates the score so distance wins
  lifePerLeft: 100, // per base life still standing at the end (tiebreaker)
  goldPerLeft: 1, // per gold coin still in the bank at the end (tiebreaker)
};

// The lives + leftover-gold bonus is capped at this so hoarding can never let a
// short run rival a longer one. It's a tiebreaker, not a way to buy rank: the cap
// sits well below one stage's worth of points, so distance is always the judge.
export const MAX_EFFICIENCY_BONUS = 2500;

export function loadScores(): ScoreEntry[] {
  if (typeof window === "undefined") return [];
  try {
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
