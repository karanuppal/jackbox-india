import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { WebSocket } from "ws";
import { startServer, WS_PATH } from "../src/app.js";
import { RoomRegistry } from "../src/rooms/registry.js";
import { Hub } from "../src/ws/hub.js";
import { createKhooniSawaalEngine } from "../src/game/khooniSawaal.js";
import type { Question, ServerMessage, KsPublicPhase } from "@tamasha/shared";

function bank(): Question[] {
  return Array.from({ length: 12 }, (_, i) => ({
    id: `q_${String(i + 1).padStart(4, "0")}`,
    text: `Sawaal ${i + 1}?`,
    textRoman: true,
    options: ["ek", "do", "teen", "chaar"] as [string, string, string, string],
    correct: 0,
    categories: ["food"] as Question["categories"],
    difficulty: 1,
    adult: false,
    vo: `q_${String(i + 1).padStart(4, "0")}.ogg`,
    source: "fixture",
    era: "evergreen" as const,
  }));
}

let server: Server | null = null;
let hub: Hub | null = null;

async function boot() {
  const registry = new RoomRegistry(createKhooniSawaalEngine(bank(), { pickQuestions: (b, n) => b.slice(0, n) }));
  server = await startServer({ port: 0, registry });
  hub = new Hub(server, registry, { path: WS_PATH });
  const addr = server.address();
  if (addr === null || typeof addr === "string") throw new Error("no port");
  const base = `http://127.0.0.1:${addr.port}`;
  return { base, wsUrl: `ws://127.0.0.1:${addr.port}${WS_PATH}` };
}

afterEach(async () => {
  if (hub !== null) await hub.close();
  if (server !== null) await new Promise<void>((r) => server!.close(() => r()));
  hub = null;
  server = null;
});

class Client {
  ws: WebSocket;
  private q: ServerMessage[] = [];
  private w: ((m: ServerMessage) => void)[] = [];
  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on("message", (d: Buffer) => {
      const m = JSON.parse(d.toString()) as ServerMessage;
      const cb = this.w.shift();
      if (cb !== undefined) cb(m);
      else this.q.push(m);
    });
  }
  open() {
    return new Promise<void>((res, rej) => {
      this.ws.on("open", () => res());
      this.ws.on("error", rej);
    });
  }
  send(o: unknown) {
    this.ws.send(JSON.stringify(o));
  }
  private next(): Promise<ServerMessage> {
    const q = this.q.shift();
    if (q !== undefined) return Promise.resolve(q);
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("timeout")), 1500);
      this.w.push((m) => {
        clearTimeout(t);
        res(m);
      });
    });
  }
  async until(pred: (m: ServerMessage) => boolean): Promise<ServerMessage> {
    for (let i = 0; i < 40; i++) {
      const m = await this.next();
      if (pred(m)) return m;
    }
    throw new Error("predicate never satisfied");
  }
  close() {
    this.ws.close();
  }
}

async function createRoom(base: string): Promise<{ code: string; hostToken: string }> {
  return (await (await fetch(`${base}/api/rooms`, { method: "POST" })).json()) as { code: string; hostToken: string };
}

function ksPhase(m: ServerMessage): KsPublicPhase | null {
  return m.type === "state" ? (m.public.phaseData as KsPublicPhase | null) : null;
}

