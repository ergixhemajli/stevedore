import { exec } from "../utils/exec.js";
import { prune } from "../utils/prune.js";

const COMMANDS = {
  build: "build",
  delete: "rmi",
  history: "history",
  import: "import",
  load: "load",
  ls: "images",
  list: "images",
  pull: "pull",
  push: "push",
  rm: "rmi",
  remove: "rmi",
  save: "save",
  tag: "tag",
};

export default async function image([sub, ...rest]) {
  if (!sub || sub === "--help" || sub === "-h") {
    await exec(["image", "--help"]);
    return;
  }
  if (sub === "prune") {
    await prune("images", rest);
    return;
  }
  if (sub === "inspect") {
    await exec(["image", "inspect", ...rest]);
    return;
  }

  const command = COMMANDS[sub];
  if (!command) {
    console.error(`stevedore: unknown image subcommand: "${sub}"`);
    process.exitCode = 1;
    return;
  }

  const { default: handler } = await import(`./${command}.js`);
  await handler(rest);
}
