/**
 * src/commands/completion.js
 *
 * Print shell completion scripts for stevedore/docker.
 *
 * Usage:
 *   docker completion bash
 *   docker completion zsh
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../");

export default async function completion(args) {
  const shell = (args[0] ?? "").toLowerCase();

  if (!shell || !["bash", "zsh"].includes(shell)) {
    console.log(`Usage: docker completion <bash|zsh>

Examples:
  docker completion bash > ~/.stevedore/completion.bash
  source ~/.stevedore/completion.bash

  docker completion zsh > ~/.stevedore/_docker
  fpath=(~/.stevedore $fpath)
  autoload -Uz compinit && compinit
`);
    return;
  }

  const filename = shell === "bash" ? "docker.bash" : "docker.zsh";
  const full = path.join(ROOT, "completions", filename);
  const script = fs.readFileSync(full, "utf8");
  process.stdout.write(script);
}
