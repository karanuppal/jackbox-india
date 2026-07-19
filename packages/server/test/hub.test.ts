import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { WebSocket } from "ws";
import { startServer, WS_PATH } from "../src/app.js";
import { RoomRegistry } from "../src/rooms/registry.js";
import { Hub } from "../src/ws/hub.js";
import { createLobbyStubEngine } from "../src/game/lobbyStub.js";
import { ConcurrencyLimiter, IpRateLimiter } from "../src/net/ipLimits.js";
import type { HubOptions } from "../src/ws/hub.js";
import type { ServerMessage } from "@tamasha/shared";

let server: Server | null = null;
let hub: Hub | null = null;

interface Harness {
  base: string;
  wsUrl: string;
  registry: RoomRegistry;
}

async function boot(hubOpts: Partial<HubOptions> = {}): Promise<Harness> {
  const registry = new RoomRegistry(createLobbyStubEngine);
  server = await startServer({ port: 0, registry });
  hub = new Hub(server, registry, { path: WS_PATH, ...hubOpts });
  const addr = server.address();
  if (addr === null || typeof addr === "string") throw new Error("no port");
  return { base: `http://127.0.0.1:${addr.port}`, wsUrl: `ws://127.0.0.1:${addr.port}${WS_PATH}`, registry };
}

afterEach(async () => {
  if (hub !== null) await hub.close();
  if (server !== null) await new Promise<void>((r) => server!.close(() => r()));
  hub = null;
  server = null;
});

/** A tiny promise-based ws client that queues incoming server messages. */
class Client {
  ws: WebSocket;
  private queue: ServerMessage[] = [];
  private waiters: ((m: ServerMessage) => void)[] = [];
  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on("message", (d: Buffer) => {
      const m = JSON.parse(d.toString()) as ServerMessage;
      const w = this.waiters.shift();
      if (w !== undefined) w(m);
      else this.queue.push(m);
    });
  }
  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.on("open", () => resolve());
      this.ws.on("error", reject);
    });
  }
  send(obj: unknown): void {
    this.ws.send(JSON.stringify(obj));
  }
  next(timeoutMs = 1500): Promise<ServerMessage> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout waiting for message")), timeoutMs);
      this.waiters.push((m) => {
        clearTimeout(t);
        resolve(m);
      });
    });
  }
  /** Wait until a message satisfying pred arrives (drains intermediate ones). */
  async until(pred: (m: ServerMessage) => boolean): Promise<ServerMessage> {
    for (let i = 0; i < 20; i++) {
      const m = await this.next();
      if (pred(m)) return m;
    }
    throw new Error("predicate never satisfied");
  }
  close(): void {
    this.ws.close();
  }
}

async function createRoom(base: string): Promise<{ code: string; hostToken: string }> {
  const res = await fetch(`${base}/api/rooms`, { method: "POST" });
  return (await res.json()) as { code: string; hostToken: string };
}

describe("Hub — join & broadcast", () => {
  it("host screen joins with its token and receives state", async () => {
    const h = await boot();
    const { code, hostToken } = await createRoom(h.base);
    const host = new Client(h.wsUrl);
    await host.open();
    host.send({ type: "join", code, intent: "hostScreen", sessionToken: hostToken });
    const joined = await host.next();
    expect(joined.type).toBe("joined");
    if (joined.type === "joined") expect(joined.role).toBe("host");
    const state = await host.until((m) => m.type === "state");
    if (state.type === "state") expect(state.public.phase).toBe("lobby");
    host.close();
  });

  it("player join broadcasts to the host screen", async () => {
    const h = await boot();
    const { code, hostToken } = await createRoom(h.base);
    const host = new Client(h.wsUrl);
    await host.open();
    host.send({ type: "join", code, intent: "hostScreen", sessionToken: hostToken });
    await host.until((m) => m.type === "state");

    const player = new Client(h.wsUrl);
    await player.open();
    player.send({ type: "join", code, intent: "play", name: "Karan" });
    const pjoined = await player.next();
    expect(pjoined.type).toBe("joined");

    // host should see the player appear
    const hostState = await host.until((m) => m.type === "state" && m.public.players.length === 1);
    if (hostState.type === "state") {
      expect(hostState.public.players[0]!.name).toBe("Karan");
      expect(hostState.public.players[0]!.vip).toBe(true);
    }
    host.close();
    player.close();
  });

  it("rejects join to a nonexistent room", async () => {
    const h = await boot();
    const c = new Client(h.wsUrl);
    await c.open();
    c.send({ type: "join", code: "ZZZZ", intent: "play", name: "X" });
    const m = await c.next();
    expect(m.type).toBe("error");
    if (m.type === "error") expect(m.code).toBe("ROOM_NOT_FOUND");
    c.close();
  });

  it("rejects a bad host token", async () => {
    const h = await boot();
    const { code } = await createRoom(h.base);
    const c = new Client(h.wsUrl);
    await c.open();
    c.send({ type: "join", code, intent: "hostScreen", sessionToken: "11111111-1111-1111-1111-111111111111" });
    const m = await c.next();
    expect(m.type).toBe("error");
    if (m.type === "error") expect(m.code).toBe("NOT_ALLOWED");
    c.close();
  });

  it("VIP start transitions the room and all clients see it", async () => {
    const h = await boot();
    const { code, hostToken } = await createRoom(h.base);
    const host = new Client(h.wsUrl);
    await host.open();
    host.send({ type: "join", code, intent: "hostScreen", sessionToken: hostToken });
    await host.until((m) => m.type === "state");
    const vip = new Client(h.wsUrl);
    await vip.open();
    vip.send({ type: "join", code, intent: "play", name: "VIP" });
    await vip.until((m) => m.type === "state");

    vip.send({ type: "action", seq: 1, payload: { action: "startGame" } });
    const started = await host.until((m) => m.type === "state" && m.public.phase === "tutorial");
    expect(started.type).toBe("state");
    host.close();
    vip.close();
  });

  it("non-VIP cannot start the game", async () => {
    const h = await boot();
    const { code } = await createRoom(h.base);
    const vip = new Client(h.wsUrl);
    await vip.open();
    vip.send({ type: "join", code, intent: "play", name: "VIP" });
    await vip.until((m) => m.type === "state");
    const other = new Client(h.wsUrl);
    await other.open();
    other.send({ type: "join", code, intent: "play", name: "Other" });
    await other.until((m) => m.type === "state");

    other.send({ type: "action", seq: 1, payload: { action: "startGame" } });
    const err = await other.until((m) => m.type === "error");
    if (err.type === "error") expect(err.code).toBe("NOT_ALLOWED");
    vip.close();
    other.close();
  });
});

