// Zero-asset menu theme: a looping, epic minor chord progression (i - VI - III -
// VII in A minor) built live with the WebAudio API - warm detuned pads, a bass
// pulse, a bell arpeggio and a soft timpani hit. No audio files, so it ships
// nothing and keeps the CSP at 'self'. Browsers block audio until a user
// gesture, so start() is wired to the first tap on the picker.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let playing = false;
let timer: ReturnType<typeof setInterval> | null = null;
let barTime = 0; // audio-clock time the next bar should start
let bar = 0;

const BPM = 82;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;

// Chord voicings (Hz) and their bass roots, one entry per bar.
const PROG = [
  { chord: [220.0, 261.63, 329.63], bass: 110.0 }, // Am
  { chord: [174.61, 220.0, 261.63], bass: 87.31 }, // F
  { chord: [261.63, 329.63, 392.0], bass: 130.81 }, // C
  { chord: [196.0, 246.94, 293.66], bass: 98.0 }, // G
];

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.16; // ambient, sits under nothing
    master.connect(ctx.destination);
  }
  return ctx;
}

// A warm sustained pad note: two slightly detuned saws through a lowpass, with a
// slow swell in and out across the bar.
function pad(freq: number, t: number, dur: number) {
  const c = ctx!;
  const filt = c.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.value = 1400;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5, t + dur * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  filt.connect(g);
  g.connect(master!);
  for (const det of [-4, 4]) {
    const o = c.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq;
    o.detune.value = det;
    o.connect(filt);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}

function bass(freq: number, t: number, dur: number) {
  const c = ctx!;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "triangle";
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.7, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.9);
  o.connect(g);
  g.connect(master!);
  o.start(t);
  o.stop(t + dur);
}

// A short bell/pluck for the arpeggio.
function bell(freq: number, t: number) {
  const c = ctx!;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "triangle";
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
  o.connect(g);
  g.connect(master!);
  o.start(t);
  o.stop(t + 0.45);
}

// A soft timpani thud on the downbeat.
function drum(t: number) {
  const c = ctx!;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
  g.gain.setValueAtTime(0.9, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  o.connect(g);
  g.connect(master!);
  o.start(t);
  o.stop(t + 0.32);
}

function scheduleBar(t: number, index: number) {
  const { chord, bass: root } = PROG[index % PROG.length];
  chord.forEach((f) => pad(f, t, BAR));
  bass(root, t, BAR);
  bass(root, t + BAR / 2, BAR / 2);
  drum(t);
  drum(t + BAR / 2);
  // rolling 8-note arpeggio up the chord + an octave
  const notes = [...chord, chord[0] * 2, chord[1] * 2];
  for (let i = 0; i < 8; i++) {
    bell(notes[i % notes.length], t + (i * BAR) / 8);
  }
}

// Lookahead scheduler: queue any bar whose start falls within the next 0.2s.
function tick() {
  const c = ac();
  if (!c || !playing) return;
  while (barTime < c.currentTime + 0.2) {
    scheduleBar(barTime, bar);
    barTime += BAR;
    bar++;
  }
}

export function startMenuMusic() {
  const c = ac();
  if (!c || playing) return;
  if (c.state === "suspended") c.resume().catch(() => {});
  playing = true;
  bar = 0;
  barTime = c.currentTime + 0.1;
  tick();
  timer = setInterval(tick, 40);
}

export function stopMenuMusic() {
  playing = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  // gentle fade so it does not click off
  if (master && ctx) {
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    setTimeout(() => {
      if (master) master.gain.value = 0.16;
    }, 500);
  }
}
