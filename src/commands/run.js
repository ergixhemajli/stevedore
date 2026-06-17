/**
 * commands/run.js
 *
 * stevedore run → docker run
 *
 * Flag differences handled here:
 *   - --net / --network shorthand normalisation (done by flags.js renameFlags)
 *   - --mac-address <MAC> → --network default,mac=<MAC>
 *   - unsupported flags are dropped with a warning (done by flags.js dropUnsupportedFlags)
 */

import { exec } from "../utils/exec.js";
import { injectDbStabilityEnvArgs } from "../utils/db-stability.js";
import { dropUnsupportedFlags, renameFlags } from "../utils/flags.js";

export default async function run(args) {
  let translated = renameFlags(args);
  translated = handleMacAddress(translated);
  translated = dropUnsupportedFlags(translated);
  translated = injectDbStabilityEnvArgs(translated);
  await exec(["run", ...translated]);
}

/**
 * Convert --mac-address <MAC> into appending ,mac=<MAC> to an existing
 * --network flag, or adding --network default,mac=<MAC> if absent.
 *
 * @param {string[]} argv
 * @returns {string[]}
 */
function handleMacAddress(argv) {
  let mac = null;
  const withoutMac = [];

  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    if (token === "--mac-address" && argv[i + 1]) {
      mac = argv[i + 1];
      i += 2;
    } else if (token.startsWith("--mac-address=")) {
      mac = token.slice("--mac-address=".length);
      i++;
    } else {
      withoutMac.push(token);
      i++;
    }
  }

  if (!mac) return argv;

  // Find an existing --network flag and append ,mac=<MAC>
  const result = [];
  let injected = false;
  let j = 0;
  while (j < withoutMac.length) {
    const token = withoutMac[j];
    if (token === "--network" && withoutMac[j + 1]) {
      result.push("--network", `${withoutMac[j + 1]},mac=${mac}`);
      j += 2;
      injected = true;
    } else if (token.startsWith("--network=")) {
      const existing = token.slice("--network=".length);
      result.push(`--network=${existing},mac=${mac}`);
      j++;
      injected = true;
    } else {
      result.push(token);
      j++;
    }
  }

  if (!injected) {
    // No --network flag present; inject before the image argument
    result.unshift("--network", `default,mac=${mac}`);
  }

  return result;
}
