import { describe, expect, it } from "vitest";
import { BRANDING, MAX_PLAYERS, questionSchema } from "../src/index.js";

describe("branding config (PLAN.md §2)", () => {
  it("exposes all four working titles as non-empty strings", () => {
    expect(BRANDING.platformName.length).toBeGreaterThan(0);
    expect(BRANDING.gameName.length).toBeGreaterThan(0);
    expect(BRANDING.hostName.length).toBeGreaterThan(0);
    expect(BRANDING.venueName.length).toBeGreaterThan(0);
  });

  it("barrel re-exports protocol and content modules", () => {
    expect(MAX_PLAYERS).toBe(8);
    expect(questionSchema).toBeDefined();
  });
});
