/**
 * compose.js
 *
 * docker compose — proxies to the official docker-compose (v2) binary.
 *
 * The docker-compose Go binary reads the DOCKER_HOST env var to know where
 * to connect. We auto-start stevedore's socket server (if not running) and
 * point it at ~/.stevedore/docker.sock, so compose talks through stevedore
 * → apple/container.
 *
 * Usage:
 *   docker compose up -d
 *   docker compose down
 *   docker compose logs -f
 *   docker compose ps
 *
 * First-time: stevedore will detect if docker-compose is installed.
 *   brew install docker-compose        # or: docker compose (from Docker CLI v2)
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const STATE_DIR = path.join(os.homedir(), ".stevedore");
const PID_FILE = path.join(STATE_DIR, "server.pid");
const DOCKER_SOCKET = path.join(STATE_DIR, "docker.sock");

export default async function compose(args) {
  // Handle --help
  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    showComposeHelp();
    return;
  }

  // Find docker-compose binary (v2 Go binary)
  const composeBin = findComposeBinary();
  if (!composeBin) {
    console.error(
      "stevedore: docker-compose not found.\n\n" +
      "Install it with one of:\n" +
      "  brew install docker-compose       # standalone v2 binary\n" +
      "  brew install docker               # includes 'docker compose' plugin\n" +
      "\n" +
      "See: https://docs.docker.com/compose/install/"
    );
    process.exit(1);
    return;
  }

  // Auto-start the socket server if not running
  await ensureSocketRunning();

  // Run docker-compose with DOCKER_HOST pointing at our socket
  const env = {
    ...process.env,
    DOCKER_HOST: `unix://${DOCKER_SOCKET}`,
    DOCKER_API_VERSION: "1.41",
    // Suppress docker-compose's own socket detection
    COMPOSE_PROJECT_NAME: process.env.COMPOSE_PROJECT_NAME || undefined,
  };

  // Remove COMPOSE_FILE from env so docker-compose uses working directory
  // (unless explicitly set by the user in args)
  delete env.COMPOSE_FILE;

  // If compose is provided by the Docker CLI plugin, invoke as: docker compose ...
  const composeArgs = path.basename(composeBin) === "docker"
    ? ["compose", ...args]
    : args;

  const { code, combinedOutput } = await runStreaming(composeBin, composeArgs, env);

  if (code !== 0 && looksLikeComposePanic(combinedOutput)) {
    console.error("\nstevedore: docker compose crashed with an internal panic (upstream compose bug).");
    console.error("This usually happens during reconcile/recreate with orphan or previously-created containers.");
    console.error("\nTry:\n  docker compose down --remove-orphans\n  docker compose up -d\n");
    console.error("If needed, remove stale containers manually:\n  docker ps -a\n  docker rm -f <container-id>\n");
  }

  if (code !== 0) {
    process.exit(code);
  }
}

function runStreaming(bin, args, env) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      env,
      stdio: ["inherit", "pipe", "pipe"],
    });

    let combinedOutput = "";

    child.stdout.on("data", (d) => {
      const s = d.toString();
      combinedOutput += s;
      process.stdout.write(d);
    });

    child.stderr.on("data", (d) => {
      const s = d.toString();
      combinedOutput += s;
      process.stderr.write(d);
    });

    child.on("close", (code) => {
      resolve({ code: code ?? 1, combinedOutput });
    });

    child.on("error", (err) => {
      process.stderr.write(`stevedore: failed to run compose: ${err.message}\n`);
      resolve({ code: 1, combinedOutput: combinedOutput + "\n" + err.message });
    });
  });
}

function looksLikeComposePanic(output) {
  return (
    output.includes("panic: runtime error") &&
    output.includes("pkg/compose/convergence.go")
  );
}

// ---------------------------------------------------------------------------
// Binary detection
// ---------------------------------------------------------------------------

function findComposeBinary() {
  // Try docker-compose (standalone v2 Go binary)
  const bin1 = findBinary("docker-compose");
  if (bin1) return bin1;

  // Try docker compose (v2 plugin bundled with Docker CLI)
  const bin2 = findBinary("docker");
  if (bin2) {
    try {
      const output = execSync(`"${bin2}" compose version 2>/dev/null`, {
        encoding: "utf8",
      });
      if (output.includes("Docker Compose version v2")) {
        return bin2; // we'll invoke it as "docker compose"
      }
    } catch {}
  }

  return null;
}

function findBinary(name) {
  const dirs = process.env.PATH ? process.env.PATH.split(path.delimiter) : [];
  for (const dir of dirs) {
    const full = path.join(dir, name);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      try {
        fs.accessSync(full, fs.constants.X_OK);
        return full;
      } catch {}
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Socket auto-start
// ---------------------------------------------------------------------------

async function ensureSocketRunning() {
  if (isSocketRunning()) return;

  const serverEntry = path.join(__dirname, "../api/server-process.js");

  fs.mkdirSync(STATE_DIR, { recursive: true });

  const logFd = fs.openSync(path.join(STATE_DIR, "server.log"), "a");
  const { spawn } = await import("node:child_process");

  const child = spawn(process.execPath, [serverEntry], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });

  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid));

  // Wait for socket to appear AND accept connections
  await waitForSocketReady(DOCKER_SOCKET, 5000);
  console.log(`stevedore: API server started (PID ${child.pid})`);
}

function isSocketRunning() {
  if (!fs.existsSync(PID_FILE)) return false;
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitForSocket(socketPath, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (fs.existsSync(socketPath)) {
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        resolve(); // don't block if socket is slow
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });
}

async function waitForSocketReady(socketPath, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(socketPath)) {
      // Try to connect and send a ping
      try {
        const { spawn } = await import("node:child_process");
        await new Promise((resolve, reject) => {
          const child = spawn("curl", ["-s", "--unix-socket", socketPath, "http://localhost/_ping"]);
          let out = "";
          child.stdout.on("data", (d) => { out += d.toString(); });
          child.stderr.on("data", () => {});
          child.on("close", (code) => {
            if (code === 0 && out.trim() === "OK") resolve();
            else reject(new Error("ping failed"));
          });
        });
        return; // socket is ready
      } catch {
        // not ready yet, keep polling
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  // Fall back — socket might be ready enough
  console.warn("stevedore: warning: socket may not be fully ready");
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

function showComposeHelp() {
  // Delegate to docker-compose --help if available
  const composeBin = findComposeBinary();
  if (composeBin) {
    try {
      const output = execSync(`"${composeBin}" --help`, {
        encoding: "utf8",
        env: { ...process.env, DOCKER_HOST: `unix://${DOCKER_SOCKET}` },
      });
      console.log(output);
      return;
    } catch {}
  }

  // Fallback to our own help
  console.log(`
Usage: docker compose <command> [options]

Proxies to docker-compose (v2) with stevedore's socket as DOCKER_HOST.

Commands:
  up        Start services
  down      Stop and remove resources
  ps        List containers
  logs      View output from containers
  exec      Execute a command in a running container
  run       Run a one-off command
  build     Build or rebuild services
  pull      Pull service images
  push      Push service images
  restart   Restart services
  stop      Stop services
  start     Start services
  config    Validate and view compose file
  version   Show docker-compose version

Options:
  -f, --file FILE    Specify an alternate compose file
  -p, --project-name NAME    Specify an alternate project name
  --help             Show help
  --verbose          Show more output

Environment:
  stevedore auto-starts its API server and sets DOCKER_HOST to point
  at ~/.stevedore/docker.sock, so docker-compose communicates through
  stevedore → apple/container.

  To use the socket with other tools (Testcontainers, etc.):
    export DOCKER_HOST=unix://${DOCKER_SOCKET}
`);
}
