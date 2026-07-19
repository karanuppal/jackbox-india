import { describe, expect, it } from "vitest";
import type { RoomPublicState, ServerMessage } from "@tamasha/shared";
import { initialState, reduce } from "../src/net/store.js";

const pub = (over: Partial<RoomPublicState> = {}): RoomPublicState => ({
  code: "ACDE",
  phase: "lobby",
  paused: false,
  settings: {
    familyFriendly: true,
    profanityFilter: "strict",
    moderation: false,
    subtitles: true,
    timerMode: "normal",
    reducedMotion: false,
    audienceEnabled: true,
    passwordRequired: false,
    hideRoomCode: false,
    controllerOnlyStart: false,
    skipTutorial: false,
  },
  players: [],
  audienceCount: 0,
  questionNumber: 0,
  questionTotal: 0,
  deadline: null,
  phaseData: null,
  ...over,
});

describe("client store reducer", () => {
  it("applies a joined message", () => {
    const s = reduce(initialState(), {
      kind: "server",
      message: { seq: 0, type: "joined", playerId: "p1", sessionToken: "tok", role: "player" },
    });
    expect(s.status).toBe("joined");
    expect(s.playerId).toBe("p1");
    expect(s.sessionToken).toBe("tok");
    expect(s.role).toBe("player");
  });

  it("treats an empty playerId (host) as null", () => {
    const s = reduce(initialState(), {
      kind: "server",
      message: { seq: 0, type: "joined", playerId: "", sessionToken: "tok", role: "host" },
    });
    expect(s.playerId).toBeNull();
    expect(s.role).toBe("host");
  });

  it("applies state snapshots and tracks seq", () => {
    let s = initialState();
    s = reduce(s, { kind: "server", message: { seq: 1, type: "state", public: pub(), private: { you: null, role: "host", phaseData: null } } });
    expect(s.public?.code).toBe("ACDE");
    expect(s.lastSeq).toBe(1);
  });

  it("drops stale/out-of-order frames", () => {
    let s = initialState();
    s = reduce(s, { kind: "server", message: { seq: 5, type: "state", public: pub({ phase: "tutorial" }), private: { you: null, role: "host", phaseData: null } } });
    const before = s.public?.phase;
    s = reduce(s, { kind: "server", message: { seq: 3, type: "state", public: pub({ phase: "lobby" }), private: { you: null, role: "host", phaseData: null } } });
    expect(s.public?.phase).toBe(before); // stale frame ignored
  });

  it("records errors; pre-join error is terminal, post-join error is soft", () => {
    let s = initialState();
    s = reduce(s, { kind: "server", message: { seq: 0, type: "error", code: "ROOM_NOT_FOUND", message: "no room" } });
    expect(s.status).toBe("error");
    // after a state snapshot, a later error does not blow away the game view
    let s2 = reduce(initialState(), { kind: "server", message: { seq: 1, type: "state", public: pub(), private: { you: null, role: "player", phaseData: null } } });
    s2 = reduce(s2, { kind: "server", message: { seq: 2, type: "error", code: "NOT_ALLOWED", message: "nope" } });
    expect(s2.status).toBe("joined");
    expect(s2.lastError?.code).toBe("NOT_ALLOWED");
  });

  it("handles socket lifecycle events and pong", () => {
    let s = initialState();
    s = reduce(s, { kind: "reconnecting" });
    expect(s.status).toBe("reconnecting");
    s = reduce(s, { kind: "socketClosed" });
    expect(s.status).toBe("closed");
    const pong = reduce(initialState(), { kind: "server", message: { seq: 0, type: "pong" } });
    expect(pong.status).toBe("connecting");
  });
});

describe("client store — error surfacing after reconnect (QA note)", () => {
  it("surfaces an error that arrives at a low seq after the baseline climbed", () => {
    let s = initialState();
    // baseline climbs on the first connection
    for (let i = 0; i < 4; i++) {
      s = reduce(s, { kind: "server", message: { seq: i, type: "state", public: pub(), private: { you: null, role: "player", phaseData: null } } });
    }
    // reconnect re-join rejected → error at seq 0 must NOT be dropped
    s = reduce(s, { kind: "server", message: { seq: 0, type: "error", code: "ROOM_NOT_FOUND", message: "gone" } });
    expect(s.lastError?.code).toBe("ROOM_NOT_FOUND");
  });
});
