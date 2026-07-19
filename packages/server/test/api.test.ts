import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { startServer } from "../src/app.js";
import { RoomRegistry } from "../src/rooms/registry.js";
import { createLobbyStubEngine } from "../src/game/lobbyStub.js";

let server: Server | null = null;

async function boot(): Promise<{ base: string; registry: RoomRegistry }> {
  const registry = new RoomRegistry(createLobbyStubEngine);
  server = await startServer({ port: 0, registry });
  const addr = server.address();
  if (addr === null || typeof addr === "string") throw new Error("no port");
  return { base: `http://127.0.0.1:${addr.port}`, registry };
}

afterEach(async () => {
  if (server !== null) await new Promise<void>((r) => server!.close(() => r()));
  server = null;
});

describe("REST /api/rooms", () => {
  it("creates a room and returns code + host token", async () => {
    const { base } = await boot();
    const res = await fetch(`${base}/api/rooms`, { method: "POST" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toMatch(/^[A-Z]{4}$/);
    expect(typeof body.hostToken).toBe("string");
    expect(body.wsPath).toBe("/play");
  });

  it("rejects wrong method on /api/rooms", async () => {
    const { base } = await boot();
    const res = await fetch(`${base}/api/rooms`, { method: "GET" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });

  it("looks up an existing room case-insensitively", async () => {
    const { base } = await boot();
    const created = (await (await fetch(`${base}/api/rooms`, { method: "POST" })).json()) as { code: string };
    const res = await fetch(`${base}/api/rooms/${created.code.toLowerCase()}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.exists).toBe(true);
    expect(body.phase).toBe("lobby");
    expect(body.joinable).toBe(true);
    expect(body.passwordRequired).toBe(false);
  });

  it("404s an unknown room code", async () => {
    const { base } = await boot();
    const res = await fetch(`${base}/api/rooms/ZZZZ`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.exists).toBe(false);
  });

  it("404s unknown /api/ paths", async () => {
    const { base } = await boot();
    const res = await fetch(`${base}/api/nonsense`);
    expect(res.status).toBe(404);
  });
});
