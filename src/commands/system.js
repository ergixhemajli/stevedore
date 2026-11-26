import { exec } from "../utils/exec.js";
import { translateFlags } from "../utils/flags.js";
import { prune } from "../utils/prune.js";

export default async function system([sub, ...rest]) {
  if (!sub || sub === "--help" || sub === "-h") {
    console.log("Usage: docker system <df|events|info|prune>");
    return;
  }

  switch (sub) {
    case "df":
      await exec(["system", "df", ...translateFlags(rest)]);
      return;
    case "events":
      console.error("stevedore: 'system events' is not supported by apple/container.");
      process.exitCode = 1;
      return;
    case "info":
      await exec(["system", "status", ...translateFlags(rest)]);
      return;
    case "prune":
      await prune("system", rest);
      return;
    default:
      console.error(`stevedore: unknown system subcommand: "${sub}"`);
      process.exitCode = 1;
  }
}
