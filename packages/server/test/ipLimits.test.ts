import { describe, expect, it } from "vitest";
import { ConcurrencyLimiter, IpRateLimiter, safeEqual } from "../src/net/ipLimits.js";

describe("IpRateLimiter", () => {
  it("allows up to the limit per window then blocks (SEC-M1-2)", () => {
    let t = 0;
    const rl = new IpRateLimiter(3, 1000, () => t);
    expect(rl.hit("1.2.3.4")).toBe(true);
    expect(rl.hit("1.2.3.4")).toBe(true);
    expect(rl.hit("1.2.3.4")).toBe(true);
    expect(rl.hit("1.2.3.4")).toBe(false);
    // a different IP has its own budget
    expect(rl.hit("5.6.7.8")).toBe(true);
  });

  it("resets after the window and sweeps stale windows", () => {
    let t = 0;
    const rl = new IpRateLimiter(1, 1000, () => t);
    expect(rl.hit("a")).toBe(true);
    expect(rl.hit("a")).toBe(false);
    t = 1000;
    expect(rl.hit("a")).toBe(true);
    t = 3000;
    rl.sweep();
    expect(rl.hit("a")).toBe(true); // window was cleared
  });
});

describe("ConcurrencyLimiter", () => {
  it("caps concurrent acquisitions per key and releases (SEC-M1-3)", () => {
    const cl = new ConcurrencyLimiter(2);
    expect(cl.acquire("ip")).toBe(true);
    expect(cl.acquire("ip")).toBe(true);
    expect(cl.acquire("ip")).toBe(false);
    expect(cl.current("ip")).toBe(2);
    cl.release("ip");
    expect(cl.acquire("ip")).toBe(true);
    cl.release("ip");
    cl.release("ip");
    expect(cl.current("ip")).toBe(0);
    cl.release("ip"); // release below zero is a no-op
    expect(cl.current("ip")).toBe(0);
  });
});

describe("safeEqual", () => {
  it("compares in constant time and rejects length/content mismatch (SEC-M1-4)", () => {
    expect(safeEqual("secret", "secret")).toBe(true);
    expect(safeEqual("secret", "secreT")).toBe(false);
    expect(safeEqual("secret", "secr")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});