describe("Hub — reconnection", () => {
  it("restores a player's seat with the session token", async () => {
    const h = await boot();
    const { code } = await createRoom(h.base);
    const p1 = new Client(h.wsUrl);
    await p1.open();
    p1.send({ type: "join", code, intent: "play", name: "Karan" });
    const joined = await p1.next();
    if (joined.type !== "joined") throw new Error("expected joined");
    const token = joined.sessionToken;
    const pid = joined.playerId;
    p1.close();
    await new Promise((r) => setTimeout(r, 50));

    // reconnect with the same token
    const p2 = new Client(h.wsUrl);
    await p2.open();
    p2.send({ type: "join", code, intent: "play", sessionToken: token });
    const rejoined = await p2.next();
    expect(rejoined.type).toBe("joined");
    if (rejoined.type === "joined") {
      expect(rejoined.playerId).toBe(pid);
      expect(rejoined.role).toBe("player");
    }
    const state = await p2.until((m) => m.type === "state");
    if (state.type === "state") {
      expect(state.public.players[0]!.connected).toBe(true);
    }
    p2.close();
  });
});

describe("Hub — hardening", () => {
  it("rejects oversized frames without crashing", async () => {
    const h = await boot();
    const { code } = await createRoom(h.base);
    const c = new Client(h.wsUrl);
    await c.open();
    c.send({ type: "join", code, intent: "play", name: "X" });
    await c.until((m) => m.type === "state");
    // 5 KB payload exceeds MAX_CLIENT_FRAME_BYTES (4 KB)
    c.ws.send(JSON.stringify({ type: "action", seq: 2, payload: { action: "game", payload: "x".repeat(5000) } }));
    // The ws maxPayload closes the socket on oversize; assert the server survives
    // by confirming a fresh client can still join.
    await new Promise((r) => setTimeout(r, 50));
    const c2 = new Client(h.wsUrl);
    await c2.open();
    c2.send({ type: "join", code, intent: "play", name: "Y" });
    const m = await c2.next();
    expect(m.type).toBe("joined");
    c.close();
    c2.close();
  });

  it("rejects malformed json and unknown message shapes", async () => {
    const h = await boot();
    const c = new Client(h.wsUrl);
    await c.open();
    c.ws.send("this is not json");
    const m1 = await c.next();
    expect(m1.type).toBe("error");
    c.ws.send(JSON.stringify({ type: "bogus" }));
    const m2 = await c.next();
    expect(m2.type).toBe("error");
    c.close();
  });

  it("ignores stale/replayed action seq", async () => {
    const h = await boot();
    const { code } = await createRoom(h.base);
    const vip = new Client(h.wsUrl);
    await vip.open();
    vip.send({ type: "join", code, intent: "play", name: "VIP" });
    await vip.until((m) => m.type === "state");
    // seq 0 then a replay at seq 0 — the second must be ignored (no phase change)
    vip.send({ type: "action", seq: 5, payload: { action: "pause" } });
    // pause is host-only, so this errors — but the seq is still consumed
    await vip.until((m) => m.type === "error");
    vip.send({ type: "action", seq: 5, payload: { action: "startGame" } });
    // replayed seq 5 is ignored → no state change; send a fresh higher seq
    vip.send({ type: "action", seq: 6, payload: { action: "startGame" } });
    const started = await vip.until((m) => m.type === "state" && m.public.phase === "tutorial");
    expect(started.type).toBe("state");
    vip.close();
  });

  it("responds to ping with pong", async () => {
    const h = await boot();
    const c = new Client(h.wsUrl);
    await c.open();
    c.send({ type: "ping" });
    const m = await c.next();
    expect(m.type).toBe("pong");
    c.close();
  });

  it("requires join before actions", async () => {
    const h = await boot();
    const c = new Client(h.wsUrl);
    await c.open();
    c.send({ type: "action", seq: 1, payload: { action: "pause" } });
    const m = await c.next();
    expect(m.type).toBe("error");
    if (m.type === "error") expect(m.code).toBe("NOT_ALLOWED");
    c.close();
  });
});

