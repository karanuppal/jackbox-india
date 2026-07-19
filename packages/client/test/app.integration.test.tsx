// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App, type Env } from "../src/App.js";
import type { ServerMessage } from "@tamasha/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// --- fake global WebSocket ---------------------------------------------------
const sockets: FakeWS[] = [];
class FakeWS {
  static OPEN = 1;
  url: string;
  readyState = 1;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  sent: string[] = [];
  constructor(url: string) {
    this.url = url;
    sockets.push(this);
    queueMicrotask(() => this.onopen?.());
  }
  send(d: string): void {
    this.sent.push(d);
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
  push(msg: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

const env = (pathname: string): Env => ({
  pathname,
  origin: "http://localhost",
  wsUrl: "ws://localhost/play",
  search: pathname === "/" ? "?code=ACDE" : "",
});

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  sockets.length = 0;
  (globalThis as unknown as { WebSocket: typeof FakeWS }).WebSocket = FakeWS;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const flush = () => act(async () => { await Promise.resolve(); });

describe("PlayerApp flow", () => {
  it("submits the prefilled join form and connects as a player", async () => {
    await act(async () => { root.render(<App env={env("/")} />); });
    // code is prefilled from ?code=ACDE; fill the name and submit
    const nameInput = container.querySelector('input[aria-label="Your name"]') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(nameInput, "Karan");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(sockets.length).toBe(1);
    const join = JSON.parse(sockets[0]!.sent[0]!);
    expect(join).toMatchObject({ type: "join", code: "ACDE", intent: "play", name: "Karan" });

    // server confirms join + lobby state; VIP button should appear
    await act(async () => {
      sockets[0]!.push({ seq: 0, type: "joined", playerId: "p1", sessionToken: "tok", role: "player" });
      sockets[0]!.push({
        seq: 1,
        type: "state",
        public: {
          code: "ACDE", phase: "lobby", paused: false,
          settings: { familyFriendly: true, profanityFilter: "strict", moderation: false, subtitles: true, timerMode: "normal", reducedMotion: false, audienceEnabled: true, passwordRequired: false, hideRoomCode: false, controllerOnlyStart: false, skipTutorial: false },
          players: [{ id: "p1", name: "Karan", avatar: 0, vip: true, alive: true, money: 0, connected: true, answered: false }],
          audienceCount: 0, questionNumber: 0, questionTotal: 0, deadline: null, phaseData: null,
        },
        private: { you: { id: "p1", name: "Karan", avatar: 0, vip: true, alive: true, money: 0, connected: true, answered: false }, role: "player", phaseData: null },
      });
    });
    await flush();
    expect(container.textContent).toContain("Sab Aa Gaye!");

    // tapping start sends a startGame action
    const btn = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Sab Aa Gaye"))!;
    await act(async () => { btn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const action = JSON.parse(sockets[0]!.sent[sockets[0]!.sent.length - 1]!);
    expect(action).toMatchObject({ type: "action", payload: { action: "startGame" } });
  });
});

describe("HostApp flow", () => {
  it("creates a room via REST then connects as host and renders the code", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: "FHJK", hostToken: "host-tok", wsPath: "/play" }),
    });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    await act(async () => { root.render(<App env={env("/host")} />); });
    await flush();
    await flush();
    expect(fetchMock).toHaveBeenCalledWith("http://localhost/api/rooms", { method: "POST" });
    expect(sockets.length).toBe(1);
    const join = JSON.parse(sockets[0]!.sent[0]!);
    expect(join).toMatchObject({ type: "join", intent: "hostScreen", sessionToken: "host-tok", code: "FHJK" });

    await act(async () => {
      sockets[0]!.push({ seq: 0, type: "joined", playerId: "", sessionToken: "host-tok", role: "host" });
      sockets[0]!.push({
        seq: 1, type: "state",
        public: {
          code: "FHJK", phase: "lobby", paused: false,
          settings: { familyFriendly: true, profanityFilter: "strict", moderation: false, subtitles: true, timerMode: "normal", reducedMotion: false, audienceEnabled: true, passwordRequired: false, hideRoomCode: false, controllerOnlyStart: false, skipTutorial: false },
          players: [], audienceCount: 0, questionNumber: 0, questionTotal: 0, deadline: null, phaseData: null,
        },
        private: { you: null, role: "host", phaseData: null },
      });
    });
    await flush();
    await flush();
    expect(container.textContent).toContain("FHJK");
    // QR effect renders an inline svg for the join URL
    expect(container.querySelector('[aria-label="Join QR code"] svg')).not.toBeNull();
  });

  it("shows an error when room creation fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    await act(async () => { root.render(<App env={env("/host")} />); });
    await flush();
    await flush();
    expect(container.textContent).toContain("Room nahi ban paya");
  });
});
