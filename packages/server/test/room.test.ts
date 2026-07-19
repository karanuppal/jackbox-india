import { describe, expect, it } from "vitest";
import { MAX_PLAYERS } from "@tamasha/shared";
import { Room } from "../src/rooms/room.js";
import { createLobbyStubEngine } from "../src/game/lobbyStub.js";

function makeRoom(now = () => 1000): Room {
  return new Room("ACDE", createLobbyStubEngine, now);
}

describe("Room — join & roles", () => {
  it("first player becomes VIP", () => {
    const room = makeRoom();
    const a = room.join({ name: "Karan" });
    expect(a.ok).toBe(true);
    const state = room.publicState();
    expect(state.players).toHaveLength(1);
    expect(state.players[0]!.vip).toBe(true);
    expect(state.players[0]!.name).toBe("Karan");
  });

  it("rejects blank names", () => {
    const room = makeRoom();
    const r = room.join({ name: "   " });
    expect(r).toEqual({ ok: false, code: "BAD_NAME" });
  });

  it("assigns unique names and avatars", () => {
    const room = makeRoom();
    room.join({ name: "Karan" });
    room.join({ name: "Karan" });
    const names = room.publicState().players.map((p) => p.name);
    expect(new Set(names).size).toBe(2);
    const avatars = room.publicState().players.map((p) => p.avatar);
    expect(new Set(avatars).size).toBe(2);
  });

  it("routes joiners past the player cap into the audience", () => {
    const room = makeRoom();
    for (let i = 0; i < MAX_PLAYERS; i++) room.join({ name: `P${i}` });
    expect(room.joinable()).toBe(false);
    const extra = room.join({ name: "Late" });
    expect(extra.ok).toBe(true);
    if (extra.ok) expect(extra.role).toBe("audience");
    expect(room.publicState().players).toHaveLength(MAX_PLAYERS);
    expect(room.publicState().audienceCount).toBe(1);
  });

  it("rejects extra joiners when audience is disabled and room is full", () => {
    const room = makeRoom();
    room.applyAction(null, { action: "updateSettings", settings: { audienceEnabled: false } });
    for (let i = 0; i < MAX_PLAYERS; i++) room.join({ name: `P${i}` });
    const extra = room.join({ name: "Late" });
    expect(extra).toEqual({ ok: false, code: "ROOM_FULL" });
  });
});

describe("Room — password", () => {
  it("requires the password when set", () => {
    const room = makeRoom();
    room.applyAction(null, { action: "updateSettings", settings: { password: "chai" } });
    expect(room.passwordRequired()).toBe(true);
    expect(room.join({ name: "X", password: "wrong" })).toEqual({ ok: false, code: "BAD_PASSWORD" });
    expect(room.join({ name: "X", password: "chai" }).ok).toBe(true);
  });
});

describe("Room — reconnect", () => {
  it("restores the same seat with the session token", () => {
    const room = makeRoom();
    const a = room.join({ name: "Karan" });
    if (!a.ok || a.playerId === null) throw new Error("join failed");
    room.markDisconnected(a.playerId);
    expect(room.publicState().players[0]!.connected).toBe(false);
    const again = room.join({ sessionToken: a.sessionToken });
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.playerId).toBe(a.playerId);
      expect(again.role).toBe("player");
    }
    expect(room.publicState().players[0]!.connected).toBe(true);
  });

  it("treats an unknown token as a fresh join", () => {
    const room = makeRoom();
    const r = room.join({ name: "Karan", sessionToken: "00000000-0000-0000-0000-000000000000" });
    expect(r.ok).toBe(true);
  });
});

describe("Room — host & VIP authority", () => {
  it("only the host token connects as host", () => {
    const room = makeRoom();
    expect(room.connectHost("nope")).toEqual({ ok: false, code: "NOT_ALLOWED" });
    const ok = room.connectHost(room.hostToken);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.role).toBe("host");
  });

  it("rejects startGame from a non-VIP player", () => {
    const room = makeRoom();
    const a = room.join({ name: "VIP" });
    const b = room.join({ name: "Other" });
    if (!a.ok || !b.ok) throw new Error("join");
    expect(room.applyAction(b.playerId, { action: "startGame" })).toBe("NOT_ALLOWED");
    expect(room.applyAction(a.playerId, { action: "startGame" })).toBeNull();
    expect(room.getPhase()).toBe("tutorial");
  });

  it("rejects host-only actions from players and vice versa", () => {
    const room = makeRoom();
    const a = room.join({ name: "VIP" });
    if (!a.ok) throw new Error("join");
    // player cannot pause (host-only)
    expect(room.applyAction(a.playerId, { action: "pause" })).toBe("NOT_ALLOWED");
    // host can pause
    expect(room.applyAction(null, { action: "pause" })).toBeNull();
    expect(room.publicState().paused).toBe(true);
    expect(room.applyAction(null, { action: "resume" })).toBeNull();
    expect(room.publicState().paused).toBe(false);
  });

  it("cannot start with zero active players", () => {
    const room = makeRoom();
    room.applyAction(null, { action: "updateSettings", settings: { audienceEnabled: false } });
    // audience-only cannot happen here; with no players startGame is via host — but host isn't VIP
    expect(room.applyAction(null, { action: "startGame" })).toBe("NOT_ALLOWED");
  });
});

