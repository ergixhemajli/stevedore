/**
 * src/api/run.js
 *
 * Helpers for executing apple/container commands and capturing their output,
 * used by the API route handlers.
 *
 * Unlike src/utils/exec.js (which inherits stdio for interactive use),
 * these helpers capture stdout/stderr as strings so we can parse and
 * transform them into Docker API JSON responses.
 */

import { spawn } from "node:child_process";
import { CONTAINER_BIN } from "../utils/exec.js";

/**
 * Run `container <args>` and return { stdout, stderr, exitCode }.
 * Never rejects — callers check exitCode.
 *
 * @param {string[]} args
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number }>}
 */
export async function run(args) {
  return new Promise((resolve) => {
    const child = spawn(CONTAINER_BIN, args);
    const out = [];
    const err = [];
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    child.on("close", (code) => {
      resolve({
        stdout: Buffer.concat(out).toString().trim(),
        stderr: Buffer.concat(err).toString().trim(),
        exitCode: code ?? 0,
      });
    });
    child.on("error", (e) => {
      resolve({ stdout: "", stderr: e.message, exitCode: 1 });
    });
  });
}

/**
 * Run `container <args> --format json` and parse the output.
 * Returns parsed JSON, or throws with the stderr on failure.
 *
 * @param {string[]} args
 * @returns {Promise<any>}
 */
export async function runJSON(args) {
  const { stdout, stderr, exitCode } = await run([...args, "--format", "json"]);
  if (exitCode !== 0) throw new Error(stderr || `container exited ${exitCode}`);
  if (!stdout) return null;
  // apple/container sometimes returns one JSON object per line
  const lines = stdout.split("\n").filter(Boolean);
  if (lines.length === 1) return JSON.parse(lines[0]);
  return lines.map((l) => JSON.parse(l));
}

// ---------------------------------------------------------------------------
// HTTP response helpers
// ---------------------------------------------------------------------------

/**
 * Send a JSON response.
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {any} body
 */
export function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Send a Docker-style error response.
 */
export function apiError(res, status, message) {
  json(res, status, { message });
}
