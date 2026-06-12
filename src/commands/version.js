/**
 * commands/version.js
 *
 * stevedore version → container system version
 * Also prints the stevedore wrapper version at the top.
 */

import { exec } from "../utils/exec.js";
import { createRequire } from "node:module";

export default async function version(args) {
  const require = createRequire(import.meta.url);
  let stevedoreVersion = "unknown";
  try {
    const pkg = require("../../package.json");
    stevedoreVersion = pkg.version;
  } catch {}

  console.log(`Stevedore (docker compatibility layer): ${stevedoreVersion}`);
  console.log("---");
  await exec(["system", "version", ...args]);
}
