import { describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "@tamasha/shared";
import { RoomConnection, type WebSocketLike } from "../src/net/connection.js";
import type { ClientState } from "../src/net/store.js";

/** Controllable fake socket. */
class FakeSocket implements WebSocketLike {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  sent: string[] = [];
  closed = false;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
  fireOpen(): void {
    this.onopen?.();
  }
  fireMessage(msg: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  fireClose(): void {
    this.onclose?.();
  }
}

function setup(join = { code: "ACDE", intent: "play" as const, name: "Karan" }) {
  const sockets: FakeSocket[] = [];
  const states: ClientState[] = [];
  const conn = new RoomConnection({
    wsUrl: "ws://x/play",
    join,
    onState: (s) => states.push(s),
    makeSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    reconnectDelays: [10],
  });
  return { conn, sockets, states };
}

describe("RoomConnection", () => {
  it("sends the join handshake on open", () => {
    const { conn, sockets } = setup();
    conn.connect();
    sockets[0]!.fireOpen();
    expect(sockets[0]!.sent).toHaveLength(1);
    const join = JSON.parse(sockets[0]!.sent[0]!);
    expect(join).toMatchObject({ type: "join", code: "ACDE", intent: "play", name: "Karan" });
  });

  it("feeds server messages into state and captures the session token", () => {
    const { conn, sockets, states } = setup();
    conn.connect();
    sockets[0]!.fireOpen();
    sockets[0]!.fireMessage({ seq: 0, type: "joined", playerId: "p1", sessionToken: "tok-9", role: "player" });
    const last = states[states.length - 1]!;
    expect(last.status).toBe("joined");
    expect(last.sessionToken).toBe("tok-9");
  });

  it("assigns monotonic seq to actions", () => {
    const { conn, sockets } = setup();
    conn.connect();
    sockets[0]!.fireOpen();
    conn.sendAction({ action: "startGame" });
    conn.sendAction({ action: "pause" });
    const actions = sockets[0]!.sent.slice(1).map((s) => JSON.parse(s));
    expect(actions[0].seq).toBe(1);
    expect(actions[1].seq).toBe(2);
  });

  it("reconnects with the stored session token after an unexpected close", () => {
    vi.useFakeTimers();
    try {
      const { conn, sockets } = setup();
      conn.connect();
      sockets[0]!.fireOpen();
      sockets[0]!.fireMessage({ seq: 0, type: "joined", playerId: "p1", sessionToken: "tok-9", role: "player" });
      sockets[0]!.fireClose(); // unexpected drop
      vi.advanceTimersByTime(20);
      expect(sockets).toHaveLength(2); // reopened
      sockets[1]!.fireOpen();
      const rejoin = JSON.parse(sockets[1]!.sent[0]!);
      expect(rejoin.sessionToken).toBe("tok-9"); // reconnect uses the token
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not reconnect after an explicit close", () => {
    vi.useFakeTimers();
    try {
      const { conn, sockets, states } = setup();
      conn.connect();
      sockets[0]!.fireOpen();
      conn.close();
      sockets[0]!.fireClose();
      vi.advanceTimersByTime(1000);
      expect(sockets).toHaveLength(1);
      expect(states[states.length - 1]!.status).toBe("closed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores malformed and non-string messages", () => {
    const { conn, sockets, states } = setup();
    conn.connect();
    sockets[0]!.fireOpen();
    const before = states.length;
    sockets[0]!.onmessage?.({ data: "not json" });
    sockets[0]!.onmessage?.({ data: 123 });
    expect(states.length).toBe(before); // no state change
  });
});
