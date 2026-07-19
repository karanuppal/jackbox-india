import { timingSafeEqual } from "node:crypto";

/**
 * Per-key fixed-window rate limiter (SEC-M1-1/2/3). Shared across the REST
 * create/lookup paths and the ws join path so a single IP cannot flood any of
 * them. Windows are coarse; a party game does not need per-request precision.
 */
export class IpRateLimiter {
  private windows = new Map<string, { start: number; count: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** True if allowed; false if the key is over its limit this window. */
  hit(key: string): boolean {
    const t = this.now();
    const w = this.windows.get(key);
    if (w === undefined || t - w.start >= this.windowMs) {
      this.windows.set(key, { start: t, count: 1 });
      return true;
    }
    w.count += 1;
    return w.count <= this.limit;
  }

  /** Drop stale windows so the map cannot grow without bound. */
  sweep(): void {
    const t = this.now();
    for (const [key, w] of this.windows) {
      if (t - w.start >= this.windowMs) this.windows.delete(key);
    }
  }
}

/** Per-key concurrency cap (SEC-M1-3: concurrent sockets per IP). */
export class ConcurrencyLimiter {
  private counts = new Map<string, number>();
  constructor(private readonly max: number) {}

  acquire(key: string): boolean {
    const n = this.counts.get(key) ?? 0;
    if (n >= this.max) return false;
    this.counts.set(key, n + 1);
    return true;
  }
  release(key: string): void {
    const n = this.counts.get(key) ?? 0;
    if (n <= 1) this.counts.delete(key);
    else this.counts.set(key, n - 1);
  }
  current(key: string): number {
    return this.counts.get(key) ?? 0;
  }
}

/** Constant-time secret comparison (SEC-M1-4). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
