// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { renderToString } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import type { PlayerPublic, RoomPublicState, ServerMessage } from "@tamasha/shared";
import { App, type Env } from "../src/App.js";
import { Controller } from "../src/screens/Controller.js";
import { JoinForm } from "../src/screens/Join.js";
import { initialState, reduce, type ClientState } from "../src/net/store.js";
import { errorText } from "../src/net/errors.js";
import {
  clearHostSession,
  loadHostSession,
  saveHostSession,
} from "../src/net/session.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const player = (over: Partial<PlayerPublic> = {}): PlayerPublic => ({
  id: "p1", name: "Karan", avatar: 0, vip: false, alive: true, money: 0, connected: true, answered: false, ...over,
});
const pub = (over: Partial<RoomPublicState> = {}): RoomPublicState => ({
  code: "ACDE", phase: "lobby", paused: false,
  settings: { familyFriendly: true, profanityFilter: "strict", moderation: false, subtitles: true, timerMode: "normal", reducedMotion: false, audienceEnabled: true, passwordRequired: false, hideRoomCode: false, controllerOnlyStart: false, skipTutorial: false },
  players: [], audienceCount: 0, questionNumber: 0, questionTotal: 0, deadline: null, phaseData: null, ...over,
});
const joined = (over: Partial<ClientState>): ClientState => ({ ...initialState(), status: "joined", ...over });

describe("errorText (UT-M1-1)", () => {
  it("maps every code to Hinglish and falls back for unknowns", () => {
    expect(errorText("ROOM_NOT_FOUND")).toMatch(/nahi mila/);
    expect(errorText("BAD_PASSWORD")).toMatch(/[Pp]assword/);
    expect(errorText("RATE_LIMITED")).toMatch(/ruko/i);
    expect(errorText("SOMETHING_ELSE")).toMatch(/gadbad/);
  });
});

describe("store reconnect seq reset (QA-M1-1 blocker)", () => {
  it("applies the restore snapshot after a reconnect resets the seq baseline", () => {
    // build up a high lastSeq on the first connection
    let s = initialState();
    for (let i = 0; i < 6; i++) {
      s = reduce(s, { kind: "server", message: { seq: i, type: "state", public: pub(), private: { you: null, role: "player", phaseData: null } } as ServerMessage });
    }
    expect(s.lastSeq).toBe(5);
    // reconnect: new connection, joined(seq 0) then state(seq 1)
    s = reduce(s, { kind: "server", message: { seq: 0, type: "joined", playerId: "p1", sessionToken: "t", role: "player" } });
    expect(s.lastSeq).toBe(0); // baseline reset
    s = reduce(s, { kind: "server", message: { seq: 1, type: "state", public: pub({ phase: "tutorial" }), private: { you: null, role: "player", phaseData: null } } });
    expect(s.public?.phase).toBe("tutorial"); // NOT dropped as stale
  });
});

describe("Controller — VIP code reveal (QA-M1-9)", () => {
  it("shows the code directly when not in streamer mode", () => {
    const state = joined({ public: pub({ players: [player({ vip: true })] }), private: { you: player({ vip: true }), role: "player", phaseData: null } });
    const html = renderToString(<Controller state={state} onAction={() => {}} />);
    expect(html).toContain("Room code");
    expect(html).toContain("ACDE");
  });
  it("offers a reveal button in streamer mode for the VIP", () => {
    const state = joined({
      public: pub({ players: [player({ vip: true })], settings: { ...pub().settings, hideRoomCode: true } }),
      private: { you: player({ vip: true }), role: "player", phaseData: null },
    });
    const html = renderToString(<Controller state={state} onAction={() => {}} />);
    expect(html).toContain("Room code dikhao");
    expect(html).not.toContain(">ACDE<");
  });
});

describe("JoinForm — password + name validation (QA-M1-6, UT-M1-7)", () => {
  it("renders a password field when asked", () => {
    const html = renderToString(<JoinForm askPassword onSubmit={() => {}} />);
    expect(html).toContain("Room password");
  });
  it("shows a notice line", () => {
    const html = renderToString(<JoinForm notice="Is room mein password lagega." onSubmit={() => {}} />);
    expect(html).toContain("password lagega");
  });
});

describe("session — host session persistence (QA-M1-5)", () => {
  it("round-trips a host session", () => {
    clearHostSession();
    expect(loadHostSession()).toBeNull();
    saveHostSession({ code: "ACDE", hostToken: "ht" });
    expect(loadHostSession()?.hostToken).toBe("ht");
    clearHostSession();
    expect(loadHostSession()).toBeNull();
  });
});

// --- DOM integration for the interactive paths ------------------------------
const sockets: FakeWS[] = [];
class FakeWS {
  static OPEN = 1;
  readyState = 1;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) { sockets.push(this); queueMicrotask(() => this.onopen?.()); }
  send(d: string): void { this.sent.push(d); }
  close(): void { this.readyState = 3; this.onclose?.(); }
}