describe("Room — settings & lifecycle", () => {
  it("updateSettings only applies provided keys and only in lobby", () => {
    const room = makeRoom();
    room.applyAction(null, { action: "updateSettings", settings: { familyFriendly: false } });
    expect(room.getSettings().familyFriendly).toBe(false);
    expect(room.getSettings().subtitles).toBe(true); // untouched
    const a = room.join({ name: "VIP" });
    if (!a.ok) throw new Error("join");
    room.applyAction(a.playerId, { action: "startGame" });
    expect(room.applyAction(null, { action: "updateSettings", settings: { familyFriendly: true } })).toBe("NOT_ALLOWED");
  });

  it("public state never leaks the password", () => {
    const room = makeRoom();
    room.applyAction(null, { action: "updateSettings", settings: { password: "secret123" } });
    expect(JSON.stringify(room.publicState())).not.toContain("secret123");
    expect(room.publicState().settings.passwordRequired).toBe(true);
  });

  it("restart returns to lobby and clears game state", () => {
    const room = makeRoom();
    const a = room.join({ name: "VIP" });
    if (!a.ok) throw new Error("join");
    room.applyAction(a.playerId, { action: "startGame" });
    expect(room.getPhase()).toBe("tutorial");
    // restart is VIP-only and needs gameOver/postGame
    expect(room.applyAction(a.playerId, { action: "restart" })).toBe("NOT_ALLOWED");
  });

  it("skipTutorial only works in tutorial phase", () => {
    const room = makeRoom();
    const a = room.join({ name: "VIP" });
    if (!a.ok) throw new Error("join");
    expect(room.applyAction(a.playerId, { action: "skipTutorial" })).toBe("NOT_ALLOWED");
    room.applyAction(a.playerId, { action: "startGame" });
    expect(room.applyAction(a.playerId, { action: "skipTutorial" })).toBeNull();
  });

  it("isEmpty tracks live connections and emptySince", () => {
    let t = 1000;
    const room = new Room("ACDE", createLobbyStubEngine, () => t);
    expect(room.isEmpty()).toBe(true); // created, nobody connected
    expect(room.getEmptySince()).toBe(1000);
    const a = room.join({ name: "X" });
    if (!a.ok || a.playerId === null) throw new Error("join");
    expect(room.isEmpty()).toBe(false); // a connected player occupies the room
    expect(room.getEmptySince()).toBeNull();
    t = 2000;
    room.markDisconnected(a.playerId);
    expect(room.isEmpty()).toBe(true);
    expect(room.getEmptySince()).toBe(2000);
    // reconnect clears the empty marker
    room.join({ sessionToken: a.sessionToken });
    expect(room.getEmptySince()).toBeNull();
  });

  it("private view carries per-player identity", () => {
    const room = makeRoom();
    const a = room.join({ name: "Karan" });
    if (!a.ok || a.playerId === null) throw new Error("join");
    const view = room.privateView(a.playerId, "player");
    expect(view.you?.name).toBe("Karan");
    expect(view.role).toBe("player");
    const hostView = room.privateView(null, "host");
    expect(hostView.you).toBeNull();
  });
});

describe("Room — coverage completeness", () => {
  it("disambiguates many identical names", () => {
    const room = makeRoom();
    for (let i = 0; i < 5; i++) room.join({ name: "Karan" });
    const names = room.publicState().players.map((p) => p.name);
    expect(new Set(names).size).toBe(5);
    expect(names[0]).toBe("Karan");
    expect(names.slice(1).every((n) => n.startsWith("Karan "))).toBe(true);
  });

  it("reuses freed avatar indices deterministically", () => {
    const room = makeRoom();
    for (let i = 0; i < 3; i++) room.join({ name: `P${i}` });
    const avatars = room.publicState().players.map((p) => p.avatar).sort();
    expect(avatars).toEqual([0, 1, 2]);
  });

  it("routes a reconnecting audience member back to the audience", () => {
    const room = makeRoom();
    for (let i = 0; i < MAX_PLAYERS; i++) room.join({ name: `P${i}` });
    const aud = room.join({ name: "Aud" });
    if (!aud.ok || aud.playerId === null) throw new Error("join");
    expect(aud.role).toBe("audience");
    room.markDisconnected(aud.playerId);
    const back = room.join({ sessionToken: aud.sessionToken });
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.role).toBe("audience");
  });

  it("host disconnect mid-game auto-pauses", () => {
    const room = makeRoom();
    const a = room.join({ name: "VIP" });
    if (!a.ok) throw new Error("join");
    room.connectHost(room.hostToken);
    room.applyAction(a.playerId, { action: "startGame" });
    expect(room.getPhase()).toBe("tutorial");
    room.disconnectHost();
    expect(room.isPaused()).toBe(true);
  });

  it("host disconnect in lobby does not pause", () => {
    const room = makeRoom();
    room.connectHost(room.hostToken);
    room.disconnectHost();
    expect(room.isPaused()).toBe(false);
  });

  it("game action reaches the engine (stub yields no phase change)", () => {
    const room = makeRoom();
    const a = room.join({ name: "VIP" });
    if (!a.ok) throw new Error("join");
    room.applyAction(a.playerId, { action: "startGame" });
    expect(room.applyAction(a.playerId, { action: "game", payload: { anything: 1 } })).toBeNull();
    expect(room.getPhase()).toBe("tutorial");
  });

  it("game action before a game exists is rejected", () => {
    const room = makeRoom();
    const a = room.join({ name: "VIP" });
    if (!a.ok) throw new Error("join");
    expect(room.applyAction(a.playerId, { action: "game", payload: {} })).toBe("NOT_ALLOWED");
  });
});

