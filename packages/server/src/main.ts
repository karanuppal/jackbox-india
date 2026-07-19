import { startServer, WS_PATH } from "./app.js";
import { RoomRegistry } from "./rooms/registry.js";
import { Hub } from "./ws/hub.js";
import { createKhooniSawaalEngine } from "./game/khooniSawaal.js";
import { loadQuestionBank } from "./content/load.js";
import { ConcurrencyLimiter, IpRateLimiter } from "./net/ipLimits.js";
import { LOOKUP_RATE_LIMIT_PER_MIN } from "@tamasha/shared";

const port = Number(process.env.PORT ?? 8787);
const questionBank = loadQuestionBank();
const registry = new RoomRegistry(createKhooniSawaalEngine(questionBank));

// Per-IP abuse limiters (SEC-M1-1/2/3).
const createLimiter = new IpRateLimiter(10, 60_000); // room creation
const lookupLimiter = new IpRateLimiter(LOOKUP_RATE_LIMIT_PER_MIN, 60_000); // GET + ws join
const connLimiter = new ConcurrencyLimiter(30); // concurrent sockets per IP

const opts: {
  port: number;
  staticDir?: string;
  registry: RoomRegistry;
  apiLimiters: { create: IpRateLimiter; lookup: IpRateLimiter };
} = { port, registry, apiLimiters: { create: createLimiter, lookup: lookupLimiter } };
if (process.env.STATIC_DIR !== undefined && process.env.STATIC_DIR !== "") {
  opts.staticDir = process.env.STATIC_DIR;
}
const server = await startServer(opts);
new Hub(server, registry, { path: WS_PATH, joinLimiter: lookupLimiter, connLimiter });

// Sweep expired/empty rooms and stale limiter windows periodically.
const sweepTimer = setInterval(() => {
  registry.sweep();
  createLimiter.sweep();
  lookupLimiter.sweep();
}, 60_000);
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
