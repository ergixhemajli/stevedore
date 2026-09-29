/**
 * src/commands/socket.js
 *
 * stevedore socket <start|stop|status>
 *
 * Manages the Docker-compatible API server that listens on a Unix socket,
 * enabling tools like Testcontainers that speak the Docker HTTP API to work
 * with apple/container.
 *
 * The server runs as a background process. Its PID is stored in
 * ~/.stevedore/server.pid so stop/status can find it.
 *
 * Usage:
 *   stevedore socket start
 *   stevedore socket start --socket /var/run/docker.sock   # requires sudo
 *   stevedore socket stop
 *   stevedore socket status
 *
 * Testcontainers config:
 *   Default socket: ~/.stevedore/docker.sock
 *
 *   Option A — environment variable (recommended):
 *     export DOCKER_HOST=unix://$HOME/.stevedore/docker.sock
 *
 *   Option B — testcontainers.properties:
 *     docker.host=unix:///Users/<you>/.stevedore/docker.sock
 *     TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/Users/<you>/.stevedore/docker.sock
 *
 *   Option C — point at /var/run/docker.sock (requires sudo for socket start):
 *     sudo stevedore socket start --socket /var/run/docker.sock
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CONTAINER_BIN } from "../utils/exec.js";
import { startSupervisor } from "../utils/supervisor.js";

const STATE_DIR = path.join(os.homedir(), ".stevedore");
const PID_FILE  = path.join(STATE_DIR, "server.pid");
const LOG_FILE  = path.join(STATE_DIR, "server.log");

export default async function socket(args) {
  const [sub, ...rest] = args;

  // Parse --socket flag
  let socketPath;
  const socketIdx = rest.indexOf("--socket");
  if (socketIdx !== -1 && rest[socketIdx + 1]) {
    socketPath = rest[socketIdx + 1];
  }

  switch (sub) {
    case "start":  return socketStart(socketPath);
    case "stop":   return socketStop();
    case "status": return socketStatus();
    default:
      console.log(`
Usage: stevedore socket <command>

Commands:
  start [--socket <path>]   Start the Docker-compatible API server
  stop                      Stop the API server
  status                    Show whether the server is running

The server listens on a Unix socket and translates Docker API calls into
apple/container CLI invocations, enabling Testcontainers and similar tools.

Default socket: ${path.join(STATE_DIR, "docker.sock")}

To use with Testcontainers, set:
  export DOCKER_HOST=unix://${path.join(STATE_DIR, "docker.sock")}
      `);
  }
}

// ---------------------------------------------------------------------------

async function socketStart(socketPath) {
  fs.mkdirSync(STATE_DIR, { recursive: true });

  // Ensure container system is running before starting the API server.
  await new Promise((resolve) => {
    const child = spawn(CONTAINER_BIN, ["system", "start"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    child.on("close", () => resolve());
    child.on("error", () => resolve());
  });

  if (isRunning()) {
    const pid = fs.readFileSync(PID_FILE, "utf8").trim();
    console.log(`stevedore: API server already running (PID ${pid})`);
    printConnectionInfo(socketPath);
    return;
  }

  // Resolve the server entry point
  const serverEntry = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../api/server-process.js"
  );

  const env = { ...process.env };
  if (socketPath) env.STEVEDORE_SOCKET = socketPath;

  const logFd = fs.openSync(LOG_FILE, "a");

  const child = spawn(process.execPath, [serverEntry], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env,
  });

  child.unref();

  fs.writeFileSync(PID_FILE, String(child.pid));

  // Wait briefly for socket to appear
  const sock = socketPath ?? path.join(STATE_DIR, "docker.sock");
  await waitForSocket(sock, 5000);

  console.log(`stevedore: API server started (PID ${child.pid})`);
  printConnectionInfo(sock);
}

async function socketStop() {
  if (!isRunning()) {
    console.log("stevedore: API server is not running");
    return;
  }
  const pid = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
  try {
    process.kill(pid, "SIGTERM");
    fs.unlinkSync(PID_FILE);
    console.log(`stevedore: API server stopped (PID ${pid})`);
  } catch (err) {
    console.error(`stevedore: failed to stop server: ${err.message}`);
    fs.unlinkSync(PID_FILE);
  }
}

async function socketStatus() {
  if (!isRunning()) {
    console.log("stevedore: API server is NOT running");
    console.log(`  Start it with: stevedore socket start`);
    return;
  }
  const pid = fs.readFileSync(PID_FILE, "utf8").trim();
  console.log(`stevedore: API server is running (PID ${pid})`);
  printConnectionInfo();
}

// ---------------------------------------------------------------------------

function isRunning() {
  if (!fs.existsSync(PID_FILE)) return false;
  const pid = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

function printConnectionInfo(socketPath) {
  const sock = socketPath ?? path.join(STATE_DIR, "docker.sock");
  console.log(`
To use with Testcontainers, set ONE of:

  # Shell export (recommended):
  export DOCKER_HOST=unix://${sock}

  # testcontainers.properties:
  docker.host=unix://${sock}

  # Java system property:
  -Dtestcontainers.dockersocket=${sock}

  # Or set both for maximum compatibility:
  export DOCKER_HOST=unix://${sock}
  export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=${sock}
  `);
}

async function waitForSocket(socketPath, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(socketPath)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  console.warn(`stevedore: warning: socket not found at ${socketPath} after ${timeoutMs}ms`);
}
