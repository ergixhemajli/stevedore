#!/usr/bin/env node

/**
 * cli.js — Entry point
 *
 * Parses arguments and dispatches to the command router.
 */

import { dispatch } from "./dispatcher.js";

const argv = process.argv.slice(2);

try {
  await dispatch(argv);
  if (process.exitCode !== undefined && process.exitCode !== 0) {
    process.exit(process.exitCode);
  }
} catch (err) {
  console.error(`stevedore: error: ${err.message}`);
  process.exit(1);
}
