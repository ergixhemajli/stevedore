/**
 * prune.js
 *
 * Shared implementation of `docker {system,container,image,volume,network} prune`.
 *
 * apple/container's prune commands take no -f/--filter/--volumes and `image prune`
 * only knows --all, so docker's flags are handled here and mapped onto the
 * matching `container ... prune` calls.
 *
 *   -a, --all     images: `image prune --all` (all unused, not just dangling)
 *   -f, --force   skip the confirmation prompt
 *   --volumes     system prune only: also run `volume prune`
 *   --filter      refused: ignoring it would delete more than the caller asked for
 */

import readline from "node:readline";
import { exec } from "./exec.js";

const STEPS = {
  containers: () => [["prune"], "all stopped containers"],
  networks: () => [["network", "prune"], "all networks not used by at least one container"],
  volumes: () => [["volume", "prune"], "all volumes not used by at least one container"],
  images: (all) =>
    all
      ? [["image", "prune", "--all"], "all images without at least one container associated to them"]
      : [["image", "prune"], "all dangling images"],
};

export function parsePruneArgs(args) {
  const opts = { all: false, force: false, volumes: false };
  for (const arg of args) {
    if (arg === "--all") opts.all = true;
    else if (arg === "--force") opts.force = true;
    else if (arg === "--volumes") opts.volumes = true;
    else if (arg === "--filter" || arg.startsWith("--filter=")) {
      throw new Error("--filter is not supported by apple/container prune; refusing to prune everything instead");
    } else if (/^-[af]+$/.test(arg)) {
      opts.all ||= arg.includes("a");
      opts.force ||= arg.includes("f");
    } else {
      throw new Error(`unknown prune flag "${arg}" (supported: -a/--all, -f/--force, --volumes)`);
    }
  }
  return opts;
}

function confirm(whats) {
  console.log(`WARNING! This will remove:\n${whats.map((w) => `  - ${w}`).join("\n")}\n`);
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let answered = false;
    rl.on("close", () => {
      if (!answered) console.log();
      resolve(false);
    });
    rl.question("Are you sure you want to continue? [y/N] ", (answer) => {
      answered = true;
      resolve(/^y(es)?$/i.test(answer.trim()));
      rl.close();
    });
  });
}

/**
 * @param {"system"|"containers"|"networks"|"volumes"|"images"} group
 * @param {string[]} args  raw flags after `prune`
 */
export async function prune(group, args) {
  const { all, force, volumes } = parsePruneArgs(args);
  const kinds = group === "system"
    ? ["containers", "networks", ...(volumes ? ["volumes"] : []), "images"]
    : [group];
  const steps = kinds.map((kind) => STEPS[kind](all));

  if (!force && !(await confirm(steps.map(([, what]) => what)))) return;

  for (const [cmd, what] of steps) {
    console.log(`Removing ${what}...`);
    await exec(cmd);
    if (process.exitCode) return;
  }
}
