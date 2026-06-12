/**
 * src/api/server-process.js
 *
 * Standalone entry point executed as a detached child process by
 * `stevedore socket start`.  Starts the HTTP server and keeps it running.
 *
 * This file is intentionally minimal — all logic lives in server.js.
 */

import { startServer, DEFAULT_SOCKET } from "./server.js";

const socketPath = process.env.STEVEDORE_SOCKET ?? DEFAULT_SOCKET;

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT",  () => process.exit(0));

try {
  await startServer(socketPath);
} catch (err) {
  console.error(`stevedore api server: fatal: ${err.message}`);
  process.exit(1);
}
