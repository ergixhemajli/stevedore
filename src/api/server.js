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

/** Debug mode: set STEVEDORE_DEBUG=1 for verbose request logging */
export const DEBUG = process.env.STEVEDORE_DEBUG === "1";

export const DEFAULT_SOCKET = process.env.STEVEDORE_SOCKET
  ?? path.join(os.homedir(), ".stevedore", "docker.sock");

/**
 * Create and return the HTTP server (not yet listening).
 * @returns {http.Server}
 */
export function createServer() {
  return http.createServer(async (req, res) => {
    // Log method, URL only — never bodies (they contain env secrets).
    const start = Date.now();
    const body = await collectBody(req);
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.url} → ${res.statusCode ?? "?"} (${Date.now() - start}ms)`
    );
    if (DEBUG && body) {
      console.log(`  body: ${JSON.stringify(body).slice(0, 500)}${JSON.stringify(body).length > 500 ? "..." : ""}`);
    }

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

const MAX_BODY = 10 * 1024 * 1024; // 10 MiB

async function collectBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      throw new Error(`request body too large (${size} bytes, max ${MAX_BODY})`);
    }
    chunks.push(chunk);
  }
  const raw = chunks.length > 0 ? Buffer.concat(chunks) : null;
  if (!raw) return null;
  const text = raw.toString();
  // Validate JSON — Docker API always sends JSON bodies on mutating endpoints
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("invalid JSON in request body");
  }
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

  server.on("clientError", (_err, socket) => {
    // Aborted mid-request (e.g. client gave up waiting for a slow `stop`):
    // the pending container CLI call keeps running in the background, so the
    // container stops eventually — just destroy the dead socket.
    socket.destroy();
  });

  await new Promise((resolve, reject) => {
    server.listen(socketPath, resolve);
    server.once("error", reject);
  });

  // Socket permissions — 0600 restricts to owner. Non-root processes need
  // to run as the same user (or use groups) to connect. If you need other
  // users to connect, set STEVEDORE_SOCKET to a shared location and chmod it.
  fs.chmodSync(socketPath, 0o600);

  console.log(`stevedore: Docker API socket listening at ${socketPath}`);
  console.log(`stevedore: Set DOCKER_HOST=unix://${socketPath} (or TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=${socketPath})`);

  return server;
}
