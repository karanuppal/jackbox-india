import { describe, expect, it } from "vitest";
import { RateLimiter } from "../src/ws/rateLimiter.js";

describe("RateLimiter", () => {
  it("allows up to the limit within a window then blocks", () => {
    let t = 0;
    const rl = new RateLimiter(3, () => t);
    expect(rl.allow()).toBe(true);
    expect(rl.allow()).toBe(true);
    expect(rl.allow()).toBe(true);
    expect(rl.allow()).toBe(false); // 4th in the same window
  });

  it("resets after the window elapses", () => {
    let t = 0;
    const rl = new RateLimiter(2, () => t);
    expect(rl.allow()).toBe(true);
    expect(rl.allow()).toBe(true);
    expect(rl.allow()).toBe(false);
    t = 1000; // new window
    expect(rl.allow()).toBe(true);
  });
});
