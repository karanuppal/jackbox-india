/**
 * Per-connection sliding-window rate limiter (SEC-M0-13/§8.3: message flooding
 * guard). Fixed window is enough for a turn-based game.
 */
export class RateLimiter {
  private count = 0;
  private windowStart: number;
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(limitPerSec: number, now: () => number = Date.now) {
    this.limit = limitPerSec;
    this.windowMs = 1000;
    this.now = now;
    this.windowStart = now();
  }

  /** Returns true if this message is allowed; false if the limit is exceeded. */
  allow(): boolean {
    const t = this.now();
    if (t - this.windowStart >= this.windowMs) {
      this.windowStart = t;
      this.count = 0;
    }
    this.count += 1;
    return this.count <= this.limit;
  }
}
