/**
 * src/api/server.js
 *
 * A Docker-compatible HTTP API server that listens on a Unix socket and
 * translates incoming Docker API requests into apple/container CLI calls.
 *
 * This is what makes Testcontainers (and any other tool that speaks the
 * Docker socket API) work with apple/container.
 *
 * The Docker Engine API spec: https://docs.docker.com/engine/api/v1.41/
 *
 * Architecture:
 *   Testcontainers
 *     → HTTP over /var/run/docker.sock (or DOCKER_HOST)
 *       → server.js (this file) — HTTP routing
 *         → src/api/routes/*.js — per-resource route handlers
 *           → src/utils/exec.js — apple/container CLI calls
 *
 * Usage:
 *   stevedore socket start   # starts the API server as a background daemon
 *   stevedore socket stop    # stops it
 *   stevedore socket status  # shows whether it's running
 *
 * Environment:
 *   STEVEDORE_SOCKET   Path for the Unix socket (default: ~/.stevedore/docker.sock)
 *                      Set this to e.g. ~/.stevedore/docker.sock to avoid
 *                      needing sudo, then point Testcontainers at it via
 *                      DOCKER_HOST=unix://~/.stevedore/docker.sock
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { router } from "./router.js";

export const DEFAULT_SOCKET = process.env.STEVEDORE_SOCKET
  ?? path.join(os.homedir(), ".stevedore", "docker.sock");

/**
 * Create and return the HTTP server (not yet listening).
 * @returns {http.Server}
 */
export function createServer() {
  return http.createServer(async (req, res) => {
    // Log all requests for debugging
    const start = Date.now();
    const body = await collectBody(req);
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.url}` +
      (body?.length > 500 ? ` body=${JSON.stringify(body).slice(0,500)}...` : ` body=${JSON.stringify(body)}`)
    );

    try {
      await router(req, res, body);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: err.message }));
      }
    }
  });
}

async function collectBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length > 0 ? Buffer.concat(chunks).toString() : null;
}

/**
 * Start the API server, listening on the Unix socket.
 * Removes a stale socket file if one exists.
 *
 * @param {string} [socketPath]
 * @returns {Promise<http.Server>}
 */
export async function startServer(socketPath = DEFAULT_SOCKET) {
  // Ensure the directory exists
  fs.mkdirSync(path.dirname(socketPath), { recursive: true });

  // Remove stale socket
  try { fs.unlinkSync(socketPath); } catch {}

  const server = createServer();

  await new Promise((resolve, reject) => {
    server.listen(socketPath, resolve);
    server.once("error", reject);
  });

  // Make socket world-writable so non-root processes (like JVMs running
  // Testcontainers) can connect without sudo
  fs.chmodSync(socketPath, 0o666);

  console.log(`stevedore: Docker API socket listening at ${socketPath}`);
  console.log(`stevedore: Set DOCKER_HOST=unix://${socketPath} (or TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=${socketPath})`);

  return server;
}
