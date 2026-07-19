import { describe, expect, it } from "vitest";
import { RoomRegistry } from "../src/rooms/registry.js";
import { createLobbyStubEngine } from "../src/game/lobbyStub.js";
import type { Room } from "../src/rooms/room.js";

function mustCreate(reg: RoomRegistry): Room {
  const r = reg.create();
  if (r === null) throw new Error("registry at capacity");
  return r;
}

describe("RoomRegistry", () => {
  it("creates rooms with unique codes and looks them up", () => {
    const reg = new RoomRegistry(createLobbyStubEngine);
    const a = mustCreate(reg);
    const b = mustCreate(reg);
    expect(a.code).not.toBe(b.code);
    expect(reg.get(a.code)).toBe(a);
    expect(reg.has(b.code)).toBe(true);
    expect(reg.size()).toBe(2);
  });

  it("sweeps rooms past TTL", () => {
    let t = 1000;
    const reg = new RoomRegistry(createLobbyStubEngine, { now: () => t, ttlMs: 100 });
    mustCreate(reg);
    expect(reg.size()).toBe(1);
    t = 2000; // well past ttl
    expect(reg.sweep()).toBe(1);
    expect(reg.size()).toBe(0);
  });

  it("reclaims a room abandoned past the grace window, not before", () => {
    let t = 1000;
    const reg = new RoomRegistry(createLobbyStubEngine, { now: () => t, ttlMs: 10_000_000, emptyGraceMs: 1000 });
    const room = mustCreate(reg); // empty since t=1000
    room.connectHost(room.hostToken); // occupied
    room.disconnectHost(); // empty since t=1000 again
    t = 1500; // within grace
    expect(reg.sweep()).toBe(0);
    expect(reg.size()).toBe(1);
    t = 2600; // past 1000ms grace from emptySince
    expect(reg.sweep()).toBe(1);
    expect(reg.size()).toBe(0);
  });

  it("keeps rooms with a connected host", () => {
    let t = 1000;
    const reg = new RoomRegistry(createLobbyStubEngine, { now: () => t, emptyGraceMs: 100 });
    const room = mustCreate(reg);
    room.connectHost(room.hostToken);
    t = 100000; // long after; but host is connected → not empty
    expect(reg.sweep()).toBe(0);
    expect(reg.size()).toBe(1);
    reg.delete(room.code);
    expect(reg.size()).toBe(0);
  });
});

describe("RoomRegistry — M1 fixes", () => {
  it("tears down a room whose host has been gone past the grace window (QA-M1-4)", () => {
    let t = 1000;
    const reg = new RoomRegistry(createLobbyStubEngine, { now: () => t, ttlMs: 10_000_000, emptyGraceMs: 10_000_000, hostGraceMs: 1000 });
    const room = mustCreate(reg);
    room.connectHost(room.hostToken);
    const a = room.join({ name: "X" }); // a player stays connected
    if (!a.ok) throw new Error("join");
    t = 2000;
    room.disconnectHost(); // host gone at t=2000
    expect(reg.sweep()).toBe(0); // within grace, player still here
    t = 3100; // past 1000ms host grace
    expect(reg.sweep()).toBe(1); // torn down despite the lingering player
  });

  it("enforces the global room cap (SEC-M1-1)", () => {
    const reg = new RoomRegistry(createLobbyStubEngine, { maxRooms: 2 });
    expect(reg.create()).not.toBeNull();
    expect(reg.create()).not.toBeNull();
    expect(reg.atCapacity()).toBe(true);
    expect(reg.create()).toBeNull();
  });
});
