/**
 * commands/images.js
 *
 * stevedore images [REPOSITORY[:TAG]]  →  container image list
 *
 * Differences:
 *   --digests  → not supported; dropped
 *   --filter   → not supported; dropped
 *   --format   → Go templates not supported; json/table/yaml/toml kept
 *   --no-trunc → not supported; dropped
 *   --all / -a → supported ✓
 *   --quiet / -q → supported ✓
 *
 * Positional REPOSITORY[:TAG] filter is not supported by apple/container image list;
 * it is silently dropped (all images shown).
 */

import { exec } from "../utils/exec.js";

const UNSUPPORTED_FLAGS = new Set(["--digests", "--filter", "-f", "--no-trunc"]);
const CONSUMES_VALUE = new Set(["--filter", "-f"]);

export default async function images(args) {
  const cleaned = [];
  let i = 0;
  while (i < args.length) {
    const token = args[i];
    if (UNSUPPORTED_FLAGS.has(token)) {
      console.warn(`stevedore: warning: flag "${token}" is not supported and will be ignored`);
      if (CONSUMES_VALUE.has(token) && args[i + 1] && !args[i + 1].startsWith("-")) {
        i += 2;
      } else {
        i++;
      }
    } else if (token === "--format" && args[i + 1]) {
      const val = args[i + 1];
      if (["json", "table", "yaml", "toml"].includes(val)) {
        cleaned.push("--format", val);
      } else {
        console.warn(`stevedore: warning: --format "${val}" is a Go template and is not supported. Use json|table|yaml|toml.`);
      }
      i += 2;
    } else if (!token.startsWith("-")) {
      // Positional repository filter — drop with notice
      console.warn(`stevedore: warning: filtering images by repository ("${token}") is not supported; showing all images`);
      i++;
    } else {
      cleaned.push(token);
      i++;
    }
  }
  await exec(["image", "list", ...cleaned]);
}
