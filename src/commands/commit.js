import { exec } from "../utils/exec.js";

export default async function commit(args) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log("Usage: docker commit CONTAINER [REPOSITORY[:TAG]]");
    return;
  }
  if (args.some((arg) => arg.startsWith("-")) || args.length < 1 || args.length > 2) {
    console.error("stevedore: commit accepts a container and optional image reference; Docker commit options are not supported");
    process.exitCode = 1;
    return;
  }

  const [container, reference = `stevedore/commit-${Date.now()}`] = args;
  if (args.length === 1) console.warn(`stevedore: tagging committed image as ${reference} because apple/container requires a reference`);
  await exec(["commit", container, reference]);
}
