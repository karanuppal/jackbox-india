import { describe, expect, it } from "vitest";
import { RoomRegistry } from "../src/rooms/registry.js";
import { createLobbyStubEngine } from "../src/game/lobbyStub.js";

describe("RoomRegistry", () => {
  it("creates rooms with unique codes and looks them up", () => {
    const reg = new RoomRegistry(createLobbyStubEngine);
    const a = reg.create();
    const b = reg.create();
    expect(a.code).not.toBe(b.code);
    expect(reg.get(a.code)).toBe(a);
    expect(reg.has(b.code)).toBe(true);
    expect(reg.size()).toBe(2);
  });

  it("sweeps rooms past TTL", () => {
    let t = 1000;
    const reg = new RoomRegistry(createLobbyStubEngine, { now: () => t, ttlMs: 100 });
    reg.create();
    expect(reg.size()).toBe(1);
    t = 2000; // well past ttl
    expect(reg.sweep()).toBe(1);
    expect(reg.size()).toBe(0);
  });

  it("reclaims a room abandoned past the grace window, not before", () => {
    let t = 1000;
    const reg = new RoomRegistry(createLobbyStubEngine, { now: () => t, ttlMs: 10_000_000, emptyGraceMs: 1000 });
    const room = reg.create(); // empty since t=1000
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
    const room = reg.create();
    room.connectHost(room.hostToken);
    t = 100000; // long after; but host is connected → not empty
    expect(reg.sweep()).toBe(0);
    expect(reg.size()).toBe(1);
    reg.delete(room.code);
    expect(reg.size()).toBe(0);
  });
});
