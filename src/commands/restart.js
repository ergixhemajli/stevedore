import { run } from "../api/run.js";

export function parseRestartArgs(args) {
  let timeout = "10";
  let signal;
  const containers = [];

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    const [flag, inlineValue] = token.split(/=(.*)/s, 2);
    if (flag === "--help" || flag === "-h") return { help: true };
    if (["-t", "--timeout", "--time"].includes(flag)) {
      const value = inlineValue ?? args[++i];
      if (!value || value.startsWith("-")) throw new Error(`missing value for ${flag}`);
      timeout = value;
    } else if (["-s", "--signal"].includes(flag)) {
      const value = inlineValue ?? args[++i];
      if (!value || value.startsWith("-")) throw new Error(`missing value for ${flag}`);
      signal = value;
    } else if (token === "--") {
      containers.push(...args.slice(i + 1));
      break;
    } else if (token.startsWith("-")) {
      throw new Error(`unknown restart flag: ${token}`);
    } else {
      containers.push(token);
    }
  }

  if (containers.length === 0) throw new Error("Usage: docker restart [OPTIONS] CONTAINER [CONTAINER...]");
  return { containers, stopOptions: ["--time", timeout, ...(signal ? ["--signal", signal] : [])] };
}

export default async function restart(args) {
  let plan;
  try {
    plan = parseRestartArgs(args);
  } catch (error) {
    console.error(`stevedore: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (plan.help) {
    console.log("Usage: docker restart [OPTIONS] CONTAINER [CONTAINER...]");
    console.log("  -s, --signal   Signal to send before stopping");
    console.log("  -t, --timeout  Seconds to wait before killing the container (default 10)");
    return;
  }

  for (const id of plan.containers) {
    const stopped = await run(["stop", ...plan.stopOptions, id], { timeoutMs: 60_000 });
    if (stopped.exitCode !== 0) {
      console.error(stopped.stderr || `stevedore: failed to stop container ${id}`);
      process.exitCode = stopped.exitCode;
      return;
    }

    const started = await run(["start", id], { timeoutMs: 60_000 });
    if (started.exitCode !== 0) {
      console.error(started.stderr || `stevedore: failed to start container ${id}`);
      process.exitCode = started.exitCode;
      return;
    }
  }
}
