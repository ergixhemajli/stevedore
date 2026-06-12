/**
 * exec.js
 *
 * Thin wrapper around Node's child_process.spawn that:
 *   - Resolves the `container` binary path (respects STEVEDORE_CONTAINER_BIN env override)
 *   - Inherits stdio so interactive commands (run -it, exec -it, logs -f) work correctly
 *   - Forwards the process exit code
 *
 * Usage:
 *   await exec(["run", "-it", "ubuntu:latest", "/bin/bash"])
 */

import { spawn } from "node:child_process";

/**
 * The path to the apple/container binary.
 * Override with STEVEDORE_CONTAINER_BIN for testing or non-standard installs.
 */
export const CONTAINER_BIN =
  process.env.STEVEDORE_CONTAINER_BIN ?? "/opt/homebrew/bin/container";

/**
 * Spawn `container <args>` with inherited stdio.
 * Resolves when the child exits; rejects only on spawn errors (binary not found etc.).
 * Exit codes from the child are forwarded to the parent process directly.
 *
 * @param {string[]} args  Full argument list passed to the container binary
 * @returns {Promise<void>}
 */
export async function exec(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(CONTAINER_BIN, args, { stdio: "inherit" });

    child.on("error", (err) => {
      if (err.code === "ENOENT") {
        reject(
          new Error(
            `apple/container binary not found at "${CONTAINER_BIN}".\n` +
              "Install it with: brew install --cask apple-container\n" +
              "or set STEVEDORE_CONTAINER_BIN to the correct path."
          )
        );
      } else {
        reject(err);
      }
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
      } else {
        process.exitCode = code ?? 0;
        resolve();
      }
    });
  });
}