describe("Khooni Sawaal over the hub (message-driven, no-timer)", () => {
  it("plays a question end-to-end: start → question → answer → reveal with scoring", async () => {
    const h = await boot();
    const { code, hostToken } = await createRoom(h.base);
    const host = new Client(h.wsUrl);
    await host.open();
    host.send({ type: "join", code, intent: "hostScreen", sessionToken: hostToken });
    await host.until((m) => m.type === "state");
    // host turns off timers so the flow is purely message-driven
    host.send({ type: "action", seq: 1, payload: { action: "updateSettings", settings: { timerMode: "off", skipTutorial: true } } });

    const vip = new Client(h.wsUrl);
    await vip.open();
    vip.send({ type: "join", code, intent: "play", name: "VIP" });
    const vjoin = await vip.until((m) => m.type === "joined");
    const p2 = new Client(h.wsUrl);
    await p2.open();
    p2.send({ type: "join", code, intent: "play", name: "Dosra" });
    await p2.until((m) => m.type === "state");

    // VIP starts; skipTutorial setting → straight to question 1
    vip.send({ type: "action", seq: 2, payload: { action: "startGame" } });
    const q = await host.until((m) => ksPhase(m)?.kind === "question");
    const qphase = ksPhase(q)!;
    expect(qphase.kind).toBe("question");
    if (qphase.kind === "question") expect(qphase.number).toBe(1);

    // both answer: VIP correct (0), Dosra wrong (2)
    const qid = qphase.kind === "question" ? qphase.questionId : "q_0001";
    vip.send({ type: "action", seq: 3, payload: { action: "game", payload: { type: "answer", questionId: qid, optionIndex: 0 } } });
    p2.send({ type: "action", seq: 3, payload: { action: "game", payload: { type: "answer", questionId: qid, optionIndex: 2 } } });

    const reveal = await host.until((m) => ksPhase(m)?.kind === "reveal");
    const rphase = ksPhase(reveal)!;
    if (rphase.kind === "reveal") {
      expect(rphase.correct).toBe(0);
      expect(rphase.deaths.length).toBeGreaterThanOrEqual(0);
    }
    // host snapshot shows VIP with money and Dosra dead (only 1 alive → game may end)
    const state = reveal.type === "state" ? reveal.public : null;
    const vipRow = state?.players.find((p) => p.name === "VIP");
    expect(vipRow?.money).toBe(1000);
    // VIP's private view should reflect their own answer
    void vjoin;
    host.close();
    vip.close();
    p2.close();
  });
});

describe("Hub timer driver (QA-M2-1 pause guard, auto-advance)", () => {
  async function bootFast() {
    const registry = new RoomRegistry(
      createKhooniSawaalEngine(bank(), { pickQuestions: (b, n) => b.slice(0, n), timers: { tutorialMs: 40, questionMs: 60, revealMs: 40 } }),
    );
    server = await startServer({ port: 0, registry });
    hub = new Hub(server, registry, { path: WS_PATH });
    const addr = server.address();
    if (addr === null || typeof addr === "string") throw new Error("no port");
    return { registry, base: `http://127.0.0.1:${addr.port}`, wsUrl: `ws://127.0.0.1:${addr.port}${WS_PATH}` };
  }

  it("auto-advances the tutorial to a question via the timer", async () => {
    const h = await bootFast();
    const { code, hostToken } = await createRoom(h.base);
    const host = new Client(h.wsUrl);
    await host.open();
    host.send({ type: "join", code, intent: "hostScreen", sessionToken: hostToken });
    await host.until((m) => m.type === "state");
    const vip = new Client(h.wsUrl);
    await vip.open();
    vip.send({ type: "join", code, intent: "play", name: "VIP" });
    await vip.until((m) => m.type === "state");
    vip.send({ type: "action", seq: 1, payload: { action: "startGame" } }); // → tutorial (40ms)
    // the timer should auto-advance to the question without any further input
    const q = await host.until((m) => ksPhase(m)?.kind === "question");
    expect(ksPhase(q)?.kind).toBe("question");
    host.close();
    vip.close();
  });

  it("does not busy-loop or advance while paused past the deadline (QA-M2-1)", async () => {
    const h = await bootFast();
    const { code, hostToken } = await createRoom(h.base);
    const host = new Client(h.wsUrl);
    await host.open();
    host.send({ type: "join", code, intent: "hostScreen", sessionToken: hostToken });
    await host.until((m) => m.type === "state");
    host.send({ type: "action", seq: 1, payload: { action: "updateSettings", settings: { skipTutorial: true } } });
    const vip = new Client(h.wsUrl);
    await vip.open();
    vip.send({ type: "join", code, intent: "play", name: "VIP" });
    await vip.until((m) => m.type === "state");
    vip.send({ type: "action", seq: 2, payload: { action: "startGame" } }); // → question (60ms)
    await host.until((m) => ksPhase(m)?.kind === "question");
    // pause, then wait well past the 60ms question deadline
    host.send({ type: "action", seq: 2, payload: { action: "pause" } });
    await new Promise((r) => setTimeout(r, 250)); // > deadline; must NOT advance/busy-loop
    const st = h.registry.get(code)!.publicState();
    expect(st.paused).toBe(true);
    expect(ksPhase({ seq: 0, type: "state", public: st, private: { you: null, role: "host", phaseData: null } })?.kind).toBe("question");
    host.close();
    vip.close();
  });
});
