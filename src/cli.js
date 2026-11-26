#!/usr/bin/env node

/**
 * cli.js — Entry point
 *
 * Parses arguments and dispatches to the command router.
 *
 * When invoked as "stevedore" (direct name), exposes all commands. When
 * invoked as "docker" (via symlink), doctor and env are restricted.
 */

import { dispatch } from "./dispatcher.js";
import fs from "node:fs";
import path from "node:path";

/**
 * Determine whether we were invoked under the name "stevedore".
 * We check the symlink name (basename) — if the symlink is named
 * "stevedore", doctor and env are available.
 */
let invokedAsStevedore = false;
try {
  fs.readlinkSync(process.argv[1]);
  // If the symlink basename is "stevedore" we're running as stevedore
  invokedAsStevedore = path.basename(process.argv[1]) === "stevedore";
} catch {
  // Fallback: if process.argv[0] path contains "stevedore"
  invokedAsStevedore = process.argv[1]?.includes("stevedore");
}

const argv = process.argv.slice(2);

try {
  await dispatch(argv, invokedAsStevedore);
  if (process.exitCode !== undefined && process.exitCode !== 0) {
    process.exit(process.exitCode);
  }
} catch (err) {
  console.error(`stevedore: error: ${err.message}`);
  process.exit(1);
}
