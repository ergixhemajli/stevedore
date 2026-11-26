import { exec } from "../utils/exec.js";
import { prune } from "../utils/prune.js";

const COMMANDS = {
  attach: "attach",
  commit: "commit",
  cp: "cp",
  create: "create",
  delete: "rm",
  diff: "diff",
  exec: "exec",
  export: "export",
  inspect: "inspect",
  kill: "kill",
  list: "ps",
  logs: "logs",
  ls: "ps",
  pause: "pause",
  port: "port",
  ps: "ps",
  remove: "rm",
  rename: "rename",
  restart: "restart",
  rm: "rm",
  run: "run",
  start: "start",
  stats: "stats",
  stop: "stop",
  top: "top",
  unpause: "unpause",
  update: "update",
  wait: "wait",
};

export default async function container([sub, ...rest]) {
  if (!sub || sub === "--help" || sub === "-h") {
    await exec(["--help"]);
    return;
  }
  if (sub === "prune") {
    await prune("containers", rest);
    return;
  }

  const command = COMMANDS[sub];
  if (!command) {
    console.error(`stevedore: unknown container subcommand: "${sub}"`);
    process.exitCode = 1;
    return;
  }

  const { default: handler } = await import(`./${command}.js`);
  await handler(rest);
}