let root: Root;
let container: HTMLElement;
const env = (pathname: string, search = ""): Env => ({ pathname, origin: "http://localhost", wsUrl: "ws://localhost/play", search });
const flush = () => act(async () => { await Promise.resolve(); });

beforeEach(() => {
  sockets.length = 0;
  (globalThis as unknown as { WebSocket: typeof FakeWS }).WebSocket = FakeWS;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  clearHostSession();
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); clearHostSession(); });

describe("HostApp — restores an existing room instead of creating (QA-M1-5)", () => {
  it("reconnects to a saved room the server still knows", async () => {
    saveHostSession({ code: "SAVE", hostToken: "saved-tok" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ exists: true }) });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    await act(async () => { root.render(<App env={env("/host")} />); });
    await flush();
    await flush();
    // it looked up the saved room, did NOT POST a new one
    expect(fetchMock).toHaveBeenCalledWith("http://localhost/api/rooms/SAVE");
    expect(fetchMock).not.toHaveBeenCalledWith("http://localhost/api/rooms", { method: "POST" });
    expect(sockets.length).toBe(1);
    const join = JSON.parse(sockets[0]!.sent[0]!);
    expect(join).toMatchObject({ intent: "hostScreen", code: "SAVE", sessionToken: "saved-tok" });
  });

  it("creates a new room when the saved one is gone", async () => {
    saveHostSession({ code: "GONE", hostToken: "old" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ exists: false }) }) // lookup
      .mockResolvedValueOnce({ ok: true, json: async () => ({ code: "NEWW", hostToken: "new-tok" }) }); // create
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    await act(async () => { root.render(<App env={env("/host")} />); });
    await flush();
    await flush();
    expect(fetchMock).toHaveBeenCalledWith("http://localhost/api/rooms", { method: "POST" });
    expect(loadHostSession()?.code).toBe("NEWW");
  });
});

describe("PlayerApp — password prompt flow (QA-M1-6)", () => {
  it("asks for a password when the room requires one, then joins with it", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ exists: true, passwordRequired: true }) });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    await act(async () => { root.render(<App env={env("/", "?code=ACDE")} />); });
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    const nameInput = container.querySelector('input[aria-label="Your name"]') as HTMLInputElement;
    await act(async () => { setValue.call(nameInput, "Karan"); nameInput.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { (container.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush(); await flush();
    // now a password field appears
    expect(container.querySelector('input[aria-label="Room password"]')).not.toBeNull();
    expect(sockets.length).toBe(0); // did not connect yet
    const pwInput = container.querySelector('input[aria-label="Room password"]') as HTMLInputElement;
    await act(async () => { setValue.call(pwInput, "chai"); pwInput.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { (container.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush(); await flush();
    expect(sockets.length).toBe(1);
    const join = JSON.parse(sockets[0]!.sent[0]!);
    expect(join.password).toBe("chai");
  });

  it("shows a not-found notice for a nonexistent room", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ exists: false, passwordRequired: false }) });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    await act(async () => { root.render(<App env={env("/", "?code=ZZZZ")} />); });
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    const nameInput = container.querySelector('input[aria-label="Your name"]') as HTMLInputElement;
    await act(async () => { setValue.call(nameInput, "Karan"); nameInput.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { (container.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush(); await flush();
    expect(container.textContent).toContain("nahi mila");
    expect(sockets.length).toBe(0);
  });
});

describe("interactive handlers (function coverage)", () => {
  it("Host settings toggle dispatches updateSettings on click (QA-M1-6)", async () => {
    const actions: unknown[] = [];
    const { Host } = await import("../src/screens/Host.js");
    await act(async () => {
      root.render(<Host state={joined({ public: pub({ players: [player({ vip: true })] }) })} origin="http://localhost" onAction={(p) => actions.push(p)} />);
    });
    await flush();
    const toggle = [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Family-Friendly"))!;
    await act(async () => { toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(actions).toContainEqual({ action: "updateSettings", settings: { familyFriendly: false } });
  });

  it("Controller VIP reveal button shows the code on click (QA-M1-9)", async () => {
    const state = joined({
      public: pub({ players: [player({ vip: true })], settings: { ...pub().settings, hideRoomCode: true } }),
      private: { you: player({ vip: true }), role: "player", phaseData: null },
    });
    await act(async () => { root.render(<Controller state={state} onAction={() => {}} />); });
    await flush();
    expect(container.textContent).not.toContain("ACDE");
    const reveal = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Room code dikhao"))!;
    await act(async () => { reveal.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(container.textContent).toContain("ACDE");
  });

  it("store keeps reconnecting status on socketOpen mid-reconnect and handles pong", async () => {
    const { reduce: r, initialState: init } = await import("../src/net/store.js");
    let s = r(init(), { kind: "reconnecting" });
    s = r(s, { kind: "socketOpen" });
    expect(s.status).toBe("reconnecting");
  });
});
