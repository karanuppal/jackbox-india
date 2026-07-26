// M6 (feasible half): synthesized SFX via WebAudio — no external assets, so
// it works inside the strict deploy CSP and offline. The Mishra Ji VO track
// (§7) needs owner-held TTS keys and lands separately; these stings carry the
// audio "feel" until then: harmonium-ish drones, tabla-ish ticks, and a
// filmi fanfare, all built from oscillators.
//
// Autoplay policy: the context unlocks on the first user gesture (standard
// iOS/Chrome pattern, §8.7); until then every cue is a silent no-op.

export type Cue =
  | "join" // a guest arrives (lobby)
  | "lock" // an answer locks in
  | "correct" // reveal: you were right
  | "wrong" // reveal: sentenced
  | "death" // kamra result death
  | "survive" // kamra result survival
  | "wheelTick" // wheel spinning
  | "wheelDeath"
  | "wheelLife"
  | "finale" // finale intro sting
  | "escape" // the door breaks
  | "gameOver";

interface Ctx {
  ctx: AudioContext;
  master: GainNode;
}

let state: Ctx | null = null;
let muted = false;

function ensure(): Ctx | null {
  if (muted) return null;
  if (state !== null) return state;
  const AC =
    (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (AC === undefined) return null;
  try {
    const ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
    state = { ctx, master };
    return state;
  } catch {
    return null;
  }
}

/** Call from any user-gesture handler to satisfy autoplay policies. */
export function unlockAudio(): void {
  const s = ensure();
  if (s !== null && s.ctx.state === "suspended") {
    void s.ctx.resume().catch(() => undefined);
  }
}

export function setMuted(m: boolean): void {
  muted = m;
  if (m && state !== null) {
    void state.ctx.suspend().catch(() => undefined);
  } else if (!m && state !== null) {
    void state.ctx.resume().catch(() => undefined);
  }
}
export function isMuted(): boolean {
  return muted;
}

/** One enveloped oscillator note. */
function note(
  s: Ctx,
  freq: number,
  at: number,
  dur: number,
  type: OscillatorType = "sine",
  gain = 0.9,
): void {
  const osc = s.ctx.createOscillator();
  const g = s.ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = s.ctx.currentTime + at;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g);
  g.connect(s.master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/** Filmi-horror cue set (original composition; §7.5 palette). */
export function play(cue: Cue): void {
  const s = ensure();
  if (s === null || s.ctx.state === "suspended") return;
  switch (cue) {
    case "join":
      note(s, 523, 0, 0.12, "triangle"); // C5
      note(s, 659, 0.09, 0.18, "triangle"); // E5
      return;
    case "lock":
      note(s, 880, 0, 0.07, "square", 0.35);
      return;
    case "correct":
      note(s, 587, 0, 0.12, "triangle");
      note(s, 740, 0.1, 0.12, "triangle");
      note(s, 880, 0.2, 0.25, "triangle");
      return;
    case "wrong":
      note(s, 233, 0, 0.35, "sawtooth", 0.6); // Bb3 growl
      note(s, 220, 0.12, 0.5, "sawtooth", 0.6);
      return;
    case "death":
      note(s, 110, 0, 0.9, "sawtooth", 0.8); // A2 doom
      note(s, 104, 0.05, 0.9, "sawtooth", 0.5); // detuned beat
      note(s, 55, 0.1, 1.1, "sine", 0.9);
      return;
    case "survive":
      note(s, 440, 0, 0.15, "triangle");
      note(s, 554, 0.12, 0.3, "triangle");
      return;
    case "wheelTick":
      note(s, 1200, 0, 0.03, "square", 0.25);
      return;
    case "wheelDeath":
      note(s, 155, 0, 0.6, "sawtooth", 0.8);
      note(s, 82, 0.15, 0.9, "sine", 0.9);
      return;
    case "wheelLife":
      note(s, 660, 0, 0.12, "triangle");
      note(s, 880, 0.1, 0.3, "triangle");
      return;
    case "finale":
      // rising pre-dawn urgency
      [220, 262, 330, 392, 440].forEach((f, i) => note(s, f, i * 0.09, 0.2, "triangle", 0.7));
      return;
    case "escape":
      [523, 659, 784, 1047].forEach((f, i) => note(s, f, i * 0.08, 0.4, "triangle", 0.8));
      note(s, 262, 0, 0.8, "sawtooth", 0.4);
      return;
    case "gameOver":
      [392, 494, 587, 784].forEach((f, i) => note(s, f, i * 0.12, 0.5, "triangle", 0.7));
      return;
  }
}

/** Map a phase-data transition to a cue (host screen drives the room audio). */
export function cueForTransition(prevKind: string | null, nextKind: string, extra?: { deaths?: number; outcome?: "life" | "death" | null; escaped?: boolean }): Cue | null {
  if (prevKind === nextKind) {
    return null;
  }
  switch (nextKind) {
    case "question":
      return null;
    case "reveal":
      return (extra?.deaths ?? 0) > 0 ? "wrong" : "correct";
    case "kamraIntro":
      return "wrong";
    case "kamraResult":
      return (extra?.deaths ?? 0) > 0 ? "death" : "survive";
    case "wheel":
      return "wheelTick";
    case "finaleIntro":
      return "finale";
    case "gameOver":
      return extra?.escaped === true ? "escape" : "gameOver";
    default:
      return null;
  }
}
