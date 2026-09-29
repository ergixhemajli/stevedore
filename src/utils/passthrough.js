/**
 * passthrough.js
 *
 * Factory for commands that map 1:1 from `stevedore X` to `container X`
 * with only standard flag cleanup (renaming + dropping unsupported).
 *
 * Usage:
 *   export default makePassthrough("run")
 *   export default makePassthrough("stop")
 *
 * For commands whose apple/container subcommand name differs from stevedore's:
 *   export default makePassthrough("image list")  // stevedore images → container image list
 */

import { exec } from "./exec.js";
import { translateFlags } from "./flags.js";

/**
 * @param {string} containerSubcommand  Space-separated subcommand path, e.g. "image list"
 * @returns {(args: string[]) => Promise<void>}
 */
export function makePassthrough(containerSubcommand, commandType) {
  const subcommandTokens = containerSubcommand.split(" ");
  return async function handler(args) {
    const translated = translateFlags(args, commandType);
    await exec([...subcommandTokens, ...translated]);
  };
}
