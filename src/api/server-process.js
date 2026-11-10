/**
 * src/api/server-process.js
 *
 * Standalone entry point executed as a detached child process by
 * `stevedore socket start`.  Starts the HTTP server and keeps it running.
 *
 * This file is intentionally minimal — all logic lives in server.js.
 */

import { startServer, DEFAULT_SOCKET } from "./server.js";
import { terminateAllChildren } from "./run.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const socketPath = process.env.STEVEDORE_SOCKET ?? DEFAULT_SOCKET;
const PID_FILE = path.join(os.homedir(), ".stevedore", "server.pid");

// Write our own PID so `socket stop`/`socket status` can find us.
fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
fs.writeFileSync(PID_FILE, String(process.pid));

process.on("SIGTERM", () => {
  // Don't leave in-flight `container stop/kill ...` orphans running after
  // the server dies — they would still act on containers (e.g. stopping a
  // container that was restarted while the old server was shutting down).
  terminateAllChildren();
  process.exit(0);
});
process.on("SIGINT",  () => {
  terminateAllChildren();
  process.exit(0);
});

try {
  await startServer(socketPath);
} catch (err) {
  console.error(`stevedore api server: fatal: ${err.message}`);
  process.exit(1);
}