describe("Hub — rate limiting", () => {
  it("rate-limits a flood of messages", async () => {
    const h = await boot();
    const c = new Client(h.wsUrl);
    await c.open();
    // WS_MESSAGES_PER_SEC is 10; fire 20 pings fast in one window
    for (let i = 0; i < 20; i++) c.send({ type: "ping" });
    let sawRateLimited = false;
    for (let i = 0; i < 20; i++) {
      const m = await c.next();
      if (m.type === "error" && m.code === "RATE_LIMITED") {
        sawRateLimited = true;
        break;
      }
    }
    expect(sawRateLimited).toBe(true);
    c.close();
  });

  it("rejects a second join on the same socket", async () => {
    const h = await boot();
    const { code } = await createRoom(h.base);
    const c = new Client(h.wsUrl);
    await c.open();
    c.send({ type: "join", code, intent: "play", name: "X" });
    await c.until((m) => m.type === "joined");
    c.send({ type: "join", code, intent: "play", name: "Y" });
    const err = await c.until((m) => m.type === "error");
    if (err.type === "error") expect(err.code).toBe("BAD_MESSAGE");
    c.close();
  });
});

describe("Hub — M1 hardening", () => {
  it("evicts an overlapping socket for the same identity; the live seat stays connected (QA-M1-2)", async () => {
    const h = await boot();
    const { code } = await createRoom(h.base);
    const p1 = new Client(h.wsUrl);
    await p1.open();
    p1.send({ type: "join", code, intent: "play", name: "Karan" });
    const joined = await p1.next();
    if (joined.type !== "joined") throw new Error("join");
    // second socket rejoins with the same token (overlap, old socket lingers)
    const p2 = new Client(h.wsUrl);
    await p2.open();
    p2.send({ type: "join", code, intent: "play", sessionToken: joined.sessionToken });
    await p2.until((m) => m.type === "joined");
    // p1's socket gets closed by the server (superseded); wait for it
    await new Promise((r) => setTimeout(r, 100));
    // p2 should see itself still connected (not flipped offline by p1's close)
    const state = await p2.until((m) => m.type === "state" && m.public.players.length === 1);
    if (state.type === "state") expect(state.public.players[0]!.connected).toBe(true);
    p2.close();
  });

  it("throttles join attempts per IP (SEC-M1-2)", async () => {
    const limiter = new IpRateLimiter(2, 60_000);
    const h = await boot({ joinLimiter: limiter });
    const { code } = await createRoom(h.base);
    const results: string[] = [];
    for (let i = 0; i < 4; i++) {
      const c = new Client(h.wsUrl);
      await c.open();
      c.send({ type: "join", code, intent: "play", name: `P${i}` });
      const m = await c.next();
      results.push(m.type === "error" ? m.code : m.type);
      c.close();
    }
    // first 2 join, rest are rate-limited
    expect(results.filter((r) => r === "RATE_LIMITED").length).toBeGreaterThanOrEqual(1);
  });

  it("caps concurrent connections per IP (SEC-M1-3)", async () => {
    const h = await boot({ connLimiter: new ConcurrencyLimiter(1) });
    const c1 = new Client(h.wsUrl);
    await c1.open();
    const c2 = new Client(h.wsUrl);
    // second socket should be closed by the server almost immediately
    const closed = await new Promise<boolean>((resolve) => {
      c2.ws.on("close", () => resolve(true));
      c2.ws.on("open", () => setTimeout(() => resolve(c2.ws.readyState === 3), 200));
    });
    expect(closed).toBe(true);
    c1.close();
  });

  it("drops a socket that never joins within the timeout (SEC-M1-3)", async () => {
    const h = await boot({ joinTimeoutMs: 80 });
    const c = new Client(h.wsUrl);
    await c.open();
    const closed = await new Promise<boolean>((resolve) => {
      c.ws.on("close", () => resolve(true));
      setTimeout(() => resolve(false), 500);
    });
    expect(closed).toBe(true);
  });
});
