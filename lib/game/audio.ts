import type { TowerType } from "./types.ts";

// Zero-asset sound: every effect is synthesized live with the WebAudio API so
// there are no audio files to ship (keeps the CSP at 'self') and nothing to load.
// A single AudioContext is created lazily on the first real user gesture, because
// browsers block audio until then. All effects are short blips with a fast decay
// envelope so rapid-fire towers never build up into noise.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  }
  return ctx;
}

/** Call from a click/keydown so iOS/Safari unlock the audio context. */
export function unlockAudio() {
  const c = ac();
  if (c && c.state === "suspended") c.resume().catch(() => {});
}

export function toggleMute(): boolean {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.35;
  return muted;
}
export const isMuted = () => muted;

// Core one-shot voice: an oscillator + gain envelope, optionally pitch-swept.
function blip(
  freq: number,
  dur: number,
  type: OscillatorType,
  vol = 1,
  endFreq?: number,
) {
  const c = ac();
  if (!c || !master || muted) return;
  const t = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (endFreq !== undefined)
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// Short filtered-noise burst for impacts / explosions.
function noise(dur: number, vol: number, freq: number) {
  const c = ac();
  if (!c || !master || muted) return;
  const t = c.currentTime;
  const frames = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const data = buf.getChannelData(0);
  // cheap deterministic-ish noise (no Math.random needed, LCG on index)
  let seed = frames;
  for (let i = 0; i < frames; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = ((seed / 0x7fffffff) * 2 - 1) * (1 - i / frames);
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const filt = c.createBiquadFilter();
  filt.type = "bandpass";
  filt.frequency.value = freq;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(filt);
  filt.connect(g);
  g.connect(master);
  src.start(t);
}

// Per-tower firing voice, tuned so each weapon reads by ear.
const SHOOT: Record<TowerType, () => void> = {
  laser: () => blip(880, 0.09, "sawtooth", 0.5, 1500),
  rapid: () => noise(0.09, 0.16, 1300), // soft airy "pfft" of smoke
  frost: () => {
    // a watery splash: a quick liquid blip + a little wet spatter
    blip(820, 0.09, "sine", 0.32, 260);
    noise(0.07, 0.14, 2200);
  },
  slime: () => blip(240, 0.16, "sine", 0.6, 90),
  cannon: () => {
    blip(140, 0.18, "square", 0.7, 60);
    noise(0.16, 0.25, 400);
  },
  tesla: () => blip(320, 0.12, "sawtooth", 0.5, 1600),
  sniper: () => blip(700, 0.2, "triangle", 0.6, 180),
  // a heavy underhand lob: a short rising "whoomp" as the bomb leaves the tube
  bomber: () => {
    blip(120, 0.22, "sine", 0.6, 320);
    noise(0.1, 0.14, 500);
  },
  // black wind: a low, dark whoosh of gusting air with a hollow descending moan
  wind: () => {
    noise(0.22, 0.18, 480);
    blip(240, 0.2, "sine", 0.22, 70);
  },
  // the white Line Laser: a blazing sci-fi beam - a bright descending zap over a
  // gritty underlayer and a searing sizzle, so the full-screen shot really lands
  roamer: () => {
    blip(2000, 0.26, "sawtooth", 0.45, 240);
    blip(1200, 0.2, "square", 0.22, 300);
    noise(0.14, 0.24, 3200);
  },
};

/** Ominous descending beep for the nuke's 3-2-1 countdown (n = 3, 2, 1). */
export function playNukeTick(n: number) {
  blip(180 + n * 90, 0.18, "square", 0.5, 120 + n * 60);
}

/** The falling-warhead whistle, right before the big boom. */
export function playNukeStrike() {
  blip(1400, 0.35, "sine", 0.4, 200);
}

/** A meaty explosion - used when a lobbed bomb lands and for the nuke blast. */
export function playBoom(big = false) {
  noise(big ? 0.6 : 0.32, big ? 0.6 : 0.4, big ? 90 : 160);
  blip(big ? 70 : 110, big ? 0.5 : 0.3, "square", big ? 0.6 : 0.45, 40);
  if (big) blip(150, 0.7, "sawtooth", 0.35, 30);
}

// Throttle firing sounds PER TOWER TYPE (not globally) so every weapon keeps its
// own voice - a laser and a cannon firing on the same frame both get heard, they
// don't cancel each other out. Each type is limited to ~11 shots/sec so a wall of
// one kind stays crisp instead of a wash of overlapping blips.
const lastShootByType: Partial<Record<TowerType, number>> = {};
export function playShoot(type: TowerType, time: number) {
  if (time - (lastShootByType[type] ?? -1) < 0.09) return;
  lastShootByType[type] = time;
  SHOOT[type]?.();
}

let lastImpact = -1;
export function playImpact(time: number) {
  if (time - lastImpact < 0.05) return;
  lastImpact = time;
  noise(0.08, 0.18, 900);
}

export function playKill() {
  noise(0.14, 0.3, 300);
  blip(200, 0.16, "square", 0.4, 70);
}
export function playLeak() {
  blip(160, 0.3, "sawtooth", 0.5, 60);
}
export function playBuild() {
  // cash-register "ka-ching": a drawer clack + two bright ascending bell dings
  noise(0.05, 0.15, 3200);
  blip(1318, 0.09, "square", 0.4); // E6 ding
  setTimeout(() => {
    blip(1760, 0.16, "triangle", 0.45); // A6 ring
    blip(2637, 0.16, "sine", 0.25); // shimmer overtone
  }, 80);
}
export function playUpgrade() {
  blip(523, 0.1, "sine", 0.5);
  blip(784, 0.14, "sine", 0.5);
}
export function playSell() {
  blip(400, 0.1, "sine", 0.4, 200);
}
export function playWaveStart() {
  blip(330, 0.14, "sawtooth", 0.5);
  blip(494, 0.18, "sawtooth", 0.45);
}
export function playCountdown() {
  blip(660, 0.07, "sine", 0.35);
}
export function playWin() {
  [523, 659, 784, 1047].forEach((f, i) =>
    setTimeout(() => blip(f, 0.22, "triangle", 0.5), i * 130),
  );
}
export function playLose() {
  [392, 330, 262, 196].forEach((f, i) =>
    setTimeout(() => blip(f, 0.28, "sawtooth", 0.5), i * 150),
  );
}
