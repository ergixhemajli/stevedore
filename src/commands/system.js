/**
 * commands/system.js
 * stevedore system <sub> → container system <sub>
 * Passes through: df, prune (→ prune), events
 */
import { exec } from "../utils/exec.js";
import { translateFlags } from "../utils/flags.js";
const MAP = { df: "df", prune: "prune", events: "logs --follow" };
export default async function system(args) {
  const [sub, ...rest] = args;
  if (!sub) { await exec(["system", "--help"]); return; }
  if (sub === "prune") {
    // stevedore system prune → container prune + container image prune
    await exec(["prune", ...translateFlags(rest)]);
    await exec(["image", "prune", ...translateFlags(rest)]);
    return;
  }
  if (sub === "df") { await exec(["system", "df", ...translateFlags(rest)]); return; }
  if (sub === "events") { await exec(["system", "logs", "--follow", ...translateFlags(rest)]); return; }
  await exec(["system", sub, ...translateFlags(rest)]);
}
