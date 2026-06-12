/**
 * dispatcher.js
 *
 * Central routing table.  Every stevedore subcommand maps to a handler module
 * in src/commands/.  Handlers export a single default function:
 *
 *   export default async function handler(args: string[]): Promise<void>
 *
 * The handler receives the raw argv slice *after* the subcommand token and is
 * responsible for translating flags, then calling exec() from src/utils/exec.js.
 *
 * To add a new command:
 *   1. Create src/commands/<name>.js
 *   2. Add an entry to COMMAND_MAP below
 *   3. Add tests in test/commands/<name>.test.js
 */

import { exec } from "./utils/exec.js";
import { printHelp } from "./utils/help.js";

// ---------------------------------------------------------------------------
// Command registry
// Each key is the stevedore subcommand string.
// The value is either:
//   - a string  → direct passthrough (docker X → container X), no flag translation needed
//   - a function → dynamic import path for a full handler module
// ---------------------------------------------------------------------------
const COMMAND_MAP = {
  // ── container lifecycle ──────────────────────────────────────────────────
  run:     () => import("./commands/run.js"),
  create:  () => import("./commands/create.js"),
  start:   () => import("./commands/start.js"),
  stop:    () => import("./commands/stop.js"),
  restart: () => import("./commands/restart.js"),
  kill:    () => import("./commands/kill.js"),
  rm:      () => import("./commands/rm.js"),
  exec:    () => import("./commands/exec.js"),
  attach:  () => import("./commands/attach.js"),
  wait:    () => import("./commands/wait.js"),
  rename:  () => import("./commands/rename.js"),
  pause:   () => import("./commands/pause.js"),
  unpause: () => import("./commands/unpause.js"),

  // ── container inspection ─────────────────────────────────────────────────
  ps:      () => import("./commands/ps.js"),
  inspect: () => import("./commands/inspect.js"),
  logs:    () => import("./commands/logs.js"),
  stats:   () => import("./commands/stats.js"),
  top:     () => import("./commands/top.js"),
  port:    () => import("./commands/port.js"),
  diff:    () => import("./commands/diff.js"),
  cp:      () => import("./commands/cp.js"),
  export:  () => import("./commands/export.js"),
  commit:  () => import("./commands/commit.js"),
  doctor:  () => import("./commands/doctor.js"),

  // ── image management ─────────────────────────────────────────────────────
  build:   () => import("./commands/build.js"),
  pull:    () => import("./commands/pull.js"),
  push:    () => import("./commands/push.js"),
  images:  () => import("./commands/images.js"),
  rmi:     () => import("./commands/rmi.js"),
  tag:     () => import("./commands/tag.js"),
  save:    () => import("./commands/save.js"),
  load:    () => import("./commands/load.js"),
  import:  () => import("./commands/import.js"),
  history: () => import("./commands/history.js"),
  search:  () => import("./commands/search.js"),

  // ── network management ───────────────────────────────────────────────────
  network: () => import("./commands/network.js"),

  // ── volume management ────────────────────────────────────────────────────
  volume:  () => import("./commands/volume.js"),

  // ── registry auth ────────────────────────────────────────────────────────
  login:   () => import("./commands/login.js"),
  logout:  () => import("./commands/logout.js"),

  // ── system / info ────────────────────────────────────────────────────────
  info:    () => import("./commands/info.js"),
  version: () => import("./commands/version.js"),
  system:  () => import("./commands/system.js"),
  events:  () => import("./commands/events.js"),
};

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
export async function dispatch(argv) {
  const [subcommand, ...rest] = argv;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printHelp();
    return;
  }

  if (subcommand === "--version" || subcommand === "-v") {
    const { default: handler } = await import("./commands/version.js");
    return handler([]);
  }

  const loader = COMMAND_MAP[subcommand];

  if (!loader) {
    throw new Error(
      `unknown stevedore command: "${subcommand}"\nRun 'stevedore --help' for usage.`
    );
  }

  const { default: handler } = await loader();
  await handler(rest);
}
