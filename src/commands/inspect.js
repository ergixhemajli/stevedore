import { exec } from "../utils/exec.js";

const COMMANDS = {
  container: ["inspect"],
  image: ["image", "inspect"],
  network: ["network", "inspect"],
  volume: ["volume", "inspect"],
};

export default async function inspect(args) {
  const rest = [];
  let type = "container";
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === "--type" || token === "-t") {
      type = args[++i];
      if (!type) {
        console.error(`stevedore: missing value for ${token}`);
        process.exitCode = 1;
        return;
      }
    } else if (token.startsWith("--type=")) {
      type = token.slice("--type=".length);
    } else {
      rest.push(token);
    }
  }

  const command = COMMANDS[type];
  if (!command) {
    console.error(`stevedore: unsupported inspect type: ${type}`);
    process.exitCode = 1;
    return;
  }

  await exec([...command, ...rest]);
}
