/**
 * commands/volume.js
 *
 * stevedore volume <sub> → container volume <sub>
 *
 * Subcommand mapping:
 *   create   → container volume create
 *   inspect  → container volume inspect
 *   ls       → container volume list
 *   prune    → container volume prune
 *   rm       → container volume delete
 *
 * Note: stevedore volume create --driver is not supported (apple/container uses
 * the local driver only). --driver is dropped with a warning.
 */

import { exec } from "../utils/exec.js";
import { translateFlags } from "../utils/flags.js";
import { prune } from "../utils/prune.js";

const SUBCOMMAND_MAP = {
  create:  "create",
  inspect: "inspect",
  ls:      "list",
  list:    "list",
  prune:   "prune",
  rm:      "delete",
  delete:  "delete",
};

export default async function volume(args) {
  const [sub, ...rest] = args;

  if (!sub || sub === "--help" || sub === "-h") {
    await exec(["volume", "--help"]);
    return;
  }

  const mapped = SUBCOMMAND_MAP[sub];
  if (!mapped) {
    console.error(`stevedore: unknown volume subcommand: "${sub}"`);
    process.exitCode = 1;
    return;
  }

  if (mapped === "prune") { await prune("volumes", rest); return; }

  // Drop --driver flag (docker-specific)
  const cleaned = [];
  let i = 0;
  const rest2 = rest;
  while (i < rest2.length) {
    const token = rest2[i];
    if (token === "--driver" || token === "-d") {
      console.warn(`stevedore: warning: --driver is not supported by apple/container; only the local driver is available`);
      if (rest2[i + 1] && !rest2[i + 1].startsWith("-")) i += 2;
      else i++;
    } else if (token.startsWith("--driver=")) {
      console.warn(`stevedore: warning: --driver is not supported by apple/container; only the local driver is available`);
      i++;
    } else {
      cleaned.push(token);
      i++;
    }
  }

  await exec(["volume", mapped, ...translateFlags(cleaned)]);
}
