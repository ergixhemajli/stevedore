import { exec } from "../utils/exec.js";
import { injectDbStabilityEnvArgs } from "../utils/db-stability.js";
import { translateFlags } from "../utils/flags.js";

export default async function create(args) {
  const translated = injectDbStabilityEnvArgs(translateFlags(args, "create"));
  await exec(["create", ...translated]);
}
