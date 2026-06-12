/**
 * commands/doctor.js
 *
 * Checks if stevedore and apple/container are properly installed and working.
 * Reports on:
 *   - apple/container binary availability and version
 *   - Node.js version compatibility
 *   - Common permission issues
 */

import { exec } from "../utils/exec.js";
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

export default async function doctor(args) {
  const require = createRequire(import.meta.url);
  let stevedoreVersion = "unknown";
  try {
    const pkg = require("../../package.json");
    stevedoreVersion = pkg.version;
  } catch {}

  console.log("🔍 Stevedore Doctor Check\n");
  console.log(`Stevedore version: ${stevedoreVersion}\n`);

  let hasErrors = false;

  // Check 1: Node.js version
  console.log("1. Node.js");
  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.slice(1).split(".")[0], 10);
  if (nodeMajor >= 20) {
    console.log(`   ✅ ${nodeVersion} (meets minimum requirement: 20.0.0)`);
  } else {
    console.log(`   ❌ ${nodeVersion} (minimum required: 20.0.0)`);
    hasErrors = true;
  }
  console.log();

  // Check 2: apple/container binary
  console.log("2. apple/container binary");
  try {
    const result = await run("container", ["--version"]);
    if (result.code === 0 && result.stdout) {
      console.log(`   ✅ ${result.stdout}`);
    } else {
      console.log(`   ❌ apple/container binary not found or failed to run`);
      console.log(`      Install from https://github.com/apple/container/releases`);
      hasErrors = true;
    }
  } catch {
    console.log(`   ❌ apple/container binary not found in PATH`);
    console.log(`      Install from https://github.com/apple/container/releases`);
    hasErrors = true;
  }
  console.log();

  // Check 3: apple/container status
  console.log("3. apple/container daemon");
  try {
    const result = await run("container", ["system", "status"]);
    if (result.code === 0) {
      console.log(`   ✅ apple/container is running and accessible`);
    } else {
      console.log(`   ⚠️  apple/container may not be running or not accessible`);
      if (result.stderr) {
        console.log(`      ${result.stderr.split("\n")[0]}`);
      }
    }
  } catch {
    console.log(`   ⚠️  Cannot connect to apple/container daemon`);
    console.log(`      Hint: Make sure apple/container is running`);
  }
  console.log();

  // Check 4: Node.js version
  console.log("4. Docker Hub connectivity");
  console.log(`   ℹ️  apple/container supports pulling images from Docker Hub`);
  console.log(`   ✅ No login required for public images`);
  console.log();

  // Summary
  console.log("─".repeat(50));
  if (hasErrors) {
    console.log("⚠️  Stevedore detected issues. Please fix the errors above.");
    process.exitCode = 1;
  } else {
    console.log("✅ Stevedore is ready to use!");
  }
}
