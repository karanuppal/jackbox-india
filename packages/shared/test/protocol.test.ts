import { describe, expect, it } from "vitest";
import {
  clientEnvelopeSchema,
  defaultSettings,
  ROOM_CODE_ALPHABET,
  settingsSchema,
} from "../src/protocol.js";

describe("protocol", () => {
  it("default settings match PLAN.md §4.4 (family-friendly ON by default)", () => {
    const s = defaultSettings();
    expect(s.familyFriendly).toBe(true);
    expect(s.profanityFilter).toBe("strict");
    expect(s.subtitles).toBe(true);
    expect(s.timerMode).toBe("normal");
    expect(s.audienceEnabled).toBe(true);
    expect(s.password).toBeNull();
  });

  it("room code alphabet has 20 letters and no ambiguous characters", () => {
    expect(ROOM_CODE_ALPHABET).toHaveLength(20);
    for (const bad of ["I", "L", "O", "Q", "B", "G"]) {
      expect(ROOM_CODE_ALPHABET).not.toContain(bad);
    }
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(20);
  });

  it("rejects malformed client envelopes", () => {
    expect(clientEnvelopeSchema.safeParse({ seq: -1, payload: { action: "pause" } }).success).toBe(false);
    expect(clientEnvelopeSchema.safeParse({ seq: 0, payload: { action: "hack" } }).success).toBe(false);
    expect(
      clientEnvelopeSchema.safeParse({
        seq: 0,
        payload: { action: "answer", questionId: "q_0001", optionIndex: 4 },
      }).success,
    ).toBe(false);
    expect(
      clientEnvelopeSchema.safeParse({
        seq: 0,
        payload: { action: "answer", questionId: "q_0001", optionIndex: 2 },
      }).success,
    ).toBe(true);
  });

  it("settings schema rejects unknown timer modes and oversized passwords", () => {
    expect(settingsSchema.safeParse({ timerMode: "turbo" }).success).toBe(false);
    expect(settingsSchema.safeParse({ password: "x".repeat(33) }).success).toBe(false);
  });
});
