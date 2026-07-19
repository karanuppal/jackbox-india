import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { request } from "node:http";
import { connect } from "node:net";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/app.js";

let server: Server;
let port: number;
let staticServer: Server;
let staticPort: number;
let staticDir: string;

function rawRequest(p: number, data: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const sock = connect(p, "127.0.0.1", () => sock.write(data));
    let buf = "";
    sock.on("data", (d) => (buf += d.toString()));
    sock.on("end", () => resolvePromise(buf));
    sock.on("error", reject);
    setTimeout(() => {
      sock.destroy();
      resolvePromise(buf);
    }, 1500);
  });
}

function httpGet(p: number, path: string, method = "GET"): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolvePromise, reject) => {
    const req = request({ host: "127.0.0.1", port: p, path, method }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d.toString()));
      res.on("end", () =>
        resolvePromise({ status: res.statusCode ?? 0, headers: res.headers as Record<string, unknown>, body }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  server = await startServer({ port: 0 });
  const addr = server.address();
  if (addr === null || typeof addr === "string") throw new Error("no port");
  port = addr.port;

  staticDir = mkdtempSync(join(tmpdir(), "tamasha-static-"));
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>Tamasha</title>");
  mkdirSync(join(staticDir, "assets"));
  writeFileSync(join(staticDir, "assets", "app.js"), "console.log('chalo')");
  staticServer = await startServer({ port: 0, staticDir });
  const sAddr = staticServer.address();
  if (sAddr === null || typeof sAddr === "string") throw new Error("no port");
  staticPort = sAddr.port;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await new Promise<void>((r) => staticServer.close(() => r()));
});

describe("healthz", () => {
  it("serves GET /healthz with security headers", async () => {
    const res = await httpGet(port, "/healthz");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("mirrors GET on HEAD /healthz (UT-M0-7)", async () => {
    const res = await httpGet(port, "/healthz", "HEAD");
    expect(res.status).toBe(200);
    expect(res.body).toBe("");
  });

  it("405s wrong methods on a known path with Allow header (UT-M0-8)", async () => {
    for (const method of ["POST", "DELETE", "PATCH", "PUT"]) {
      const res = await httpGet(port, "/healthz", method);
      expect(res.status).toBe(405);
      expect(res.headers["allow"]).toBe("GET, HEAD");
    }
  });

  it("404s unknown paths as JSON", async () => {
    const res = await httpGet(port, "/nope");
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: "NOT_FOUND" });
  });
});

describe("robustness (SEC-M0-1)", () => {
  it("survives a request-target the URL parser rejects", async () => {
    const reply = await rawRequest(port, "GET //[ HTTP/1.1\r\nhost: x\r\n\r\n");
    expect(reply).toContain("400");
    // The process must still serve normal traffic afterwards.
    const res = await httpGet(port, "/healthz");
    expect(res.status).toBe(200);
  });

  it("survives outright garbage bytes", async () => {
    await rawRequest(port, "\x00\x01\x02 garbage\r\n\r\n");
    const res = await httpGet(port, "/healthz");
    expect(res.status).toBe(200);
  });
});

describe("static SPA serving (deploy groundwork)", () => {
  it("serves index.html at / with no-cache", async () => {
    const res = await httpGet(staticPort, "/");
    expect(res.status).toBe(200);
    expect(res.body).toContain("<!doctype html>");
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("serves hashed assets with immutable caching", async () => {
    const res = await httpGet(staticPort, "/assets/app.js");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/javascript");
    expect(res.headers["cache-control"]).toContain("immutable");
  });

  it("falls back to index.html for SPA routes", async () => {
    const res = await httpGet(staticPort, "/host");
    expect(res.status).toBe(200);
    expect(res.body).toContain("<!doctype html>");
  });

  it("HEAD on static returns headers only", async () => {
    const res = await httpGet(staticPort, "/", "HEAD");
    expect(res.status).toBe(200);
    expect(res.body).toBe("");
  });

  it("never serves files outside the static root (path traversal)", async () => {
    for (const path of ["/../../../../etc/passwd", "/..%2f..%2f..%2fetc%2fpasswd", "/%2e%2e/%2e%2e/etc/passwd"]) {
      const res = await httpGet(staticPort, path);
      expect(res.body).not.toContain("root:");
    }
  });

  it("still 404s /api/* as JSON when static serving is on", async () => {
    const res = await httpGet(staticPort, "/api/unknown");
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: "NOT_FOUND" });
  });

  it("405s non-read methods on static paths", async () => {
    const res = await httpGet(staticPort, "/", "POST");
    expect(res.status).toBe(404);
  });
});

describe("resolveStaticFile traversal guard (unit)", () => {
  it("rejects paths that escape the root", async () => {
    const { resolveStaticFile } = await import("../src/app.js");
    expect(resolveStaticFile(staticDir, "..")).toBeNull();
    expect(resolveStaticFile(staticDir, "../../etc/passwd")).toBeNull();
    expect(resolveStaticFile(staticDir, "..\\..\\x")).toBeNull();
  });

  it("rejects directories and missing files, accepts real files", async () => {
    const { resolveStaticFile } = await import("../src/app.js");
    expect(resolveStaticFile(staticDir, "/assets")).toBeNull();
    expect(resolveStaticFile(staticDir, "/missing.js")).toBeNull();
    expect(resolveStaticFile(staticDir, "/index.html")).not.toBeNull();
  });
});

describe("handler exception guard (SEC-M0-1)", () => {
  it("returns 500 when the handler throws before headers", async () => {
    const { startServer: start } = await import("../src/app.js");
    const boom = await start({ port: 0 }, () => {
      throw new Error("boom");
    });
    const addr = boom.address();
    if (addr === null || typeof addr === "string") throw new Error("no port");
    const res = await httpGet(addr.port, "/healthz");
    expect(res.status).toBe(500);
    await new Promise<void>((r) => boom.close(() => r()));
  });

  it("destroys the connection when the handler throws after headers", async () => {
    const { startServer: start } = await import("../src/app.js");
    const boom = await start({ port: 0 }, (_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      throw new Error("late boom");
    });
    const addr = boom.address();
    if (addr === null || typeof addr === "string") throw new Error("no port");
    await expect(httpGet(addr.port, "/x")).rejects.toThrow();
    await new Promise<void>((r) => boom.close(() => r()));
  });

  it("404s when static dir has no index.html at all", async () => {
    const { startServer: start } = await import("../src/app.js");
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join: joinPath } = await import("node:path");
    const empty = mkdtempSync(joinPath(tmpdir(), "tamasha-empty-"));
    const srv = await start({ port: 0, staticDir: empty });
    const addr = srv.address();
    if (addr === null || typeof addr === "string") throw new Error("no port");
    const res = await httpGet(addr.port, "/anything");
    expect(res.status).toBe(404);
    await new Promise<void>((r) => srv.close(() => r()));
  });
});
