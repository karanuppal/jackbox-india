import { startServer } from "./app.js";

const port = Number(process.env.PORT ?? 8787);
const opts: { port: number; staticDir?: string } = { port };
if (process.env.STATIC_DIR !== undefined && process.env.STATIC_DIR !== "") {
  opts.staticDir = process.env.STATIC_DIR;
}
const server = await startServer(opts);

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
