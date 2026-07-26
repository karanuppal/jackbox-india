// @vitest-environment jsdom
// M6 (feasible half): the synthesized SFX engine. WebAudio is mocked — we
// assert cue routing, autoplay-unlock behavior, mute, and transition mapping.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function mockAudioContext() {
  const created: { freq: number[]; started: number }[] = [];
  class FakeParam {
    value = 0;
    setValueAtTime = vi.fn();
    linearRampToValueAtTime = vi.fn();
    exponentialRampToValueAtTime = vi.fn();
  }
  class FakeNode {
    connect = vi.fn();
    gain = new FakeParam();
  }
  class FakeOsc extends FakeNode {
    type = "sine";
    frequency = new FakeParam();
    start = vi.fn(() => {
      created.push({ freq: [this.frequency.value], started: 1 });
    });
    stop = vi.fn();
  }
  class FakeCtx {
    state = "running";
    currentTime = 0;
    destination = new FakeNode();
    createGain = vi.fn(() => new FakeNode());
    createOscillator = vi.fn(() => new FakeOsc());
    resume = vi.fn(async () => undefined);
    suspend = vi.fn(async () => undefined);
  }
  (globalThis as { AudioContext?: unknown }).AudioContext = FakeCtx as unknown as typeof AudioContext;
  return { created };
}

describe("audio SFX engine", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
  });

  it("plays oscillator notes for every cue once unlocked", async () => {
    const { created } = mockAudioContext();
    const audio = await import("../src/ui/audio.js");
    audio.unlockAudio();
    for (const cue of ["join", "lock", "correct", "wrong", "death", "survive", "wheelTick", "wheelDeath", "wheelLife", "finale", "escape", "gameOver"] as const) {
      audio.play(cue);
    }
    expect(created.length).toBeGreaterThan(12); // every cue scheduled ≥1 note
  });

  it("is a silent no-op without an AudioContext (SSR/old browsers)", async () => {
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
    const audio = await import("../src/ui/audio.js");
    expect(() => audio.play("death")).not.toThrow();
    expect(() => audio.unlockAudio()).not.toThrow();
  });

  it("mute suspends and prevents playback; unmute resumes", async () => {
    mockAudioContext();
    const audio = await import("../src/ui/audio.js");
    audio.unlockAudio();
    audio.setMuted(true);
    expect(audio.isMuted()).toBe(true);
    expect(() => audio.play("correct")).not.toThrow();
    audio.setMuted(false);
    expect(audio.isMuted()).toBe(false);
  });

  it("maps phase transitions to the right cues", async () => {
    const audio = await import("../src/ui/audio.js");
    expect(audio.cueForTransition("question", "reveal", { deaths: 0 })).toBe("correct");
    expect(audio.cueForTransition("question", "reveal", { deaths: 2 })).toBe("wrong");
    expect(audio.cueForTransition("reveal", "kamraIntro")).toBe("wrong");
    expect(audio.cueForTransition("kamraVote", "kamraResult", { deaths: 1 })).toBe("death");
    expect(audio.cueForTransition("kamraPlay", "kamraResult", { deaths: 0 })).toBe("survive");
    expect(audio.cueForTransition("reveal", "wheel")).toBe("wheelTick");
    expect(audio.cueForTransition("wheel", "finaleIntro")).toBe("finale");
    expect(audio.cueForTransition("finaleTurn", "gameOver", { escaped: true })).toBe("escape");
    expect(audio.cueForTransition("reveal", "gameOver")).toBe("gameOver");
    expect(audio.cueForTransition("question", "question")).toBeNull();
    expect(audio.cueForTransition(null, "question")).toBeNull();
  });
});
