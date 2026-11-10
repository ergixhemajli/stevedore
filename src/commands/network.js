/**
 * commands/network.js
 *
 * stevedore network <sub> → container network <sub>
 *
 * Subcommand mapping:
 *   connect     → not supported (apple/container uses --network at run time)
 *   disconnect  → not supported
 *   create      → container network create
 *   inspect     → container network inspect
 *   ls          → container network list
 *   prune       → container network prune
 *   rm          → container network delete
 */

import { exec } from "../utils/exec.js";
import { translateFlags } from "../utils/flags.js";
import { prune } from "../utils/prune.js";

const SUBCOMMAND_MAP = {
  create:     "create",
  inspect:    "inspect",
  ls:         "list",
  list:       "list",
  prune:      "prune",
  rm:         "delete",
  delete:     "delete",
};

const UNSUPPORTED_SUBCOMMANDS = new Set(["connect", "disconnect"]);

export default async function network(args) {
  const [sub, ...rest] = args;

  if (!sub || sub === "--help" || sub === "-h") {
    await exec(["network", "--help"]);
    return;
  }

  if (UNSUPPORTED_SUBCOMMANDS.has(sub)) {
    console.warn(
      `stevedore: warning: "stevedore network ${sub}" is not supported by apple/container.\n` +
      `  Use --network at container run time to attach to a network.`
    );
    process.exitCode = 1;
    return;
  }

  const mapped = SUBCOMMAND_MAP[sub];
  if (!mapped) {
    console.error(`stevedore: unknown network subcommand: "${sub}"`);
    process.exitCode = 1;
    return;
  }

  if (mapped === "prune") { await prune("networks", rest); return; }

  await exec(["network", mapped, ...translateFlags(rest)]);
}
