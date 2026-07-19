import { describe, expect, it } from "vitest";
import {
  ACTION_ROLE,
  clientEnvelopeSchema,
  defaultSettings,
  ksActionSchema,
  MAX_AUDIENCE,
  MAX_CLIENT_FRAME_BYTES,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  MIN_PLAYERS,
  playerNameSchema,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_BLOCKLIST,
  ROOM_CODE_LENGTH,
  ROOM_CODE_TTL_MS,
  sanitizeName,
  settingsSchema,
  toPublicSettings,
} from "../src/protocol.js";

describe("plan-pinned constants (PLAN.md §3.2, §4.2)", () => {
  it("player/audience/name/frame limits match the plan", () => {
    expect(MIN_PLAYERS).toBe(1);
    expect(MAX_PLAYERS).toBe(8);
    expect(MAX_AUDIENCE).toBe(200);
    expect(MAX_NAME_LENGTH).toBe(12);
    expect(MAX_CLIENT_FRAME_BYTES).toBe(4096);
    expect(ROOM_CODE_LENGTH).toBe(4);
    expect(ROOM_CODE_TTL_MS).toBe(12 * 60 * 60 * 1000);
  });

  it("room code alphabet has 20 unique letters, no ambiguous characters", () => {
    expect(ROOM_CODE_ALPHABET).toHaveLength(20);
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(20);
    for (const bad of ["I", "L", "O", "Q", "B", "G"]) {
      expect(ROOM_CODE_ALPHABET).not.toContain(bad);
    }
  });

  it("every blocklisted code is expressible in the alphabet (else it is dead weight)", () => {
    for (const code of ROOM_CODE_BLOCKLIST) {
      expect(code).toHaveLength(4);
      for (const ch of code) expect(ROOM_CODE_ALPHABET).toContain(ch);
    }
  });
});

describe("settings", () => {
  it("defaults match PLAN.md §4.4 (family-friendly ON by default)", () => {
    const s = defaultSettings();
    expect(s.familyFriendly).toBe(true);
    expect(s.profanityFilter).toBe("strict");
    expect(s.subtitles).toBe(true);
    expect(s.timerMode).toBe("normal");
    expect(s.audienceEnabled).toBe(true);
    expect(s.password).toBeNull();
  });

  it("rejects unknown timer modes and oversized passwords", () => {
    expect(settingsSchema.safeParse({ timerMode: "turbo" }).success).toBe(false);
    expect(settingsSchema.safeParse({ password: "x".repeat(33) }).success).toBe(false);
  });

  it("toPublicSettings strips the password and exposes only a boolean (SEC-M0-2)", () => {
    const withPw = settingsSchema.parse({ password: "chai123" });
    const pub = toPublicSettings(withPw);
    expect(JSON.stringify(pub)).not.toContain("chai123");
    expect("password" in pub).toBe(false);
    expect(pub.passwordRequired).toBe(true);
    expect(toPublicSettings(defaultSettings()).passwordRequired).toBe(false);
  });
});

describe("client envelope", () => {
  it("rejects malformed envelopes", () => {
    expect(clientEnvelopeSchema.safeParse({ seq: -1, payload: { action: "pause" } }).success).toBe(false);
    expect(clientEnvelopeSchema.safeParse({ seq: 0.5, payload: { action: "pause" } }).success).toBe(false);
    expect(clientEnvelopeSchema.safeParse({ seq: 0, payload: { action: "hack" } }).success).toBe(false);
    expect(clientEnvelopeSchema.safeParse({ seq: 0 }).success).toBe(false);
  });

  it("accepts platform and game-envelope actions", () => {
    expect(clientEnvelopeSchema.safeParse({ seq: 0, payload: { action: "startGame" } }).success).toBe(true);
    expect(clientEnvelopeSchema.safeParse({ seq: 1, payload: { action: "pause" } }).success).toBe(true);
    expect(
      clientEnvelopeSchema.safeParse({
        seq: 2,
        payload: { action: "game", payload: { anything: true } },
      }).success,
    ).toBe(true);
  });

  it("every action has a declared role requirement (SEC-M0-5)", () => {
    for (const action of ["startGame", "skipTutorial", "restart"]) {
      expect(ACTION_ROLE[action]).toBe("vip");
    }
    for (const action of ["updateSettings", "pause", "resume"]) {
      expect(ACTION_ROLE[action]).toBe("hostScreen");
    }
    expect(ACTION_ROLE["game"]).toBe("any");
  });
});

describe("khooni sawaal game actions", () => {
  it("enforces question id format and option bounds (SEC-M0-4)", () => {
    expect(ksActionSchema.safeParse({ type: "answer", questionId: "q_0001", optionIndex: 2 }).success).toBe(true);
    expect(ksActionSchema.safeParse({ type: "answer", questionId: "x".repeat(4000), optionIndex: 0 }).success).toBe(false);
    expect(ksActionSchema.safeParse({ type: "answer", questionId: "q_1", optionIndex: 0 }).success).toBe(false);
    expect(ksActionSchema.safeParse({ type: "answer", questionId: "q_0001", optionIndex: 4 }).success).toBe(false);
    expect(ksActionSchema.safeParse({ type: "answer", questionId: "q_0001", optionIndex: -1 }).success).toBe(false);
  });
});

describe("sanitizeName (SEC-M0-3)", () => {
  it("keeps ordinary names, emoji, and Devanagari intact", () => {
    expect(sanitizeName("Karan")).toBe("Karan");
    expect(sanitizeName("🔥Priya🔥")).toBe("🔥Priya🔥");
    expect(sanitizeName("प्रिया")).toBe("प्रिया");
  });

  it("strips control, bidi-override, and zero-width characters", () => {
    expect(sanitizeName("Ka\u0007ran")).toBe("Karan");
    expect(sanitizeName("\u202Enarak\u202C")).toBe("narak");
    expect(sanitizeName("Ka\u200Bran\u200D")).toBe("Karan");
    expect(sanitizeName("\uFEFFKaran")).toBe("Karan");
  });

  it("collapses whitespace and trims", () => {
    expect(sanitizeName("  Karan\t\nUppal  ")).toBe("Karan Uppal");
  });

  it("caps zalgo combining-mark stacks", () => {
    const zalgo = "K" + "\u0301".repeat(30) + "aran";
    const out = sanitizeName(zalgo)!;
    expect(out.length).toBeLessThanOrEqual(MAX_NAME_LENGTH + 2);
    expect(/\u0301{3,}/u.test(out)).toBe(false);
  });

  it("truncates to MAX_NAME_LENGTH grapheme-ish units", () => {
    expect(sanitizeName("abcdefghijklmnopqrstuvwxyz")).toBe("abcdefghijkl");
  });

  it("returns null when nothing survives", () => {
    expect(sanitizeName("   ")).toBeNull();
    expect(sanitizeName("\u200B\u200B")).toBeNull();
    expect(sanitizeName("")).toBeNull();
  });

  it("playerNameSchema mirrors sanitizeName behavior", () => {
    expect(playerNameSchema.parse(" Karan ")).toBe("Karan");
    expect(playerNameSchema.safeParse("\u200B").success).toBe(false);
    expect(playerNameSchema.safeParse("").success).toBe(false);
    expect(playerNameSchema.safeParse("x".repeat(65)).success).toBe(false);
  });
});
