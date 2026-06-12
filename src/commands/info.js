/**
 * commands/info.js
 *
 * stevedore info → container system status
 */
import { exec } from "../utils/exec.js";
export default async function info(args) {
  await exec(["system", "status", ...args]);
}
