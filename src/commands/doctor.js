#!/usr/bin/env node

/**
 * commands/doctor.js
 *
 * Checks if stevedore and apple/container are properly installed and working.
 * Verifies:
 *   - apple/container binary availability and version
 *   - Node.js version compatibility
 *   - Container runtime health (actually starts a container)
 *   - Auto-repairs broken container system
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";

/**
 * Run a command and capture output without inheriting stdio.
 * @param {string} cmd
 * @param {string[]} args
 * @returns {Promise<{stdout: string, stderr: string, code: number|null}>}
 */
function run(cmd, args = []) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code });
    });
    child.on("error", () => {
      resolve({ stdout: "", stderr: "", code: null });
    });
  });
}

/**
 * Run a command with a timeout.
 * @param {string} cmd
 * @param {string[]} args
 * @param {number} ms
 * @returns {Promise<{stdout: string, stderr: string, code: number|null}>}
 */
function runWithTimeout(cmd, args, ms) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code });
    });
    child.on("error", () => {
      resolve({ stdout: "", stderr: "", code: null });
    });
    const timer = setTimeout(() => {
      child.kill();
      resolve({ stdout: "", stderr: "timed out", code: null });
    }, ms);
    child.on("exit", () => clearTimeout(timer));
  });
}

/**
 * Try to start container system if the health check fails.
 * @returns {Promise<boolean>} true if restart fixed the issue
 */
async function tryAutoRepair() {
  console.log("\nAuto-repair: restarting container system...\n");

  const stopResult = await run("container", ["system", "stop", "--timeout", "30"]);
  if (stopResult.code !== 0) {
    console.log("   Stop failed:");
    if (stopResult.stderr) console.log(`      ${stopResult.stderr.split("\n")[0]}`);
    console.log("      Run 'container system stop; container system start' manually.");
    return false;
  }

  const startResult = await run("container", ["system", "start", "--timeout", "30"]);
  if (startResult.code !== 0) {
    console.log("   Start failed:");
    if (startResult.stderr) console.log(`      ${startResult.stderr.split("\n")[0]}`);
    console.log("      Run 'container system start' manually.");
    return false;
  }

  console.log("   Container system restarted.");

  // Verify the restart worked
  const health = await checkContainerHealth();
  if (health.ok) {
    console.log("   Container runtime verified after restart.");
    return true;
  }

  console.log("   Container system restarted but runtime still not healthy.");
  console.log("   Run 'stevedore doctor' again to verify.");
  return false;
}

/**
 * Verify container runtime can actually start a container.
 * Runs a quick busybox container with a 30s timeout.
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function checkContainerHealth() {
  // Check system status first
  const status = await run("container", ["system", "status"]);
  if (status.code !== 0) {
    return { ok: false, error: `system status failed: ${status.stderr || "unknown error"}` };
  }

  // Try to actually run a container. Use busybox (smallest official image).
  const result = await runWithTimeout("container", ["run", "--rm", "busybox:latest", "echo", "ok"], 30000);
  if (result.code === 0) {
    return { ok: true };
  }

  // Maybe busybox isn't cached — try alpine as second option
  const result2 = await runWithTimeout("container", ["run", "--rm", "alpine:latest", "echo", "ok"], 30000);
  if (result2.code === 0) {
    return { ok: true };
  }

  const err = result.stderr || result2.stderr || "container startup failed";
  return { ok: false, error: err.split("\n")[0] };
}

export default async function doctor(args) {
  const require = createRequire(import.meta.url);
  let stevedoreVersion = "unknown";
  try {
    const pkg = require("../../package.json");
    stevedoreVersion = pkg.version;
  } catch {}

  let hasErrors = false;
  const autoRepair = args.includes("--fix") || args.includes("-f");
  let autoRepairAttempted = false;

  // Check 1: Node.js version
  console.log("1. Node.js");
  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.slice(1).split(".")[0], 10);
  if (nodeMajor >= 20) {
    console.log(`   OK: ${nodeVersion} (meets minimum requirement: 20.0.0)`);
  } else {
    console.log(`   FAIL: ${nodeVersion} (minimum required: 20.0.0)`);
    hasErrors = true;
  }
  console.log();

  // Check 2: apple/container binary
  console.log("2. apple/container binary");
  const versionResult = await run("container", ["--version"]);
  if (versionResult.code === 0 && versionResult.stdout) {
    console.log(`   OK: ${versionResult.stdout}`);
  } else {
    console.log(`   FAIL: apple/container binary not found or failed to run`);
    console.log(`      Install from https://github.com/apple/container/releases`);
    hasErrors = true;
    console.log();
    console.log("─".repeat(50));
    console.log("Stevedore detected issues. Cannot continue checks without container binary.");
    process.exitCode = 1;
    return;
  }
  console.log();

  // Check 3: Container runtime health
  console.log("3. Container runtime");
  const health = await checkContainerHealth();
  if (health.ok) {
    console.log(`   OK: Container runtime is working correctly`);
  } else {
    console.log(`   FAIL: Container runtime is not functional`);
    console.log(`      Error: ${health.error}`);

    if (autoRepair) {
      console.log("\n   (--fix provided — auto-repairing. This will stop all running containers.)\n");
      if (!autoRepairAttempted) {
        autoRepairAttempted = true;
        const fixed = await tryAutoRepair();
        if (fixed) {
          console.log("   Auto-repair succeeded. Try running your command again.");
        } else {
          hasErrors = true;
        }
      }
    } else {
      console.log(`      Run 'stevedore doctor --fix' to attempt automatic repair (stops all containers).`);
      hasErrors = true;
    }
  }
  console.log();

  // Summary
  console.log("─".repeat(50));
  if (hasErrors) {
    console.log("Stevedore detected issues. Please fix the errors above.");
    process.exitCode = 1;
  } else {
    console.log("Stevedore is ready to use!");
  }
}
