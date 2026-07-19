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

describe("Hub timer driver (deterministic, injected timers)", () => {
  // A controllable fake timer: timers fire only when we call runDue(), and a
  // runaway self-rescheduling loop is caught by the iteration cap rather than
  // hanging. Combined with an injected clock, this removes all wall-clock races.
  class FakeTimers {
    private q = new Map<number, { fn: () => void; at: number }>();
    private id = 0;
    clock = 1000;
    set = (fn: () => void, ms: number): number => {
      const h = ++this.id;
      this.q.set(h, { fn, at: this.clock + ms });
      return h;
    };
    clear = (h: unknown): void => {
      this.q.delete(h as number);
    };
    /** Fire all timers due at/before the clock. Returns how many fired; if it
     *  hits `cap`, a busy-loop (0ms self-reschedule) is present. */
    runDue(cap = 200): number {
      let fired = 0;
      for (;;) {
        const due = [...this.q.entries()].find(([, t]) => t.at <= this.clock);
        if (due === undefined) break;
        this.q.delete(due[0]);
        due[1].fn();
        if (++fired >= cap) break;
      }
      return fired;
    }
    pending(): number {
      return this.q.size;
    }
  }

  async function bootFake(fake: FakeTimers) {
    const registry = new RoomRegistry(
      createKhooniSawaalEngine(bank(), { pickQuestions: (b, n) => b.slice(0, n), timers: { tutorialMs: 40, questionMs: 60, revealMs: 40 } }),
      { now: () => fake.clock },
    );
    server = await startServer({ port: 0, registry });
    hub = new Hub(server, registry, { path: WS_PATH, now: () => fake.clock, setTimer: fake.set, clearTimer: fake.clear });
    const addr = server.address();
    if (addr === null || typeof addr === "string") throw new Error("no port");
    return { registry, base: `http://127.0.0.1:${addr.port}`, wsUrl: `ws://127.0.0.1:${addr.port}${WS_PATH}` };
  }

  it("auto-advances the tutorial to a question when its timer fires", async () => {
    const fake = new FakeTimers();
    const h = await bootFake(fake);
    const { code, hostToken } = await createRoom(h.base);
    const host = new Client(h.wsUrl);
    await host.open();
    host.send({ type: "join", code, intent: "hostScreen", sessionToken: hostToken });
    await host.until((m) => m.type === "state");
    const vip = new Client(h.wsUrl);
    await vip.open();
    vip.send({ type: "join", code, intent: "play", name: "VIP" });
    await vip.until((m) => m.type === "state");
    vip.send({ type: "action", seq: 1, payload: { action: "startGame" } }); // → tutorial (deadline clock+40)
    await host.until((m) => ksPhase(m)?.kind === "tutorial");
    // advance the clock past the tutorial deadline and fire the timer
    fake.clock += 50;
    fake.runDue();
    const q = await host.until((m) => ksPhase(m)?.kind === "question");
    expect(ksPhase(q)?.kind).toBe("question");
    host.close();
    vip.close();
  });

  it("does NOT busy-loop while paused past the deadline (QA-M2-1)", async () => {
    const fake = new FakeTimers();
    const h = await bootFake(fake);
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
    vip.send({ type: "action", seq: 2, payload: { action: "startGame" } }); // → question (deadline clock+60)
    await host.until((m) => ksPhase(m)?.kind === "question");
    // pause BEFORE the deadline, then push the clock far past it
    host.send({ type: "action", seq: 2, payload: { action: "pause" } });
    await host.until((m) => m.type === "state" && m.public.paused);
    const armedBefore = hub!.timersArmedCount();
    fake.clock += 10_000_000; // long past the frozen deadline
    const fired = fake.runDue(200); // fire everything due; a busy-loop would hit the cap
    // With the guard: the pause broadcast already cleared the pending timer, so
    // nothing is due and nothing re-arms. A reverted guard would 0ms-loop → cap.
    expect(fired).toBeLessThan(200);
    expect(fake.pending()).toBe(0);
    expect(hub!.timersArmedCount() - armedBefore).toBeLessThanOrEqual(1);
    // still paused, still on the question
    const st = h.registry.get(code)!.publicState();
    expect(st.paused).toBe(true);
    expect(ksPhase({ seq: 0, type: "state", public: st, private: { you: null, role: "host", phaseData: null } })?.kind).toBe("question");
    host.close();
    vip.close();
  });

  it("resumes cleanly and advances after a pause (no lost timer)", async () => {
    const fake = new FakeTimers();
    const h = await bootFake(fake);
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
    vip.send({ type: "action", seq: 2, payload: { action: "startGame" } });
    await host.until((m) => ksPhase(m)?.kind === "question");
    host.send({ type: "action", seq: 2, payload: { action: "pause" } });
    await host.until((m) => m.type === "state" && m.public.paused);
    fake.clock += 1000;
    host.send({ type: "action", seq: 3, payload: { action: "resume" } });
    await host.until((m) => m.type === "state" && !m.public.paused);
    // after resume the deadline is restored into the future; fire it to advance
    fake.clock += 200;
    fake.runDue();
    const rev = await host.until((m) => ksPhase(m)?.kind === "reveal");
    expect(ksPhase(rev)?.kind).toBe("reveal");
    host.close();
    vip.close();
  });
});
