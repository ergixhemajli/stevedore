/**
 * supervisor.js — Restart supervisor for stevedore
 *
 * Monitors containers for restart policies (always, on-failure, unless-stopped,
 * unless-stopped) and automatically restarts them when they exit.
 *
 * Usage:
 *   stevedore supervisor start   — starts the supervisor daemon
 *   stevedore supervisor stop    — stops the supervisor daemon
 *   stevedore supervisor status  — shows supervisor status
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { exec } from "node:child_process";
import { run } from "../api/run.js";
import { CONTAINER_BIN } from "../utils/exec.js";

const SUPERVISOR_DIR = path.join(os.homedir(), ".stevedore");
const SUPERVISOR_PID = path.join(SUPERVISOR_DIR, "supervisor.pid");
const SUPERVISOR_SOCKET = path.join(SUPERVISOR_DIR, "supervisor.sock");

// Restart policy map: Docker policy → apple/container flag
const RESTART_POLICIES = {
  "no": "no",
  "always": "always",
  "unless-stopped": "unless-stopped",
  "on-failure": (maxRetries) => `on-failure:${maxRetries ?? 0}`,
  "default": "no",
};

/**
 * Check if a container should be restarted based on its restart policy.
 */
function shouldRestart(containerId, policy, restartCount, lastExitCode) {
  if (policy === "no" || !policy) return false;
  if (policy === "always") return true;
  if (policy === "unless-stopped") return true; // unless-stopped: restart unless manually stopped

  // on-failure: only restart if exit code is non-zero and within retry limit
  if (typeof policy === "string" && policy.startsWith("on-failure:")) {
    const maxRetries = parseInt(policy.split(":")[1], 10) || 0;
    return lastExitCode !== 0 && restartCount < maxRetries;
  }

  return false;
}

/**
 * Get container restart policy from configuration.
 */
function getRestartPolicy(config) {
  const hostConfig = config?.HostConfig ?? {};
  const restartPolicy = hostConfig?.RestartPolicy ?? {};

  if (!restartPolicy.Name) return "no";

  const name = restartPolicy.Name;
  if (name === "on-failure") {
    return `on-failure:${restartPolicy.MaximumRetryCount ?? 0}`;
  }

  return RESTART_POLICIES[name] ?? "no";
}

/**
 * Start a container with restart policy tracking.
 */
export async function startContainer(containerId, policy) {
  await run(["start", containerId]);
  return { success: true, containerId, policy };
}

/**
 * Stop a container (and optionally remove restart tracking).
 */
export async function stopContainer(containerId) {
  await run(["stop", containerId]);
  // Don't remove policy tracking — may need to restart again
  return { success: true, containerId };
}

/**
 * Supervisor loop: monitor containers and restart as needed.
 */
export async function supervisorLoop() {
  console.error("stevedore: supervisor started");

  // Track container policies and restart counts
  const containerPolicies = new Map(); // containerId → policy
  const containerRestartCounts = new Map(); // containerId → count
  const containerLastExitCodes = new Map(); // containerId → exitCode

  let running = true;

  // Signal handlers
  process.on("SIGTERM", () => {
    console.error("stevedore: supervisor shutting down");
    running = false;
  });

  process.on("SIGINT", () => {
    console.error("stevedore: supervisor shutting down");
    running = false;
  });

  while (running) {
    try {
      // Get all containers (including stopped)
      const { stdout } = await run([CONTAINER_BIN, "list", "--all", "--format", "json"]);
      if (!stdout.trim()) {
        await sleep(5000);
        continue;
      }

      const containers = stdout.split("\n").filter(Boolean).map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);

      for (const container of containers) {
        const containerId = container.id;
        const state = container.status?.state ?? container.state ?? "created";
        const exitCode = container.exitCode ?? container.status?.exitCode;

        // Check if we need to track this container
        if (!containerPolicies.has(containerId)) {
          // New container — inspect to get restart policy
          try {
            const { stdout: inspectOut } = await run(["inspect", containerId]);
            const inspectData = JSON.parse(inspectOut);
            const config = Array.isArray(inspectData) ? inspectData[0] : inspectData;
            const policy = getRestartPolicy(config);

            if (policy !== "no") {
              containerPolicies.set(containerId, policy);
              containerRestartCounts.set(containerId, 0);
              console.error(`stevedore: supervisor: tracking container ${containerId} with policy ${policy}`);
            }
          } catch {
            // Container doesn't exist or can't be inspected
            continue;
          }
        }

        // Handle restart logic
        const policy = containerPolicies.get(containerId);
        if (!policy || policy === "no") continue;

        if (state === "exited" || state === "dead") {
          containerLastExitCodes.set(containerId, exitCode);
          const restartCount = containerRestartCounts.get(containerId) ?? 0;

          if (shouldRestart(containerId, policy, restartCount, exitCode)) {
            containerRestartCounts.set(containerId, restartCount + 1);
            console.error(
              `stevedore: supervisor: restarting container ${containerId} (attempt ${restartCount + 1}, policy: ${policy})`
            );

            try {
              await run(["start", containerId]);
              // Container restarted successfully
            } catch (err) {
              console.error(`stevedore: supervisor: failed to restart container ${containerId}: ${err.message}`);
            }
          }
        } else if (state === "running") {
          // Update tracking for running containers
          if (!containerRestartCounts.has(containerId)) {
            containerRestartCounts.set(containerId, 0);
          }
        }
      }
    } catch (err) {
      console.error(`stevedore: supervisor: error: ${err.message}`);
    }

    await sleep(2000);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Write PID file for supervisor.
 */
function writePid() {
  fs.mkdirSync(SUPERVISOR_DIR, { recursive: true });
  fs.writeFileSync(SUPERVISOR_PID, String(process.pid));
}

/**
 * Remove PID file.
 */
function removePid() {
  try { fs.unlinkSync(SUPERVISOR_PID); } catch {}
}

/**
 * Check if supervisor is running.
 */
export function isRunning() {
  try {
    const pid = parseInt(fs.readFileSync(SUPERVISOR_PID, "utf8").trim(), 10);
    process.kill(pid, 0); // Check if process exists
    return true;
  } catch {
    return false;
  }
}

/**
 * Start supervisor daemon.
 */
export async function startSupervisor() {
  if (isRunning()) {
    console.error("stevedore: supervisor is already running");
    return false;
  }

  // Fork a new process
  const { fork } = await import("node:child_process");
  const supervisorPath = new URL("../utils/supervisor-daemon.js", import.meta.url).pathname;

  const child = fork(supervisorPath, [], {
    stdio: ["ignore", "inherit", "inherit", "ipc"],
    detached: true,
  });

  child.unref();
  writePid();

  console.error(`stevedore: supervisor started (PID ${child.pid})`);
  return true;
}

/**
 * Stop supervisor daemon.
 */
export async function stopSupervisor() {
  if (!isRunning()) {
    console.error("stevedore: supervisor is not running");
    return false;
  }

  try {
    const pid = parseInt(fs.readFileSync(SUPERVISOR_PID, "utf8").trim(), 10);
    process.kill(pid, "SIGTERM");
    removePid();
    console.error("stevedore: supervisor stopped");
    return true;
  } catch (err) {
    console.error(`stevedore: failed to stop supervisor: ${err.message}`);
    removePid();
    return false;
  }
}
