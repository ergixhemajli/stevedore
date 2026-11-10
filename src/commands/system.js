/**
 * commands/system.js
 * stevedore system <sub> → container system <sub>
 * Passes through: df, events. prune is handled by utils/prune.js.
 */
import { exec } from "../utils/exec.js";
import { translateFlags } from "../utils/flags.js";
import { prune } from "../utils/prune.js";
const MAP = { df: "df", prune: "prune", events: "logs --follow" };
export default async function system(args) {
  const [sub, ...rest] = args;
  if (!sub) { await exec(["system", "--help"]); return; }
  if (sub === "prune") { await prune("system", rest); return; }
  if (sub === "df") { await exec(["system", "df", ...translateFlags(rest)]); return; }
  if (sub === "events") { await exec(["system", "logs", "--follow", ...translateFlags(rest)]); return; }
  await exec(["system", sub, ...translateFlags(rest)]);
}