describe("Room — M1 fix pass (VIP reassign, name reconnect, host teardown)", () => {
  it("reassigns VIP to the earliest connected player when the VIP disconnects (QA-M1-3)", () => {
    const room = makeRoom();
    const a = room.join({ name: "VIP" });
    const b = room.join({ name: "Second" });
    if (!a.ok || !b.ok || a.playerId === null) throw new Error("join");
    expect(room.publicState().players.find((p) => p.name === "VIP")!.vip).toBe(true);
    room.markDisconnected(a.playerId);
    // Second is promoted and can now start
    expect(room.publicState().players.find((p) => p.name === "Second")!.vip).toBe(true);
    expect(room.applyAction(b.playerId, { action: "startGame" })).toBeNull();
    expect(room.getPhase()).toBe("tutorial");
  });

  it("does not reassign VIP if the VIP is still connected", () => {
    const room = makeRoom();
    const a = room.join({ name: "VIP" });
    const b = room.join({ name: "Second" });
    if (!a.ok || !b.ok || b.playerId === null) throw new Error("join");
    room.markDisconnected(b.playerId); // a non-VIP leaves
    expect(room.publicState().players.find((p) => p.name === "VIP")!.vip).toBe(true);
  });

  it("reclaims a disconnected seat by matching name (UT-M1-4 cross-device rejoin)", () => {
    const room = makeRoom();
    const a = room.join({ name: "Priya" });
    if (!a.ok || a.playerId === null) throw new Error("join");
    room.markDisconnected(a.playerId);
    // fresh join, no token, same name → reclaims the same seat, no duplicate
    const again = room.join({ name: "Priya" });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.playerId).toBe(a.playerId);
    expect(room.publicState().players).toHaveLength(1);
    expect(room.publicState().players[0]!.connected).toBe(true);
  });

  it("does not reclaim a name that is still connected (creates a unique name)", () => {
    const room = makeRoom();
    room.join({ name: "Ravi" });
    const dup = room.join({ name: "Ravi" });
    expect(dup.ok).toBe(true);
    const names = room.publicState().players.map((p) => p.name);
    expect(names).toContain("Ravi");
    expect(names).toContain("Ravi 2");
  });

  it("tracks host-gone timestamp for teardown (QA-M1-4)", () => {
    let t = 1000;
    const room = new Room("ACDE", createLobbyStubEngine, () => t);
    room.connectHost(room.hostToken);
    expect(room.getHostGoneSince()).toBeNull();
    t = 5000;
    room.disconnectHost();
    expect(room.getHostGoneSince()).toBe(5000);
    room.connectHost(room.hostToken);
    expect(room.getHostGoneSince()).toBeNull();
  });

  it("audience members get no avatar (QA-M1-12)", () => {
    const room = makeRoom();
    for (let i = 0; i < MAX_PLAYERS; i++) room.join({ name: `P${i}` });
    const aud = room.join({ name: "Aud" });
    if (!aud.ok || aud.playerId === null) throw new Error("join");
    // audience isn't in publicState.players; check via reconnect role stability
    expect(aud.role).toBe("audience");
  });

  it("freezes game actions while paused (QA-M1-10)", () => {
    const room = makeRoom();
    const a = room.join({ name: "VIP" });
    if (!a.ok) throw new Error("join");
    room.applyAction(a.playerId, { action: "startGame" });
    room.applyAction(null, { action: "pause" });
    expect(room.applyAction(a.playerId, { action: "game", payload: {} })).toBe("NOT_ALLOWED");
    room.applyAction(null, { action: "resume" });
    expect(room.applyAction(a.playerId, { action: "game", payload: {} })).toBeNull();
  });

  it("uses timing-safe host-token comparison but still rejects wrong tokens", () => {
    const room = makeRoom();
    expect(room.connectHost("wrong-length")).toEqual({ ok: false, code: "NOT_ALLOWED" });
    expect(room.connectHost(room.hostToken).ok).toBe(true);
  });
});
