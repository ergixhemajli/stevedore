import { exec } from "../utils/exec.js";

export default async function stop(args) {
  const hasTimeout = args.some((arg) => ["-t", "--time", "--timeout"].includes(arg) || arg.startsWith("--time=") || arg.startsWith("--timeout="));
  const translated = args.flatMap((arg) => {
    if (arg === "--timeout") return ["--time"];
    if (arg.startsWith("--timeout=")) return [`--time=${arg.slice("--timeout=".length)}`];
    return [arg];
  });
  if (!hasTimeout) translated.unshift("--time", "10");
  await exec(["stop", ...translated]);
}
