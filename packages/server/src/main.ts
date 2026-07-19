import { startServer } from "./app.js";

const port = Number(process.env.PORT ?? 8787);
const server = await startServer({ port });
const addr = server.address();
console.log(`tamasha server listening on`, addr);
