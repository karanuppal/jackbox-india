import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Server } from "node:http";
import { existsSync, statSync, createReadStream } from "node:fs";
import { join, normalize, resolve, extname } from "node:path";

export interface AppOptions {
  port?: number;
  /** Directory containing the built SPA (index.html + assets). Optional. */
  staticDir?: string;
}

// Baseline security headers on every response (SEC-M0-10). The full CSP/HSTS
// set for the SPA ships with the reverse proxy / TLS layer at deploy time.
const BASE_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ogg": "audio/ogg",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

function sendJson(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...BASE_HEADERS,
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...extra,
  });
  res.end(payload);
}

/**
 * Resolve a URL pathname to a regular file inside `staticRoot`, or null.
 * Guards against path traversal: the resolved path must stay inside the root
 * and must be an existing regular file (not a directory, socket, etc.).
 */
export function resolveStaticFile(staticRoot: string, pathname: string): string | null {
  const root = resolve(staticRoot);
  const requested = normalize(pathname).replace(/^([/\\])+/, "");
  const filePath = resolve(root, requested);
  if (filePath !== root && !filePath.startsWith(root + "/")) return null;
  if (!existsSync(filePath)) return null;
  if (!statSync(filePath).isFile()) return null;
  return filePath;
}

function serveStatic(staticDir: string, pathname: string, res: ServerResponse, headOnly: boolean): void {
  let filePath = resolveStaticFile(staticDir, pathname);
  let requested = pathname;
  if (filePath === null) {
    // SPA fallback: unknown non-API paths get index.html (client routes).
    filePath = resolveStaticFile(staticDir, "/index.html");
    requested = "/index.html";
    if (filePath === null) {
      sendJson(res, 404, { error: "NOT_FOUND" });
      return;
    }
  }
  const ext = extname(filePath);
  const immutable = normalize(requested).replace(/^\/+/, "").startsWith("assets/");
  res.writeHead(200, {
    ...BASE_HEADERS,
    "content-type": MIME[ext] ?? "application/octet-stream",
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    "content-length": statSync(filePath).size,
  });
  if (headOnly) {
    res.end();
    return;
  }
  const stream = createReadStream(filePath);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

export function handle(req: IncomingMessage, res: ServerResponse, opts: AppOptions): void {
  let url: URL;
  try {
    url = new URL(req.url ?? "/", "http://localhost");
  } catch {
    sendJson(res, 400, { error: "BAD_REQUEST" });
    return;
  }
  const method = req.method ?? "GET";
  const readLike = method === "GET" || method === "HEAD";

  if (url.pathname === "/healthz") {
    if (!readLike) {
      sendJson(res, 405, { error: "METHOD_NOT_ALLOWED" }, { allow: "GET, HEAD" });
      return;
    }
    if (method === "HEAD") {
      res.writeHead(200, { ...BASE_HEADERS, "cache-control": "no-store" });
      res.end();
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    sendJson(res, 404, { error: "NOT_FOUND" });
    return;
  }

  if (opts.staticDir !== undefined && readLike) {
    serveStatic(opts.staticDir, url.pathname === "/" ? "/index.html" : url.pathname, res, method === "HEAD");
    return;
  }

  sendJson(res, 404, { error: "NOT_FOUND" });
}

export type Handler = (req: IncomingMessage, res: ServerResponse, opts: AppOptions) => void;

export function buildServer(opts: AppOptions = {}, handler: Handler = handle): Server {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    try {
      handler(req, res, opts);
    } catch {
      // Never let a handler exception escape the listener (SEC-M0-1).
      if (!res.headersSent) sendJson(res, 500, { error: "INTERNAL" });
      else res.destroy();
    }
  });
  // Malformed requests the HTTP parser rejects must not kill the process.
  server.on("clientError", (_err, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\nconnection: close\r\n\r\n");
  });
  return server;
}

export function startServer(opts: AppOptions = {}, handler: Handler = handle): Promise<Server> {
  const server = buildServer(opts, handler);
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, () => resolvePromise(server));
  });
}
