import { startServer, WS_PATH } from "./app.js";
import { RoomRegistry } from "./rooms/registry.js";
import { Hub } from "./ws/hub.js";
import { createLobbyStubEngine } from "./game/lobbyStub.js";

const port = Number(process.env.PORT ?? 8787);
const registry = new RoomRegistry(createLobbyStubEngine);
const opts: { port: number; staticDir?: string; registry: RoomRegistry } = { port, registry };
if (process.env.STATIC_DIR !== undefined && process.env.STATIC_DIR !== "") {
  opts.staticDir = process.env.STATIC_DIR;
}
const server = await startServer(opts);
new Hub(server, registry, { path: WS_PATH });

// Sweep expired/empty rooms periodically.
const sweepTimer = setInterval(() => registry.sweep(), 60_000);
sweepTimer.unref();

// Last-resort guards: log and keep serving; a single bad request must never
// take down every live room (SEC-M0-1).
process.on("uncaughtException", (err) => {
  console.error("uncaughtException", err);
});
process.on("unhandledRejection", (err) => {
  console.error("unhandledRejection", err);
});

const addr = server.address();
console.log(`tamasha server listening on`, addr);
