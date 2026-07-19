import { describe, expect, it } from "vitest";
import { ROOM_CODE_ALPHABET, ROOM_CODE_BLOCKLIST } from "@tamasha/shared";
import { generateUniqueCode, isAcceptableCode, normalizeCode, randomCode } from "../src/rooms/roomCode.js";

describe("room codes", () => {
  it("generates 4-letter codes from the alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const c = randomCode();
      expect(c).toHaveLength(4);
      for (const ch of c) expect(ROOM_CODE_ALPHABET).toContain(ch);
    }
  });

  it("rejects malformed and blocklisted codes", () => {
    expect(isAcceptableCode("ABC")).toBe(false);
    expect(isAcceptableCode("ABCDE")).toBe(false);
    expect(isAcceptableCode("ABIC")).toBe(false); // I is not in the alphabet
    expect(isAcceptableCode(ROOM_CODE_BLOCKLIST[0]!)).toBe(false);
    expect(isAcceptableCode("ACDE")).toBe(true);
  });

  it("normalizes user input case-insensitively", () => {
    expect(normalizeCode("  acde ")).toBe("ACDE");
    expect(normalizeCode("Acde")).toBe("ACDE");
  });

  it("generateUniqueCode avoids taken codes", () => {
    const taken = new Set(["ACDE", "FHJK"]);
    const c = generateUniqueCode((code) => taken.has(code));
    expect(taken.has(c)).toBe(false);
    expect(isAcceptableCode(c)).toBe(true);
  });

  it("throws when the space is exhausted", () => {
    expect(() => generateUniqueCode(() => true, 5)).toThrow(/exhausted/);
  });
});
