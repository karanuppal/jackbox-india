import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Server } from "node:http";

export interface AppOptions {
  port?: number;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function buildServer(): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/healthz") {
      sendJson(res, 200, { ok: true });
      return;
    }
    sendJson(res, 404, { error: "NOT_FOUND" });
  });
}

export function startServer(opts: AppOptions = {}): Promise<Server> {
  const server = buildServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, () => resolve(server));
  });
}
